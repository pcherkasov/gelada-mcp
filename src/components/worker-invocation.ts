import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Maximum prompt size passed through argv. Beyond this the prompt is written
 * into the workspace and referenced, so a large context cannot hit ARG_MAX.
 */
export const INLINE_PROMPT_LIMIT_BYTES = 128 * 1024;

/** Filename used when a prompt is too large to pass through argv. */
export const PROMPT_FILE_NAME = '.gelada-task.md';

export interface WorkerInvocationInput {
  /** Absolute path of the isolated worktree the worker must operate on. */
  workspacePath: string;
  prompt: string;
  /** Concrete model id, already resolved against the worker catalog. */
  model: string;
  timeoutSeconds?: number;
  /**
   * Pass the worker CLI's permission-bypass flag. Required for the worker to
   * write files at all: the CLI cannot prompt for approval in headless mode and
   * its settings allow-rules are explicitly ignored there.
   */
  autoApprove: boolean;
  /** Ask the worker CLI to restrict terminal commands. */
  sandbox?: boolean;
}

export interface WorkerInvocation {
  args: string[];
  /** Absolute path of the externalised prompt file, when one was written. */
  promptFilePath?: string;
  /** Removes anything this invocation added to the workspace. */
  cleanup: () => Promise<void>;
}

/**
 * Formats seconds as a Go duration string, which is what the worker CLI's
 * --print-timeout expects.
 */
export function formatGoDuration(seconds: number): string {
  const total = Math.max(1, Math.round(seconds));
  return `${total}s`;
}

/**
 * Builds the argument vector for a worker run.
 *
 * Two details here are not obvious and are load-bearing:
 *  - `--add-dir` is mandatory. The worker CLI does not treat the spawn cwd as
 *    its workspace; without it the worker edits files in its own scratch
 *    directory and still exits 0.
 *  - the prompt is externalised past a size threshold rather than relying on
 *    argv, which is bounded by ARG_MAX.
 */
export async function buildWorkerInvocation(
  input: WorkerInvocationInput,
): Promise<WorkerInvocation> {
  const args: string[] = ['--model', input.model, '--add-dir', input.workspacePath];

  if (input.timeoutSeconds && input.timeoutSeconds > 0) {
    args.push('--print-timeout', formatGoDuration(input.timeoutSeconds));
  }

  if (input.sandbox) {
    args.push('--sandbox');
  }

  if (input.autoApprove) {
    args.push('--dangerously-skip-permissions');
  }

  const promptBytes = Buffer.byteLength(input.prompt, 'utf-8');

  if (promptBytes <= INLINE_PROMPT_LIMIT_BYTES) {
    args.push('--prompt', input.prompt);
    return { args, cleanup: async () => {} };
  }

  const promptFilePath = path.join(input.workspacePath, PROMPT_FILE_NAME);
  await fs.writeFile(promptFilePath, input.prompt, 'utf-8');

  args.push(
    '--prompt',
    `Your task specification is too large to inline. Read the file ` +
      `${PROMPT_FILE_NAME} in the workspace root and carry out the task described ` +
      `there in full. Do not modify or delete ${PROMPT_FILE_NAME} itself.`,
  );

  return {
    args,
    promptFilePath,
    cleanup: async () => {
      await fs.rm(promptFilePath, { force: true }).catch(() => {});
    },
  };
}

/**
 * Renders a task contract into the prompt handed to the worker.
 */
export function buildWorkerPrompt(fields: {
  objective: string;
  context?: string;
  acceptanceCriteria?: string[];
  allowedPaths?: string[];
  disallowedPaths?: string[];
  verificationCommands?: string[];
  revisionNotes?: string;
}): string {
  const sections: string[] = [];

  sections.push(`# Objective\n\n${fields.objective}`);

  if (fields.context) {
    sections.push(`# Context\n\n${fields.context}`);
  }

  if (fields.revisionNotes) {
    sections.push(`# Revision requested\n\n${fields.revisionNotes}`);
  }

  if (fields.acceptanceCriteria?.length) {
    sections.push(
      `# Acceptance criteria\n\n${fields.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`,
    );
  }

  if (fields.allowedPaths?.length) {
    sections.push(
      `# Files you may change\n\nOnly these paths, relative to the workspace root:\n` +
        `${fields.allowedPaths.map((p) => `- ${p}`).join('\n')}\n\n` +
        `Creating a listed file that does not exist yet is allowed.`,
    );
  }

  if (fields.disallowedPaths?.length) {
    sections.push(
      `# Files you must not touch\n\n${fields.disallowedPaths.map((p) => `- ${p}`).join('\n')}`,
    );
  }

  if (fields.verificationCommands?.length) {
    sections.push(
      `# Verification\n\nYour work will be checked with:\n` +
        `${fields.verificationCommands.map((c) => `- \`${c}\``).join('\n')}`,
    );
  }

  sections.push(
    `# Rules\n\n` +
      `- Edit files in the workspace directly; do not describe changes instead of making them.\n` +
      `- Stay inside the workspace root. Do not touch files elsewhere on the machine.\n` +
      `- Make the smallest change that satisfies the objective.\n` +
      `- Do not commit, push, or otherwise interact with git.`,
  );

  return sections.join('\n\n');
}
