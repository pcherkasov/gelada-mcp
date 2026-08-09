import fs from 'node:fs';
import path from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { packagePath } from '../utils/package-paths.js';

/**
 * The leader-agent guidance in docs/instructions/ used to be markdown that only
 * a human browsing the repository would ever read. Exposing it as MCP resources
 * lets an agent pull the detail on demand, while the short version stays in the
 * server instructions where it costs context in every session.
 */

export interface InstructionResource {
  slug: string;
  file: string;
  title: string;
  description: string;
}

export const INSTRUCTION_RESOURCES: InstructionResource[] = [
  {
    slug: 'delegation-criteria',
    file: 'delegation-criteria.md',
    title: 'When to delegate',
    description:
      'Decision matrix and heuristics for choosing between delegating a subtask and doing it yourself.',
  },
  {
    slug: 'contract-construction',
    file: 'contract-construction.md',
    title: 'Writing a task contract',
    description:
      'How to specify objective, acceptance criteria, path boundaries and verification commands so a worker can succeed unattended.',
  },
  {
    slug: 'independent-verification',
    file: 'independent-verification.md',
    title: 'Verifying a delegated result',
    description:
      'What to check before accepting a patch, and why a passing verification command is not the same as a correct change.',
  },
  {
    slug: 'delegation-tradeoffs',
    file: 'delegation-tradeoffs.md',
    title: 'Delegation trade-offs',
    description: 'Cost model for delegation: context saved against latency and specification effort.',
  },
  {
    slug: 'claude-code-integration',
    file: 'claude-code-integration.md',
    title: 'Claude Code integration',
    description: 'Setting up and using Gelada from Claude Code.',
  },
  {
    slug: 'codex-integration',
    file: 'codex-integration.md',
    title: 'Codex integration',
    description: 'Setting up and using Gelada from OpenAI Codex.',
  },
  {
    slug: 'overview',
    file: 'README.md',
    title: 'Leader agent guidelines overview',
    description: 'Index of the full leader-agent guidance shipped with Gelada.',
  },
];

/**
 * Locates docs/instructions relative to this module rather than the process
 * working directory, so the resources resolve wherever the package is installed.
 */
export function instructionsDir(): string {
  return packagePath('docs', 'instructions');
}

export function readInstruction(slug: string): string | undefined {
  const entry = INSTRUCTION_RESOURCES.find((r) => r.slug === slug);
  if (!entry) return undefined;
  try {
    return fs.readFileSync(path.join(instructionsDir(), entry.file), 'utf-8');
  } catch {
    return undefined;
  }
}

export function registerInstructionResources(mcpServer: McpServer): void {
  for (const entry of INSTRUCTION_RESOURCES) {
    const uri = `gelada://instructions/${entry.slug}`;
    mcpServer.registerResource(
      entry.slug,
      uri,
      {
        title: entry.title,
        description: entry.description,
        mimeType: 'text/markdown',
      },
      async () => {
        const text = readInstruction(entry.slug);
        return {
          contents: [
            {
              uri,
              mimeType: 'text/markdown',
              text:
                text ??
                `Guidance for "${entry.slug}" is not available in this installation.`,
            },
          ],
        };
      },
    );
  }
}
