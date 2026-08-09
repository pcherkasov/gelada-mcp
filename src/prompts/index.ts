import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * Ready-made delegation contracts for the cases Gelada is actually good at.
 *
 * The hard part of delegating is not calling the tool, it is writing a contract
 * tight enough that the worker can succeed unattended. These prompts encode
 * that shape so a user can reach for a known-good one instead of inventing it.
 */

function userMessage(text: string) {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
}

export function registerAllPrompts(mcpServer: McpServer): void {
  mcpServer.registerPrompt(
    'delegate_unit_tests',
    {
      title: 'Delegate unit tests for existing code',
      description:
        'Build a delegate_task contract that generates tests for code that already works, verified by the project test command.',
      argsSchema: {
        target: z.string().describe('File or module to cover, e.g. src/services/billing.ts'),
        testCommand: z
          .string()
          .optional()
          .describe('Command that runs the suite, e.g. "npm test". Defaults to npm test.'),
        testPath: z
          .string()
          .optional()
          .describe('Where the tests should live, e.g. tests/billing.test.ts'),
      },
    },
    ({ target, testCommand, testPath }) =>
      userMessage(
        `Delegate test generation for ${target} to Gelada.\n\n` +
          `First read ${target} so the objective describes the behaviour that actually exists — ` +
          `the worker will not have your understanding of the code. Then call delegate_task with:\n\n` +
          `- taskType: "unit-test"\n` +
          `- objective: what to cover, stated in terms of observable behaviour of ${target}\n` +
          `- allowedPaths: ${JSON.stringify([testPath ?? 'tests/**'])}\n` +
          `- requiredFiles: ${JSON.stringify([target])}\n` +
          `- verificationCommands: ${JSON.stringify([testCommand ?? 'npm test'])}\n` +
          `- acceptanceCriteria: covering the success path, the error paths, and edge cases you name explicitly\n\n` +
          `Then poll inspect_task until it is terminal, read the diff, and tell me what the tests ` +
          `actually assert before applying anything.`,
      ),
  );

  mcpServer.registerPrompt(
    'delegate_docstrings',
    {
      title: 'Delegate docstring or comment generation',
      description:
        'Build a delegate_task contract that documents existing code without changing its behaviour.',
      argsSchema: {
        target: z.string().describe('File or directory to document, e.g. src/components/'),
        style: z.string().optional().describe('Docstring style, e.g. JSDoc, TSDoc, Google-style'),
      },
    },
    ({ target, style }) =>
      userMessage(
        `Delegate documentation of ${target} to Gelada with delegate_task:\n\n` +
          `- taskType: "doc-gen"\n` +
          `- modelProfile: "FAST" (this is boilerplate work)\n` +
          `- objective: add ${style ?? 'idiomatic'} docstrings to the public API in ${target}, ` +
          `describing why each unit exists rather than restating its signature\n` +
          `- allowedPaths: ${JSON.stringify([target])}\n` +
          `- acceptanceCriteria: ["No behavioural change — comments and docstrings only"]\n\n` +
          `Afterwards check the diff for exactly that: any change to a statement is a rejection.`,
      ),
  );

  mcpServer.registerPrompt(
    'delegate_mechanical_refactor',
    {
      title: 'Delegate a mechanical refactor',
      description:
        'Build a delegate_task contract for a rename, extraction, or migration that repeats across many files.',
      argsSchema: {
        change: z.string().describe('The transformation, e.g. "replace all uses of moment with date-fns"'),
        scope: z.string().optional().describe('Paths it may touch, e.g. src/**'),
        verifyCommand: z.string().optional().describe('Command proving nothing broke, e.g. "npm test"'),
      },
    },
    ({ change, scope, verifyCommand }) =>
      userMessage(
        `This is repetitive work, so delegate it rather than doing it by hand.\n\n` +
          `First establish the exact pattern yourself on one representative case, so the objective ` +
          `states a rule rather than an intention. Then call delegate_task with:\n\n` +
          `- taskType: "refactor"\n` +
          `- objective: ${change}, applied consistently, with the worked example you established\n` +
          `- allowedPaths: ${JSON.stringify([scope ?? 'src/**'])}\n` +
          `- verificationCommands: ${JSON.stringify([verifyCommand ?? 'npm test'])}\n` +
          `- acceptanceCriteria: ["Behaviour is unchanged", "No occurrence of the old pattern remains in scope"]\n\n` +
          `Review the diff for cases the rule did not fit — those are the ones worth your attention.`,
      ),
  );

  mcpServer.registerPrompt(
    'review_delegated_patch',
    {
      title: 'Review a completed delegation',
      description:
        'Walk through a finished task: read the patch, judge it, and decide whether to apply, revise, or discard.',
      argsSchema: {
        taskId: z.string().describe('The task to review'),
      },
    },
    ({ taskId }) =>
      userMessage(
        `Review Gelada task ${taskId} before anything is applied:\n\n` +
          `1. inspect_task ${taskId} mode "summary" — confirm it reached a terminal state.\n` +
          `2. inspect_task ${taskId} mode "diff" — read the whole patch.\n` +
          `3. inspect_task ${taskId} mode "verifications" — see what was actually checked.\n\n` +
          `Then tell me: does the change do what was asked, does it touch anything outside ` +
          `allowedPaths, and would the verification have caught it if it were wrong? A passing ` +
          `command is not evidence of a correct change.\n\n` +
          `Recommend one of: apply as is, revise_task with specific feedback, or discard_task.`,
      ),
  );
}
