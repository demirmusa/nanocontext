import * as fs from 'fs';
import * as path from 'path';
import { buildMcpCommandArgs, renderMcpResourceMarkdownTable, renderMcpToolMarkdownTable } from '../../mcp/catalog';

export interface AgentDefinition {
  id: string;
  name: string;
  mcpConfigPath: string;
  agentMdFiles: string[];
  mcpConfigKind: 'json' | 'toml';
  rootKey?: string;
}

export interface AgentSetupResult {
  createdMcpConfigs: string[];
  removedMcpConfigs: string[];
  updatedAgentDocs: string[];
}

const NANOCONTEXT_SECTION_MARKER = '<!-- nanocontext:start -->';
const NANOCONTEXT_SECTION_END = '<!-- nanocontext:end -->';

const AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    id: 'vscode',
    name: 'VS Code Copilot',
    mcpConfigPath: '.vscode/mcp.json',
    agentMdFiles: ['.github/copilot-instructions.md'],
    mcpConfigKind: 'json',
    rootKey: 'servers',
  },
  {
    id: 'claude',
    name: 'Claude Code',
    mcpConfigPath: '.mcp.json',
    agentMdFiles: ['CLAUDE.md', 'claude.md'],
    mcpConfigKind: 'json',
    rootKey: 'mcpServers',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    mcpConfigPath: '.cursor/mcp.json',
    agentMdFiles: ['.cursorrules'],
    mcpConfigKind: 'json',
    rootKey: 'mcpServers',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    mcpConfigPath: '.windsurf/mcp.json',
    agentMdFiles: ['.windsurfrules'],
    mcpConfigKind: 'json',
    rootKey: 'mcpServers',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    mcpConfigPath: '.gemini/settings.json',
    agentMdFiles: ['GEMINI.md'],
    mcpConfigKind: 'json',
    rootKey: 'mcpServers',
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    mcpConfigPath: '.codex/config.toml',
    agentMdFiles: ['AGENTS.md', 'agents.md'],
    mcpConfigKind: 'toml',
  },
];

export class AgentSetupService {
  getAvailableAgents(): AgentDefinition[] {
    return AGENT_DEFINITIONS.map(agent => ({ ...agent, agentMdFiles: [...agent.agentMdFiles] }));
  }

  applySetup(cwd: string, agents: AgentDefinition[], mode: 'mcp' | 'cli' = 'mcp'): AgentSetupResult {
    const result: AgentSetupResult = {
      createdMcpConfigs: [],
      removedMcpConfigs: [],
      updatedAgentDocs: [],
    };

    for (const agent of agents) {
      if (mode === 'mcp' && this.writeMcpConfig(cwd, agent)) {
        result.createdMcpConfigs.push(agent.mcpConfigPath);
      } else if (mode === 'cli' && this.removeMcpConfig(cwd, agent)) {
        result.removedMcpConfigs.push(agent.mcpConfigPath);
      }

      const updatedDocs = this.updateAgentDocs(cwd, agent, mode);
      result.updatedAgentDocs.push(...updatedDocs);
    }

    return result;
  }

  getNanoContextInstructions(mode: 'mcp' | 'cli' = 'mcp'): string {
    if (mode === 'mcp') {
      return `${NANOCONTEXT_SECTION_MARKER}
## NanoContext MCP

This project uses **NanoContext**, a code intelligence MCP server that provides semantic search, AST-based code analysis, and dependency tracking across the entire codebase. You MUST use NanoContext tools to understand code structure and relationships before making any changes. Do NOT rely solely on file reads — always query NanoContext first.
This project uses **NanoContext**, a code intelligence MCP server that provides semantic search, AST-based code analysis, and dependency tracking across the entire codebase. Use NanoContext for the minimum number of steps needed to get confident context. Do not keep reformulating the same query without new evidence.

### Rules

- When using NanoContext tools, do NOT add commentary or explanations about the tool calls. Execute them silently and use the results directly.
- All file paths (f param) MUST be relative to project root. Never use absolute paths.
- After editing files, call \`scan\` once to refresh the index. Use \`scan\` with \`f\` only when you want to refresh a specific file or glob.

### Tools

${renderMcpToolMarkdownTable()}

### Resources

${renderMcpResourceMarkdownTable()}

### Memory

NanoContext has a persistent memory store that survives across sessions. Use it actively:

- **Session start**: Call \`memories\` at the beginning of every session to load previous context, decisions, and notes.
- **During work**: When you make an architectural decision, discover an important pattern, encounter a tricky bug, or learn something about the codebase that would be useful later — call \`remember\` immediately. Do not wait to be asked.
- **What to remember**: Design decisions and their reasoning, important conventions, known issues and workarounds, relationships between components, user preferences for this project.
- **Cleanup**: Use \`forget\` to remove outdated or incorrect memories.

### Workflow

1. **Session start**: Call \`memories\` to load previous context
2. **Before editing**: Start with \`search\`, then open one strong hit with \`get\` or a header resource. Stop searching when one result is clearly right.
3. **After editing**: Run \`scan\` to re-index all changed files at once
4. **Important findings**: Call \`remember\` to persist context for future sessions

### Playbooks

- **Trace task**: \`search\` -> \`get\` -> \`refs\` / \`trace\`
- **Edit discovery**: \`search\` -> \`get <file>\` -> \`open <symbol>\`
- **Impact review**: \`search\` -> \`callers\` -> \`refs\`
${NANOCONTEXT_SECTION_END}`;
    }

    return `${NANOCONTEXT_SECTION_MARKER}
## NanoContext CLI

This project uses **NanoContext**, a CLI-based code intelligence tool that provides semantic search, AST-based code analysis, and dependency tracking across the entire codebase. Use NanoContext CLI commands when they reduce exploration cost. Do not repeat the same query without new evidence.

### Commands

You can run \`nc --help\` or \`nc <command> --help\` for details. Basic commands:
- \`nc scan\` / \`nc scan -f <file_or_glob>\`: Refresh the code index.
- \`nc search "<query>"\`: Perform text search across the codebase.
- \`nc search -v "<query>"\`: Perform semantic search.
- \`nc search -d "<pattern>"\`: Perform dependency or deep regex search.
- \`nc remember "<text>"\`: Save important project context and architectural decisions.
- \`nc memories\`: View saved memories.
- \`nc status\`: View indexing status and project stats.
- \`nc get <file>\`: Show a compact file summary with imports, classes, and methods.
- \`nc get <file>[<start>-<end>]\`: Read raw file lines for a precise range.
- \`nc refs <symbol>\` / \`nc callers <symbol>\` / \`nc trace <symbol>\`: Walk code flow intentionally.
- \`nc header <file>\` / \`nc peek <target>\` / \`nc open <target>\`: Use progressively wider read primitives.

### Rules

- When using NanoContext tools, execute them using the CLI directly.
- Never call bare tool names such as \`memories\`, \`remember\`, \`forget\`, \`search\`, or \`status\`. In CLI mode, always invoke NanoContext through \`nc <command>\`.
- After editing or creating files, call \`nc scan\` to refresh the index.
- All file paths MUST be relative to project root. Never use absolute paths.

### Memory

NanoContext has a persistent memory store that survives across sessions. Use it actively:

- **Session start**: Run \`nc memories\` at the beginning of every session to load previous context.
- **During work**: When you make an architectural decision or encounter an important pattern, run \`nc remember "<note>"\`.
- **File notes**: When a finding is specific to one file, run \`nc remember "<note>" -f path\\to\\file.cs\`.
- **What to remember**: Design decisions, important conventions, known issues, relationships between components.

### Workflow

1. **Session start**: Run \`nc memories\`
2. **Before editing**: Use \`nc search\` to find the target, then \`nc get <file>\` or \`nc open <symbol>\` to inspect it
3. **After editing**: Run \`nc scan\` to re-index changed files
4. **Important findings**: Call \`nc remember\` to persist context

### Playbooks

- **Trace task**: \`nc search\` -> \`nc get <file>\` -> \`nc refs <symbol>\` / \`nc trace <symbol>\`
- **Edit discovery**: \`nc search\` -> \`nc get <file>\` -> \`nc open <symbol>\`
- **Review/impact**: \`nc search\` -> \`nc callers <symbol>\` -> \`nc refs <symbol>\`
${NANOCONTEXT_SECTION_END}`;
  }

  renderJsonMcpConfig(rootKey: string): string {
    return JSON.stringify({
      [rootKey]: {
        nanocontext: {
          command: 'nc',
          args: buildMcpCommandArgs(),
        },
      },
    }, null, 2);
  }

  renderTomlMcpConfig(): string {
    const args = `[${buildMcpCommandArgs().map(arg => JSON.stringify(arg)).join(', ')}]`;
    return `[mcp_servers.nanocontext]\ncommand = "nc"\nargs = ${args}\n`;
  }

  private writeMcpConfig(cwd: string, agent: AgentDefinition): boolean {
    const fullPath = path.join(cwd, agent.mcpConfigPath);
    if (fs.existsSync(fullPath)) return false;

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const content = agent.mcpConfigKind === 'toml'
      ? this.renderTomlMcpConfig()
      : this.renderJsonMcpConfig(agent.rootKey ?? 'mcpServers');
    fs.writeFileSync(fullPath, content, 'utf-8');
    return true;
  }

  private removeMcpConfig(cwd: string, agent: AgentDefinition): boolean {
    const fullPath = path.join(cwd, agent.mcpConfigPath);
    if (!fs.existsSync(fullPath)) return false;

    fs.unlinkSync(fullPath);

    let currentDir = path.dirname(fullPath);
    while (currentDir.startsWith(cwd) && currentDir !== cwd) {
      if (fs.existsSync(currentDir) && fs.readdirSync(currentDir).length === 0) {
        fs.rmdirSync(currentDir);
        currentDir = path.dirname(currentDir);
        continue;
      }
      break;
    }

    return true;
  }

  private updateAgentDocs(cwd: string, agent: AgentDefinition, mode: 'mcp' | 'cli'): string[] {
    const updatedFiles: string[] = [];
    const instructions = this.getNanoContextInstructions(mode);

    for (const fileName of agent.agentMdFiles) {
      const filePath = path.join(cwd, fileName);
      if (!fs.existsSync(filePath)) {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, instructions + '\n', 'utf-8');
        updatedFiles.push(fileName);
        continue;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.includes(instructions)) continue;

      let updated = content;
      const startIdx = updated.indexOf(NANOCONTEXT_SECTION_MARKER);
      const endIdx = updated.indexOf(NANOCONTEXT_SECTION_END);
      if (startIdx !== -1 && endIdx !== -1) {
        updated = updated.substring(0, startIdx).trimEnd()
          + updated.substring(endIdx + NANOCONTEXT_SECTION_END.length);
      }

      updated = updated.trimEnd() + '\n\n' + instructions + '\n';
      fs.writeFileSync(filePath, updated, 'utf-8');
      updatedFiles.push(fileName);
    }

    return updatedFiles;
  }
}
