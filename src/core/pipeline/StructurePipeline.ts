import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { IStructurePipeline } from '../interfaces/IPipeline';
import { IParserRegistry } from '../interfaces/IParser';
import { IHeaderStore } from '../interfaces/IHeaderStore';
import { IStateStore } from '../interfaces/IStateStore';
import { IVectorStore } from '../interfaces/IVectorStore';
import { IEmbeddingProvider } from '../interfaces/IEmbeddingProvider';
import { ILLMProvider } from '../interfaces/ILLMProvider';
import { IConfigManager } from '../interfaces/IConfigManager';
import { ILogger } from '../interfaces/ILogger';
import { HeaderJson, ScanProgress, VectorRecord, InsightGenerationResult, MethodInfo } from '../interfaces/types';
import { applyHeaderIdentity } from '../identity/recordIds';
import { computeChecksum } from '../../utils/checksum';
import { normalizeProjectPath } from '../../utils/projectPath';
import { ScanManifestService, INSIGHT_PROMPT_VERSION, PARSER_VERSION } from '../services/ScanManifestService';
import { VECTOR_SCHEMA_VERSION } from '../embedding/CachedEmbeddingProvider';

export class StructurePipeline implements IStructurePipeline {
  constructor(
    private parserRegistry: IParserRegistry,
    private headerStore: IHeaderStore,
    private stateStore: IStateStore,
    private vectorStore: IVectorStore,
    private embeddingProvider: IEmbeddingProvider | null,
    private llmProvider: ILLMProvider | null,
    private configManager: IConfigManager,
    private logger: ILogger,
  ) {}

  async processFile(filePath: string, content: string, generationId?: string): Promise<HeaderJson> {
    const parser = this.parserRegistry.getParser(filePath);
    if (!parser) {
      throw new Error(`No parser available for: ${filePath}`);
    }

    const parsed = await parser.parse(content, filePath);
    const checksum = computeChecksum(content);

    const header = applyHeaderIdentity({
      file: filePath,
      lang: parsed.lang,
      checksum,
      generationId,
      namespace: inferNamespace(parsed.exports),
      classes: parsed.classes,
      methods: parsed.methods,
      imports: parsed.imports,
      exports: parsed.exports,
    });

    // Save header
    await this.headerStore.write(filePath, header);

    // Update checksum
    this.stateStore.setChecksum(filePath, checksum);

    // Update search index
    this.stateStore.removeFileIndex(filePath);
    for (const method of header.methods) {
      applyMethodMetadata(method, header.namespace);
      this.stateStore.indexMethod(method.id, filePath, method.name, method.class, method.sig, method.loc, method.insight, generationId, {
        namespace: method.namespace,
        imports: header.imports,
        exports: header.exports,
        decorators: method.decorators,
        visibility: method.visibility,
        isAsync: method.isAsync,
        isStatic: method.isStatic,
        parameters: method.parameters,
        returnType: method.returnType,
      });
      for (const stateRef of method.stateRefs ?? []) {
        this.stateStore.indexStateReference?.({
          ...stateRef,
          file: filePath,
          symbol: method.class ? `${method.class}#${method.name}` : method.name,
          symbolId: method.id,
          generationId,
        });
      }
    }
    for (const cls of header.classes) {
      cls.namespace = cls.namespace ?? header.namespace;
      this.stateStore.indexClass(cls.id, filePath, cls.name, cls.loc, cls.insight, generationId, {
        namespace: cls.namespace,
        imports: header.imports,
        exports: header.exports,
        decorators: cls.decorators,
        visibility: cls.visibility,
        extends: cls.extends,
        implements: cls.implements,
      });
    }

    return header;
  }

  async processProject(onProgress?: (progress: ScanProgress) => void): Promise<void> {
    const config = await this.configManager.loadProjectConfig();
    const userConfig = await this.configManager.loadUserConfig();
    const projectRoot = this.configManager.getProjectRoot();
    const manifestStore = new ScanManifestService(projectRoot);
    const manifest = manifestStore.create({
      parserVersion: PARSER_VERSION,
      vectorSchemaVersion: VECTOR_SCHEMA_VERSION,
      embeddingProvider: userConfig.embedding.provider,
      embeddingModel: userConfig.embedding.model,
      embeddingDimensions: this.embeddingProvider?.dimensions ?? 0,
      insightPromptVersion: INSIGHT_PROMPT_VERSION,
    });
    manifestStore.save(manifest);

    // Read .nanocontextignore if it exists and merge with exclude patterns
    const ignorePatterns = [...config.exclude];
    const ignorePath = path.join(projectRoot, '.nanocontextignore');
    if (fs.existsSync(ignorePath)) {
      const ignoreContent = fs.readFileSync(ignorePath, 'utf-8');
      const lines = ignoreContent.split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));
      ignorePatterns.push(...lines);
    }

    // Collect files matching include patterns, excluding exclude patterns
    let files: string[] = [];
    for (const pattern of config.include) {
      const matched = await glob(pattern, {
        cwd: projectRoot,
        ignore: ignorePatterns,
        nodir: true,
      });
      files.push(...matched.map(file => normalizeProjectPath(file, projectRoot)));
    }

    // Filter to only files we can parse
    files = files.filter(f => this.parserRegistry.getParser(f) !== null);
    // Deduplicate
    files = [...new Set(files)];
    const currentFiles = new Set(files);

    for (const trackedFile of this.stateStore.listTrackedFiles()) {
      if (currentFiles.has(trackedFile)) continue;

      try {
        await this.headerStore.remove(trackedFile);
        await this.vectorStore.removeByFile(trackedFile);
        this.stateStore.removeFile(trackedFile);
      } catch (err) {
        this.logger.error(`Failed to clean removed file ${trackedFile}:`, err);
      }
    }

    // ── Phase 1: Structure (tree-sitter AST parse) ──────────────────
    const progress: ScanProgress = {
      phase: 'structure',
      totalFiles: files.length,
      processedFiles: 0,
      totalMethods: 0,
    };

    onProgress?.(progress);

    const changedFiles: string[] = [];

    for (const file of files) {
      progress.currentFile = file;
      try {
        const fullPath = path.join(projectRoot, file);
        const content = fs.readFileSync(fullPath, 'utf-8');

        // Check if file changed
        const checksum = computeChecksum(content);
        const existingChecksum = this.stateStore.getChecksum(file);
        const hasHeader = this.headerStore.exists(file);

        if (existingChecksum === checksum && hasHeader) {
          // Count methods from existing header for total
          const existingHeader = await this.headerStore.read(file);
          if (existingHeader) {
            progress.totalMethods += existingHeader.methods.length;
            manifest.totalMethods += existingHeader.methods.length;
          }
          manifest.skippedFiles++;
          manifest.indexedFiles++;
          manifest.files.push({ file, status: 'skipped', methods: existingHeader?.methods.length ?? 0 });
          progress.processedFiles++;
          progress.skipped = true;
          onProgress?.(progress);
          continue;
        }

        progress.skipped = false;
        const header = await this.processFile(file, content, manifest.generationId);
        progress.totalMethods += header.methods.length;
        manifest.totalMethods += header.methods.length;
        manifest.changedFiles++;
        manifest.indexedFiles++;
        manifest.files.push({ file, status: 'changed', methods: header.methods.length });
        changedFiles.push(file);
      } catch (err) {
        progress.skipped = false;
        manifest.failedFiles++;
        manifest.files.push({
          file,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
        this.logger.error(`Failed to process ${file}:`, err);
      }

      progress.processedFiles++;
      onProgress?.(progress);
    }

    this.stateStore.setLastScanAt(new Date().toISOString());
    this.stateStore.setTotalMethods(progress.totalMethods);
    manifestStore.save(manifest);

    // ── Phase 2: AI Insight (LLM keyword generation, file-based) ───
    if (config.aiInsight && this.llmProvider) {
      const available = await this.llmProvider.isAvailable();
      if (available) {
        // Collect ALL files that have methods needing insight (not just changedFiles)
        // This ensures insights are retried for files that failed in previous scans
        interface FileInsightTask { file: string; header: HeaderJson; content: string; sentCount: number }
        const fileTasks: FileInsightTask[] = [];

        for (const file of files) {
          try {
            const header = await this.headerStore.read(file);
            if (!header || header.methods.length === 0) continue;

            const fullPath = path.join(projectRoot, file);
            const content = fs.readFileSync(fullPath, 'utf-8');
            const methods = await this.collectMethodsMissingInsight(file, header, content);

            if (methods.length > 0) {
              fileTasks.push({ file, header, content, sentCount: methods.length });
            }
          } catch (err) {
            this.logger.error(`Insight prep failed for ${file}:`, err);
          }
        }

        if (fileTasks.length > 0) {
          progress.phase = 'insight';
          progress.processedFiles = 0;
          progress.totalFiles = fileTasks.length;
          onProgress?.(progress);

          const concurrency = config.aiInsightConcurrency || 20;

          // Concurrency pool: up to `concurrency` in-flight, start next as soon as one finishes
          let running = 0;
          let nextIdx = 0;
          await new Promise<void>((resolveAll) => {
            const startNext = (): void => {
              while (running < concurrency && nextIdx < fileTasks.length) {
                const task = fileTasks[nextIdx++];
                running++;

                // Report file as sent to AI
                progress.currentFile = task.file;
                progress.skipped = false;
                onProgress?.(progress);

                (async () => {
                  try {
                    progress.insightResult = await this.generateInsightsForFile(task.file, task.header, task.content, true)
                      ?? { file: task.file, sentCount: task.sentCount, methods: [] };
                  } catch (err) {
                    this.logger.error(`Insight failed for ${task.file}:`, err);
                    progress.insightResult = {
                      file: task.file,
                      sentCount: task.sentCount,
                      methods: [],
                      error: err instanceof Error ? err.message : String(err),
                    };
                  }

                  running--;
                  progress.processedFiles++;
                  progress.currentFile = undefined;
                  onProgress?.(progress);
                  progress.insightResult = undefined;

                  if (running === 0 && nextIdx >= fileTasks.length) {
                    resolveAll();
                  } else {
                    startNext();
                  }
                })();
              }
            };
            startNext();
          });
        }
      } else {
        this.logger.warn('LLM provider not available, skipping insight phase');
      }
    }

    // ── Phase 3: Vector embeddings ──────────────────────────────────
    if (this.embeddingProvider) {
      // Check ALL files for missing vectors, not just changedFiles
      const vectorFiles = changedFiles.length > 0 ? changedFiles : files;

      progress.phase = 'vectors';
      progress.processedFiles = 0;
      progress.totalFiles = vectorFiles.length;
      onProgress?.(progress);

      const concurrency = config.aiInsightConcurrency || 20;
      let running = 0;
      let nextIdx = 0;

      await new Promise<void>((resolveAll) => {
        if (vectorFiles.length === 0) { resolveAll(); return; }
        const startNext = (): void => {
          while (running < concurrency && nextIdx < vectorFiles.length) {
            const file = vectorFiles[nextIdx++];
            running++;

            progress.currentFile = file;
            progress.skipped = false;
            onProgress?.(progress);

            (async () => {
              try {
                const header = await this.headerStore.read(file);
                if (header) {
                  await this.syncVectorsForFile({ ...header, generationId: header.generationId ?? manifest.generationId });
                }
              } catch (err) {
                this.logger.error(`Vector phase failed for ${file}:`, err);
              }

              running--;
              progress.processedFiles++;
              progress.currentFile = undefined;
              onProgress?.(progress);

              if (running === 0 && nextIdx >= vectorFiles.length) {
                resolveAll();
              } else {
                startNext();
              }
            })();
          }
        };
        startNext();
      });
    }

    manifest.finishedAt = new Date().toISOString();
    manifest.status = manifest.failedFiles > 0 ? 'failed' : 'completed';
    manifestStore.save(manifest);
  }

  async generateInsightsForFile(
    filePath: string,
    header: HeaderJson,
    content?: string,
    assumeAvailable: boolean = false,
  ): Promise<InsightGenerationResult | null> {
    if (!this.llmProvider) return null;

    const config = await this.configManager.loadProjectConfig();
    if (!config.aiInsight) return null;
    if (!assumeAvailable) {
      const available = await this.llmProvider.isAvailable();
      if (!available) return null;
    }

    const normalizedHeader = applyHeaderIdentity(header);
    const methods = await this.collectMethodsMissingInsight(filePath, normalizedHeader, content);
    if (methods.length === 0) return null;

    const { insights, rawResponse, prompt, rawStdout } = await this.llmProvider.generateFileInsights(methods, header.lang);

    let updated = false;
    for (const { methodId, insight } of insights) {
      const target = normalizedHeader.methods.find(hm => hm.id === methodId);
      if (target && insight) {
        target.insight = insight;
        updated = true;
      }
    }

    if (updated) {
      await this.headerStore.write(filePath, normalizedHeader);
      for (const method of normalizedHeader.methods) {
        applyMethodMetadata(method, normalizedHeader.namespace);
        this.stateStore.indexMethod(method.id, filePath, method.name, method.class, method.sig, method.loc, method.insight, normalizedHeader.generationId, {
          namespace: method.namespace,
          imports: normalizedHeader.imports,
          exports: normalizedHeader.exports,
          decorators: method.decorators,
          visibility: method.visibility,
          isAsync: method.isAsync,
          isStatic: method.isStatic,
          parameters: method.parameters,
          returnType: method.returnType,
        });
        for (const stateRef of method.stateRefs ?? []) {
          this.stateStore.indexStateReference?.({
            ...stateRef,
            file: filePath,
            symbol: method.class ? `${method.class}#${method.name}` : method.name,
            symbolId: method.id,
            generationId: normalizedHeader.generationId,
          });
        }
      }
    }

    return {
      file: filePath,
      sentCount: methods.length,
      methods: insights.map(insight => ({ id: insight.methodId, name: insight.methodName, insight: insight.insight })),
      rawResponse,
      prompt,
      rawStdout,
    };
  }

  /** Extract semantic keywords from a file path (e.g. "src/Auth/LoginService.cs" → "Auth Login Service") */
  private filePathKeywords(filePath: string): string {
    const name = path.basename(filePath, path.extname(filePath));
    const dirs = path.dirname(filePath).split(/[\\/]/);
    // Split PascalCase/camelCase into words
    const splitWords = (s: string): string[] =>
      s.replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/[\s_\-./\\]+/)
        .filter(w => w.length > 1);
    const words = new Set<string>();
    for (const dir of dirs) {
      for (const w of splitWords(dir)) words.add(w);
    }
    for (const w of splitWords(name)) words.add(w);
    // Remove noise words
    const noise = new Set(['src', 'lib', 'app', 'index', 'dist', 'out', 'obj', 'bin', 'wwwroot', 'js', 'cs', 'ts']);
    return Array.from(words).filter(w => !noise.has(w.toLowerCase())).join(' ');
  }

  async syncVectorsForFile(header: HeaderJson): Promise<void> {
    if (!this.embeddingProvider) return;

    const normalizedHeader = applyHeaderIdentity(header);
    await this.vectorStore.removeByFile(normalizedHeader.file);

    const records: VectorRecord[] = [];
    const pathContext = this.filePathKeywords(normalizedHeader.file);

    // Create vectors for methods
    for (const method of normalizedHeader.methods) {
      const textParts = [
        normalizedHeader.file,
        pathContext,
        method.name,
        method.class || '',
        method.sig,
        ...(method.refs || []),
        method.insight || '',
      ].filter(Boolean);

      const text = textParts.join(' ');

      try {
        const vector = await this.embeddingProvider.embed(text);
        records.push({
          id: method.id,
          vector,
          type: 'method',
          file: normalizedHeader.file,
          method: method.name,
          class: method.class,
          loc: method.loc,
          sig: method.sig,
          refs: method.refs,
          insight: method.insight,
          lang: normalizedHeader.lang,
          generationId: normalizedHeader.generationId,
        });
      } catch (err) {
        this.logger.error(`Failed to embed method ${method.name}:`, err);
      }
    }

    // Create vectors for classes
    for (const cls of normalizedHeader.classes) {
      const textParts = [
        normalizedHeader.file,
        pathContext,
        cls.name,
        cls.extends || '',
        ...(cls.implements || []),
        cls.insight || '',
      ].filter(Boolean);

      const text = textParts.join(' ');

      try {
        const vector = await this.embeddingProvider.embed(text);
        records.push({
          id: cls.id,
          vector,
          type: 'class',
          file: normalizedHeader.file,
          class: cls.name,
          loc: cls.loc,
          lang: normalizedHeader.lang,
          insight: cls.insight,
          generationId: normalizedHeader.generationId,
        });
      } catch (err) {
        this.logger.error(`Failed to embed class ${cls.name}:`, err);
      }
    }

    if (records.length > 0) {
      await this.vectorStore.upsert(records);
    }
  }

  private async collectMethodsMissingInsight(
    filePath: string,
    header: HeaderJson,
    content?: string,
  ): Promise<Array<{ id: string; name: string; code: string }>> {
    const projectRoot = this.configManager.getProjectRoot();
    const fileContent = content ?? fs.readFileSync(path.join(projectRoot, filePath), 'utf-8');
    const lines = fileContent.split('\n');
    const methods: Array<{ id: string; name: string; code: string }> = [];

    for (const method of applyHeaderIdentity(header).methods) {
      if (method.insight) continue;

      const [start, end] = method.loc.split('-').map(Number);
      methods.push({
        id: method.id,
        name: method.name,
        code: lines.slice(start - 1, end).join('\n'),
      });
    }

    return methods;
  }
}

function inferNamespace(exports: string[]): string | undefined {
  return exports.find(item => item.includes('.') && /^[A-Z_][\w.]+$/.test(item));
}

function applyMethodMetadata(method: MethodInfo, namespace: string | undefined): void {
  method.namespace = method.namespace ?? namespace;
  const sig = method.sig ?? '';
  method.isAsync = method.isAsync ?? /\basync\b|Promise<|Task<|ValueTask</i.test(sig);
  method.isStatic = method.isStatic ?? /\bstatic\b/i.test(sig);
  method.visibility = method.visibility ?? inferVisibility(sig);
  method.parameters = method.parameters ?? inferParameters(sig);
  method.returnType = method.returnType ?? inferReturnType(sig, method.name);
}

function inferVisibility(sig: string): string | undefined {
  const match = sig.match(/\b(public|private|protected|internal|export)\b/i);
  return match?.[1].toLowerCase();
}

function inferParameters(sig: string): string[] | undefined {
  const match = sig.match(/\(([^)]*)\)/);
  if (!match || !match[1].trim()) {
    return undefined;
  }
  return match[1].split(',').map(param => param.trim()).filter(Boolean);
}

function inferReturnType(sig: string, name: string): string | undefined {
  const tsMatch = sig.match(/\)\s*:\s*([^={;]+)/);
  if (tsMatch) {
    return tsMatch[1].trim();
  }

  const beforeName = sig.slice(0, sig.indexOf(name)).trim();
  const tokens = beforeName.split(/\s+/).filter(Boolean)
    .filter(token => !['public', 'private', 'protected', 'internal', 'static', 'async', 'export'].includes(token.toLowerCase()));
  return tokens.length > 0 ? tokens[tokens.length - 1] : undefined;
}
