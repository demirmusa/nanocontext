import { Container } from '../../core/Container';
import { McpServer } from '../../mcp/McpServer';
import { colors } from '../utils/colors';

export async function mcpServerCommand(options: { http?: boolean; project?: string }): Promise<void> {
  const container = new Container(options.project);

  if (!container.configManager.isInitialized()) {
    console.error(colors.red('Project not initialized. Run `nc init` first.'));
    process.exit(1);
  }

  try {
    await container.initialize();

    const mcpServer = new McpServer(container);

    if (options.http) {
      console.error(colors.yellow('HTTP mode not yet implemented. Using stdio.'));
    }

    await mcpServer.startStdio();
  } catch (err) {
    console.error(colors.red(`MCP server failed: ${err}`));
    await container.dispose();
    process.exit(1);
  }
}
