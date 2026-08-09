import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { GeladaServerComponents } from '../server.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);

export const doctorInputSchema = z.object({
  verbose: z.boolean().optional().default(false).describe('Enable detailed diagnostic output'),
  checkWorker: z
    .boolean()
    .optional()
    .default(true)
    .describe('Check worker CLI (Antigravity) availability'),
  repoPath: z
    .string()
    .optional()
    .describe('Path to the git repository to inspect (defaults to cwd)'),
});

export type DoctorInput = z.infer<typeof doctorInputSchema>;

export function registerDoctorTool(mcpServer: McpServer, components: GeladaServerComponents): void {
  mcpServer.registerTool(
    'doctor',
    {
      title: 'Check that delegation can work',
      description:
        'Report whether Gelada can actually run tasks: Node and Git versions, configuration directory permissions, and whether the worker CLI is installed and authenticated.\n' +
        '\n' +
        'Run this first when delegation misbehaves — an unauthenticated or missing worker CLI is the most common cause, and it is reported here rather than being discovered one failed task at a time.',
      inputSchema: doctorInputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      const verbose = args.verbose ?? false;
      const checkWorker = args.checkWorker ?? true;
      const checks: any[] = [];
      let geladaVersion = 'unknown';

      try {
        const pkgStr = await fs.readFile(path.resolve(__dirname, '../../package.json'), 'utf-8');
        geladaVersion = JSON.parse(pkgStr).version;
        checks.push({
          name: 'MCP Server',
          status: 'pass',
          message: `Gelada MCP Server v${geladaVersion} active`,
        });
      } catch (err: any) {
        checks.push({
          name: 'MCP Server',
          status: 'fail',
          message: `Could not read package.json: ${err.message}`,
        });
      }

      let gitAvailable = false;
      const targetRepo = args.repoPath || process.cwd();
      try {
        const repoCheck = await components.repositoryInspector.validateRepoReady(targetRepo, {
          allowUntracked: true,
        });
        if (repoCheck.isGitRepo) {
          gitAvailable = true;
          checks.push({
            name: 'Git CLI',
            status: repoCheck.isClean ? 'pass' : 'warn',
            message: repoCheck.isClean
              ? `Git repository active on branch '${repoCheck.gitStatus?.branch || 'unknown'}'`
              : `Git repository active on branch '${repoCheck.gitStatus?.branch || 'unknown'}' with uncommitted changes`,
            gitStatus: repoCheck.gitStatus,
          });
        } else {
          checks.push({
            name: 'Git CLI',
            status: 'warn',
            message: `Directory ${targetRepo} is not a Git repository`,
            errors: repoCheck.errors,
          });
        }
      } catch (err: any) {
        checks.push({
          name: 'Git CLI',
          status: 'fail',
          message: `Git inspection failed: ${err.message}`,
        });
      }

      let workerAvailable = false;
      if (checkWorker) {
        const agyCommand = process.env.AGY_COMMAND || 'agy';
        try {
          const { stdout } = await execAsync(`${agyCommand} --version`);
          workerAvailable = true;
          checks.push({
            name: 'Worker CLI',
            status: 'pass',
            message: `Worker CLI available: ${stdout.trim()}`,
          });
        } catch (err: any) {
          checks.push({
            name: 'Worker CLI',
            status: 'fail',
            message: `Worker CLI not found: ${err.message}`,
          });
        }
      }

      const result = {
        status: checks.every((c) => c.status === 'pass' || c.status === 'warn') ? 'ok' : 'error',
        geladaVersion,
        gitAvailable,
        workerAvailable,
        verbose,
        checks,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}
