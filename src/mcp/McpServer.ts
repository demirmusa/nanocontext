import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Container } from '../core/Container';
import { getMcpToolsForServer, MCP_RESOURCES, MCP_RESOURCE_TEMPLATES } from './catalog';

const T = 'text' as const;
/** Recursively strip null, undefined, empty string, and empty array values to minimise token usage. */
function compact(val: unknown): unknown {
  if (val === null || val === undefined || val === '') return undefined;
  if (Array.isArray(val)) {
    const arr = val.map(compact).filter(v => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      const c = compact(v);
      if (c !== undefined) out[k] = c;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return val;
}
const json = (data: unknown) => ({ content: [{ type: T, text: JSON.stringify(compact(data) ?? null) }] });
const text = (s: string) => ({ content: [{ type: T, text: s }] });

/** Shorten SearchResult keys for minimal token output. */
const KEY_MAP: Record<string, string> = {
  type: 't', file: 'f', method: 'm', class: 'c', loc: 'l',
  score: 's', sig: 'sg', insight: 'i', refs: 'r', text: 'x',
  suggestedNext: 'n', suggestedNextReason: 'nr', suggestedNextConfidence: 'nc',
  related: 'rel', searchIntent: 'si', searchTelemetry: 'st', fallback: 'fb',
};
function shorten(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[KEY_MAP[k] || k] = v;
  }
  return out;
}
/** Map an array of search results to short-key form. */
function shortResults(results: Record<string, unknown>[]): Record<string, unknown>[] {
  return results.map(r => shorten(r));
}

export class McpServer {
  private server: Server;

  constructor(private container: Container) {
    this.server = new Server(
      { name: 'nanocontext', version: '1.0.0' },
      { capabilities: { tools: {}, resources: {} } },
    );
    this.registerTools();
    this.registerResources();
  }

  private registerTools(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: getMcpToolsForServer(),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'search': {
            const results = await this.container.searchService.execute({
              mode: 'exact',
              query: args?.q as string,
              limit: args?.n as number | undefined,
            });
            return json(shortResults(results.map(({ refs: _, insight: _i, ...r }) => r)));
          }

          case 'svec': {
            const results = await this.container.searchService.execute({
              mode: 'vector',
              query: args?.q as string,
              limit: args?.n as number | undefined,
              typeFilter: (args?.t as 'method' | 'class' | 'memory' | 'all' | undefined) ?? 'all',
            });
            return json(shortResults(results.map(r => ({
              type: r.type, file: r.file, method: r.method,
              class: r.class, loc: r.loc, text: r.text,
              suggestedNext: r.suggestedNext,
              suggestedNextReason: r.suggestedNextReason,
              suggestedNextConfidence: r.suggestedNextConfidence,
            }))));
          }

          case 'sdeep': {
            const results = await this.container.searchService.execute({
              mode: 'vector',
              query: args?.q as string,
              limit: args?.n as number | undefined,
              deep: true,
            });
            return json(shortResults(results as unknown as Record<string, unknown>[]));
          }

          case 'sreg': {
            const results = await this.container.searchService.execute({
              mode: 'regex',
              query: args?.p as string,
              limit: args?.n as number | undefined,
            });
            return json(shortResults(results.map(({ refs: _, insight: _i, ...r }) => r)));
          }

          case 'sregdeep': {
            const results = await this.container.searchService.execute({
              mode: 'regex',
              query: args?.p as string,
              limit: args?.n as number | undefined,
              deep: true,
            });
            return json(shortResults(results as unknown as Record<string, unknown>[]));
          }

          case 'code': {
            const snippet = this.container.codeReadService.readSnippet(args?.f as string, args?.loc as string);
            if (snippet.error) return text(`Error: ${snippet.error}`);
            return text((snippet.warning ? `${snippet.warning}\n` : '') + snippet.content);
          }

          case 'symbol': {
            return json(await this.container.codeReadService.resolveSymbolTarget(args?.query as string));
          }

          case 'files': {
            return json(this.container.fileDiscoveryService.list(args?.query as string | undefined));
          }

          case 'deps': {
            const refs = await this.container.dependencyService.getRefs(
              args?.f as string,
              args?.m as string,
              args?.d as number | undefined,
            );
            return json(refs);
          }

          case 'remember': {
            await this.container.memoryService.remember(
              args?.text as string,
              args?.ref as string,
              args?.file as string | undefined,
              args?.symbol as string | undefined,
            );
            return text('ok');
          }

          case 'memories': {
            const list = await this.container.memoryService.list(
              args?.q as string,
              args?.file as string | undefined,
              args?.symbol as string | undefined,
            );
            if (args?.id) {
              return json(list.map(m => ({ id: m.id, text: m.text, ref: m.ref, file: m.file, symbol: m.symbol, scope: m.scope })));
            }
            return json(list.map(m => ({ text: m.text, ref: m.ref, file: m.file, symbol: m.symbol, scope: m.scope })));
          }

          case 'refs': {
            return json(await this.container.dependencyService.getRefsForSymbol(args?.symbol as string, args?.d as number | undefined));
          }

          case 'callers': {
            return json(await this.container.dependencyService.getCallers(args?.symbol as string));
          }

          case 'state_refs': {
            return json(await this.container.dependencyService.getStateReferences(
              args?.q as string | undefined,
              parseStateReferenceKind(args?.kind),
              args?.n as number | undefined,
            ));
          }

          case 'readers': {
            return json(await this.container.dependencyService.getStateReaders(args?.q as string, args?.n as number | undefined));
          }

          case 'writers': {
            return json(await this.container.dependencyService.getStateWriters(args?.q as string, args?.n as number | undefined));
          }

          case 'callees': {
            return json(await this.container.dependencyService.getCallees(args?.symbol as string));
          }

          case 'trace': {
            return json(await this.container.dependencyService.traceSymbol(args?.symbol as string, args?.d as number | undefined));
          }

          case 'impact': {
            return json(await this.container.impactService.analyze(args?.target as string));
          }

          case 'stale': {
            return json(await this.container.staleService.inspect());
          }

          case 'forget': {
            const ok = await this.container.memoryService.forget(args?.id as string);
            return text(ok ? 'ok' : 'not found');
          }

          case 'scan': {
            if (args?.f) {
              const result = await this.container.indexService.scanFiles([args.f as string]);
              return json(result.map(r => ({ f: r.file, a: r.action, u: r.methodsUpdated, add: r.methodsAdded, rm: r.methodsRemoved })));
            }
            if (this.container.indexService.isWatchRunning()) {
              return text('watch active; files are auto-indexed on save');
            }
            const scanStats = await this.container.indexService.scanProject();
            return json({ f: scanStats.totalFiles, m: scanStats.totalMethods });
          }

          case 'watch': {
            const existing = this.container.watchService.getRunningProjectWatch();
            if (existing) return json({ status: 'running', pid: existing.pid, projectRoot: existing.projectRoot });
            const result = this.container.watchService.startDetached(process.argv[1]);
            return json({ status: 'started', pid: result.pid, projectRoot: result.projectRoot });
          }

          case 'status': {
            const stats = await this.container.statusService.getStatus();
            return json({ f: stats.totalFiles, m: stats.totalMethods, v: stats.vectorCount, pi: stats.pendingInsights });
          }

          default:
            return { content: [{ type: T, text: `Unknown: ${name}` }], isError: true };
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: T, text: `Error: ${msg}` }], isError: true };
      }
    });
  }

  private registerResources(): void {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: MCP_RESOURCES,
      resourceTemplates: MCP_RESOURCE_TEMPLATES,
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;

      if (uri === 'nc://status') {
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(await this.container.statusService.getStatus()) }] };
      }

      if (uri === 'nc://memories') {
        const list = await this.container.memoryService.list();
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(list) }] };
      }

      if (uri.startsWith('nc://headers/')) {
        const inspection = await this.container.inspectionService.inspectUriSegment(uri.replace('nc://headers/', ''));
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(inspection.header || {}) }] };
      }

      throw new Error(`Unknown resource: ${uri}`);
    });
  }

  async startStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

function parseStateReferenceKind(value: unknown): 'read' | 'write' | undefined {
  return value === 'read' || value === 'write' ? value : undefined;
}
