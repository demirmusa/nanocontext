type PropertyType = 'string' | 'number' | 'boolean';

interface ToolProperty {
  type: PropertyType;
  description: string;
  enum?: string[];
}

interface ToolSchema {
  type: 'object';
  properties: Record<string, ToolProperty>;
  required?: string[];
}

export interface McpToolDefinition {
  name: string;
  description: string;
  params: string;
  docsDescription: string;
  inputSchema: ToolSchema;
}

export interface McpResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface McpResourceTemplateDefinition {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
}

export function buildMcpCommandArgs(): string[] {
  return ['mcp-server'];
}

export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: 'search',
    description: 'Exact text search on names/signatures.',
    params: '`q`, `n?`',
    docsDescription: 'Exact text search on names, signatures, and file paths.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Query' },
        n: { type: 'number', description: 'Max results' },
      },
      required: ['q'],
    },
  },
  {
    name: 'svec',
    description: 'Semantic vector search.',
    params: '`q`, `n?`, `t?`',
    docsDescription: 'Semantic vector search. `t`: method / class / memory / all.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Query' },
        n: { type: 'number', description: 'Max results' },
        t: { type: 'string', enum: ['method', 'class', 'memory', 'all'], description: 'Type filter' },
      },
      required: ['q'],
    },
  },
  {
    name: 'sdeep',
    description: 'Vector search with full header data (sigs, imports).',
    params: '`q`, `n?`',
    docsDescription: 'Vector search with full data (sigs, refs, insights).',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Query' },
        n: { type: 'number', description: 'Max results' },
      },
      required: ['q'],
    },
  },
  {
    name: 'sreg',
    description: 'Regex search on names/signatures.',
    params: '`p`, `n?`',
    docsDescription: 'Regex search on names, signatures, and file paths.',
    inputSchema: {
      type: 'object',
      properties: {
        p: { type: 'string', description: 'Regex pattern' },
        n: { type: 'number', description: 'Max results' },
      },
      required: ['p'],
    },
  },
  {
    name: 'sregdeep',
    description: 'Regex search with full header data (sigs, insights).',
    params: '`p`, `n?`',
    docsDescription: 'Regex search with full data (sigs, refs, insights).',
    inputSchema: {
      type: 'object',
      properties: {
        p: { type: 'string', description: 'Regex pattern' },
        n: { type: 'number', description: 'Max results' },
      },
      required: ['p'],
    },
  },
  {
    name: 'code',
    description: 'Get source code by file and line range.',
    params: '`f`, `loc`',
    docsDescription: 'Read source code by line range (e.g. `loc=\"45-72\"`).',
    inputSchema: {
      type: 'object',
      properties: {
        f: { type: 'string', description: 'File path' },
        loc: { type: 'string', description: 'Line range e.g. "45-72"' },
      },
      required: ['f', 'loc'],
    },
  },
  {
    name: 'symbol',
    description: 'Resolve a symbol name to ranked candidates.',
    params: '`query`',
    docsDescription: 'Resolve a symbol name, qualified name, or `Type#Member` target.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Symbol query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'files',
    description: 'List indexed files or search them by partial name.',
    params: '`query?`',
    docsDescription: 'List indexed files or search them by partial name.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional partial filename query' },
      },
    },
  },
  {
    name: 'deps',
    description: 'Get call references of a method.',
    params: '`f`, `m`, `d?`',
    docsDescription: 'Get call references of a method (`d` = depth, max 3).',
    inputSchema: {
      type: 'object',
      properties: {
        f: { type: 'string', description: 'File path' },
        m: { type: 'string', description: 'Method name or method ID' },
        d: { type: 'number', description: 'Depth (default 1, max 3)' },
      },
      required: ['f', 'm'],
    },
  },
  {
    name: 'refs',
    description: 'Get direct refs/callees for a symbol.',
    params: '`symbol`, `d?`',
    docsDescription: 'Walk direct refs for a symbol.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Method or symbol selector' },
        d: { type: 'number', description: 'Depth' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'callers',
    description: 'Get likely inbound references for a symbol.',
    params: '`symbol`',
    docsDescription: 'Find likely callers for a symbol.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Method or symbol selector' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'state_refs',
    description: 'Get indexed state/property references.',
    params: '`q?`, `kind?`, `n?`',
    docsDescription: 'Find property/state reads and writes such as `this.user`, `store.auth.token`, or `config.JwtIssuer`.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Optional state/property path query' },
        kind: { type: 'string', enum: ['read', 'write'], description: 'Optional read/write filter' },
        n: { type: 'number', description: 'Max results' },
      },
    },
  },
  {
    name: 'readers',
    description: 'Get readers for a state/property path.',
    params: '`q`, `n?`',
    docsDescription: 'Find methods that read a state/property path.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'State/property path query' },
        n: { type: 'number', description: 'Max results' },
      },
      required: ['q'],
    },
  },
  {
    name: 'writers',
    description: 'Get writers for a state/property path.',
    params: '`q`, `n?`',
    docsDescription: 'Find methods that write a state/property path.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'State/property path query' },
        n: { type: 'number', description: 'Max results' },
      },
      required: ['q'],
    },
  },
  {
    name: 'callees',
    description: 'Get likely outbound calls for a symbol.',
    params: '`symbol`',
    docsDescription: 'Find likely direct callees for a symbol.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Method or symbol selector' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'trace',
    description: 'Trace a likely call chain for a symbol.',
    params: '`symbol`, `d?`',
    docsDescription: 'Trace a likely execution chain for a symbol.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Method or symbol selector' },
        d: { type: 'number', description: 'Depth' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'impact',
    description: 'Change impact report for a file or symbol.',
    params: '`target`',
    docsDescription: 'Collect callers, callees, trace, same-file symbols, likely tests, and memory notes for a file or symbol.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'File path or symbol selector' },
      },
      required: ['target'],
    },
  },
  {
    name: 'stale',
    description: 'Check index freshness.',
    params: '—',
    docsDescription: 'Report changed files, missing files, missing headers, pending insights, and vector/index mismatches.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'scan',
    description: 'Scan project or a specific file.',
    params: '`f?`',
    docsDescription: 'Scan project or a specific file/glob.',
    inputSchema: {
      type: 'object',
      properties: {
        f: { type: 'string', description: 'File path or glob (omit for full scan)' },
      },
    },
  },
  {
    name: 'watch',
    description: 'Start auto-indexing in the background.',
    params: '—',
    docsDescription: 'Start a detached watcher. If this project already has one, returns the existing watcher.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'remember',
    description: 'Save a note to project memory.',
    params: '`text`, `ref?`, `file?`, `symbol?`',
    docsDescription: 'Save a note to project memory, optionally scoped to a file or symbol.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Note text' },
        ref: { type: 'string', description: 'Optional reference' },
        file: { type: 'string', description: 'Optional file path' },
        symbol: { type: 'string', description: 'Optional symbol query' },
      },
      required: ['text'],
    },
  },
  {
    name: 'memories',
    description: 'List project memories.',
    params: '`q?`, `file?`, `symbol?`, `id?`',
    docsDescription: 'List memories. `file` limits results to one file, `symbol` to one symbol. `id=true` includes IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Filter query' },
        file: { type: 'string', description: 'Only show memories for one file' },
        symbol: { type: 'string', description: 'Only show memories for one symbol' },
        id: { type: 'boolean', description: 'Include memory IDs (for forget)' },
      },
    },
  },
  {
    name: 'forget',
    description: 'Delete a memory.',
    params: '`id`',
    docsDescription: 'Delete a memory.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'status',
    description: 'Get indexing stats.',
    params: '—',
    docsDescription: 'Indexing statistics.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export const MCP_RESOURCES: McpResourceDefinition[] = [
  { uri: 'nc://status', name: 'Status', description: 'Indexing stats', mimeType: 'application/json' },
  { uri: 'nc://memories', name: 'Memories', description: 'All memories', mimeType: 'application/json' },
];

export const MCP_RESOURCE_TEMPLATES: McpResourceTemplateDefinition[] = [
  { uriTemplate: 'nc://headers/{file_path}', name: 'Header', description: 'File header', mimeType: 'application/json' },
];

export function getMcpToolsForServer(): Array<Pick<McpToolDefinition, 'name' | 'description' | 'inputSchema'>> {
  return MCP_TOOL_DEFINITIONS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export function renderMcpToolMarkdownTable(): string {
  const rows = MCP_TOOL_DEFINITIONS
    .filter(tool => tool.name !== 'scan')
    .map(tool => `| \`${tool.name}\` | ${tool.params} | ${tool.docsDescription} |`)
    .join('\n');
  return `| Tool | Params | What it does |\n|------|--------|--------------|\n${rows}`;
}

export function renderMcpResourceMarkdownTable(): string {
  const directRows = MCP_RESOURCES
    .map(resource => `| \`${resource.uri}\` | ${resource.description} |`);
  const templateRows = MCP_RESOURCE_TEMPLATES
    .map(resource => `| \`${resource.uriTemplate}\` | ${resource.description} |`);
  return `| URI | Description |\n|-----|-------------|\n${[...directRows, ...templateRows].join('\n')}`;
}
