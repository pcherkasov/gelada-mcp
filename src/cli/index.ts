import { Command } from 'commander';
import { registerSetupCommand } from './commands/setup.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerConfigCommand } from './commands/config.js';
import { registerTaskCommands } from './commands/task.js';
import { registerMcpCommands, runMcpServe } from './commands/mcp.js';
import { registerCleanupCommand } from './commands/cleanup.js';
import { registerModelsCommand } from './commands/models.js';
import { registerUpdateCommand } from './commands/update.js';
import { registerInitCommand } from './commands/init.js';
import { registerSmokeCommand } from './commands/smoke.js';
import { registerDebugBundleCommand } from './commands/debug-bundle.js';

export function createCliProgram(): Command {
  const program = new Command();

  program
    .name('gelada')
    .description(
      'Local open-source MCP server delegating routine coding tasks to local worker agents',
    )
    .version('0.1.0');

  registerSetupCommand(program);
  registerDoctorCommand(program);
  registerConfigCommand(program);
  registerTaskCommands(program);
  registerMcpCommands(program);
  registerCleanupCommand(program);
  registerModelsCommand(program);
  registerUpdateCommand(program);
  registerInitCommand(program);
  registerSmokeCommand(program);
  registerDebugBundleCommand(program);

  return program;
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const userArgs = argv.slice(2);
  if (userArgs.length === 0) {
    // Backward compatibility: default to executing `mcp serve` when zero arguments provided
    await runMcpServe();
    return;
  }

  const program = createCliProgram();
  await program.parseAsync(argv);
}
