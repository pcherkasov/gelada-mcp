import { Command } from 'commander';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GeladaServer } from '../../server.js';

export async function runMcpServe(): Promise<void> {
  const transport = new StdioServerTransport();
  const server = new GeladaServer();

  let isClosing = false;
  const shutdown = async (signal: string) => {
    if (isClosing) return;
    isClosing = true;
    console.error(`Received ${signal}, shutting down Gelada MCP server...`);
    try {
      await server.close();
    } catch {
      // ignore errors during shutdown
    }
    process.exit(0);
  };

  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });

  await server.start(transport);
  console.error('Gelada MCP server connected and listening via stdio.');
}

export function registerMcpCommands(program: Command): void {
  const mcpGroup = program
    .command('mcp')
    .description('Manage and launch Gelada MCP server instance');

  mcpGroup
    .command('serve')
    .description('Start Gelada MCP server using stdio transport')
    .action(async () => {
      await runMcpServe();
    });
}
