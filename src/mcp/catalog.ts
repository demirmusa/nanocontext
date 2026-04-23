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
    name: 'remember',
    description: 'Save a note to project memory.',
    params: '`text`, `ref?`, `file?`',
    docsDescription: 'Save a note to project memory, optionally scoped to a file.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Note text' },
        ref: { type: 'string', description: 'Optional reference' },
        file: { type: 'string', description: 'Optional file path' },
      },
      required: ['text'],
    },
  },
  {
    name: 'memories',
    description: 'List project memories.',
    params: '`q?`, `file?`, `id?`',
    docsDescription: 'List memories. `file` limits results to one file. `id=true` includes IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Filter query' },
        file: { type: 'string', description: 'Only show memories for one file' },
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
