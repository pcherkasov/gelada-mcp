import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GeladaServerComponents, artifactsFor } from '../server.js';
import { buildWorkerInvocation, buildWorkerPrompt } from '../components/worker-invocation.js';
import { ModelRouterError } from '../components/model-router.js';
import {
  GranularTaskState,
  TaskErrorDetails,
  mapGranularToLegacyStatus,
} from '../types/task.js';

export const delegateTaskInputSchema = z.object({
  repoPath: z.string().optional().describe('Absolute path to target git repository'),
  taskType: z.string().describe('Type of task (e.g. unit-test, dto-gen, refactor, doc-gen)'),
  objective: z.string().describe('Clear specification of what needs to be accomplished'),
  context: z.string().optional().describe('Additional context or background information'),
  acceptanceCriteria: z
    .array(z.string())
    .optional()
    .describe('List of acceptance criteria to verify'),
  allowedPaths: z
    .array(z.string())
    .optional()
    .describe(
      'Write boundary: file paths or glob patterns the worker may create or modify. ' +
        'Listed files do not need to exist yet.',
    ),
  requiredFiles: z
    .array(z.string())
    .optional()
    .describe(
      'Precondition: files that must already exist in the repository before the task runs.',
    ),
  disallowedPaths: z
    .array(z.string())
    .optional()
    .describe('Disallowed file paths or glob patterns'),
  verificationCommands: z
    .array(z.string())
    .optional()
    .describe('Commands to verify task completion (e.g. npm test)'),
  modelProfile: z.string().optional().describe('Worker model profile selection'),
  timeoutSeconds: z.number().optional().describe('Maximum execution timeout in seconds'),
});

export type DelegateTaskInput = z.infer<typeof delegateTaskInputSchema>;

export function isAuthError(text: string): boolean {
  if (!text) return false;
  const patterns = [
    /\bauth(?:entication)? required\b/i,
    /\blogin required\b/i,
    /\bplease run (?:agy )?login\b/i,
    /\bplease (?:re-)?authenticate\b/i,
    /\bnot logged in\b/i,
    /\bunauthenticated\b/i,
    /\binvalid (?:auth|api key|credentials|token)\b/i,
    /\btoken expired\b/i,
    /\bhttp 401\b/i,
    /\b401 unauthorized\b/i,
    /\bagy login\b/i,
  ];
  return patterns.some((p) => p.test(text));
}

/**
 * Recognises a worker that stopped because its model quota ran out.
 *
 * This is not an authentication problem and not a defect in the task: the same
 * delegation succeeds once the window resets. It is worth separating because
 * the natural reaction to a bare "worker exited 1" — retry, or rewrite the
 * objective — is wrong in both directions here.
 *
 * The first two patterns are the ones Antigravity actually emits, observed on a
 * real exhausted account and confirmed against strings in the agy binary:
 *
 *   Error: Individual quota reached. Please upgrade your subscription to
 *   increase your limits. Resets in 2m38s.
 *
 * The rest cover the common phrasings of other providers so this does not have
 * to be rediscovered per worker CLI.
 */
export function isQuotaError(text: string): boolean {
  if (!text) return false;
  const patterns = [
    /\bquota reached\b/i,
    /\bout of credits\b/i,
    /\bquota (?:exceeded|exhausted)\b/i,
    /\bresource[_ ]exhausted\b/i,
    /\binsufficient credits\b/i,
    /\b(?:usage|rate) limit(?:s)? (?:reached|exceeded)\b/i,
    /\brate[- ]?limited\b/i,
    /\btoo many requests\b/i,
    /\bhttp 429\b/i,
    /\b429 too many requests\b/i,
    /\bupgrade your subscription\b/i,
  ];
  return patterns.some((p) => p.test(text));
}

/**
 * Pulls the reset window out of a quota message, e.g. "2m38s" or "10 minutes".
 *
 * This is the single most actionable fact in the failure — it turns "something
 * went wrong" into "wait this long, then retry unchanged" — and it was being
 * dropped on the floor along with the rest of stderr.
 */
export function parseQuotaReset(text: string): string | undefined {
  if (!text) return undefined;
  const match =
    // Longest alternatives first: regex alternation is ordered, so a bare `m`
    // listed before `minutes?` would clip "10 minutes" down to "10 m".
    /\bresets?\s+in\s+([0-9]+\s*(?:days?|hours?|minutes?|seconds?|d|h|m|s)(?:\s*[0-9]+\s*(?:hours?|minutes?|seconds?|h|m|s))*)/i.exec(
      text,
    );
  return match ? match[1].trim() : undefined;
}

/** The error payload for a worker that ran out of quota. */
export function quotaErrorDetails(combinedOutput: string): TaskErrorDetails {
  const resetIn = parseQuotaReset(combinedOutput);
  return {
    code: 'QUOTA_EXHAUSTED',
    message: resetIn
      ? `The worker model's quota is exhausted. It resets in ${resetIn}.`
      : "The worker model's quota is exhausted.",
    category: 'quota',
    stage: 'QUOTA_EXHAUSTED',
    possibleCause:
      'The worker CLI reached the usage limit of its plan. The task itself was never attempted.',
    recommendedAction: resetIn
      ? `Wait ${resetIn} and delegate the same task again unchanged, or switch to a cheaper model profile. Do not rewrite the objective — nothing is wrong with it.`
      : 'Wait for the quota window to reset and delegate the same task again unchanged, or switch to a cheaper model profile. Do not rewrite the objective — nothing is wrong with it.',
  };
}

/**
 * Converts a path glob into a matcher. Supports the `**`, `*` and `?` forms that
 * appear in task contracts; anything else is compared literally.
 */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`);
}

/** Finds allowed paths that a disallowed pattern would forbid. */
export function findContradictoryPaths(
  allowedPaths?: string[],
  disallowedPaths?: string[],
): { allowed: string; disallowed: string }[] {
  if (!allowedPaths?.length || !disallowedPaths?.length) return [];

  const conflicts: { allowed: string; disallowed: string }[] = [];
  for (const disallowed of disallowedPaths) {
    let matcher: RegExp;
    try {
      matcher = globToRegExp(disallowed.trim());
    } catch {
      continue;
    }
    for (const allowed of allowedPaths) {
      const candidate = allowed.trim().replace(/^\.\//, '');
      if (matcher.test(candidate)) {
        conflicts.push({ allowed, disallowed });
      }
    }
  }
  return conflicts;
}

export function registerDelegateTaskTool(
  mcpServer: McpServer,
  components: GeladaServerComponents,
): void {
  mcpServer.registerTool(
    'delegate_task',
    {
      title: 'Delegate a coding subtask to a local worker',
      description:
        'Hand a well-bounded coding subtask to a cheaper local worker agent running in an isolated git worktree, so its verbose output never enters your context and its edits cannot touch the working tree.\n' +
        '\n' +
        'WORTH IT FOR: unit tests for existing behaviour, DTOs and schemas, mappers, docstrings, mechanical refactors, localization, formatting — work that is repetitive, precisely specifiable, and ideally checkable by a command. Roughly: if the output would exceed ~1000 tokens, delegating wins. Also worth it when a failed attempt would break the repository, since the worker is confined to a throwaway worktree.\n' +
        '\n' +
        'NOT WORTH IT FOR: small edits, files already in your context, anything needing judgement (architecture, API design, tricky debugging), tasks you cannot state acceptance criteria for, or anything needing credentials — the worker\'s environment is stripped of secrets. Delegating a small task is a measured net loss; do those yourself.\n' +
        '\n' +
        'RETURNS IMMEDIATELY with status "running" and a taskId. The worker keeps going in the background: poll inspect_task every ~5 seconds until granularStatus is terminal, then read the patch with inspect_task mode "diff". Nothing is applied to your repository — you review the patch and decide. Contract and policy rejections come back synchronously as status "failed" and never spawn a worker.',
      inputSchema: delegateTaskInputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => {
      const repoPath = args.repoPath ?? process.cwd();
      const artifacts = artifactsFor(components, repoPath);
      const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      // 1. Task Creation & Registration with CREATED state
      components.taskRegistry.registerTask({
        taskId,
        repoPath,
        taskType: args.taskType || 'generic',
        objective: args.objective || '',
        granularStatus: 'CREATED',
      });

      // 2. Transition to VALIDATING
      components.taskRegistry.transitionTask(
        taskId,
        'VALIDATING',
        'Validating task payload contract and policy compliance',
      );

      // 3. Contract Validation
      const contractValidation = components.contractValidator.validateDelegateTaskPayload(args);
      if (!contractValidation.valid) {
        const errorDetails: TaskErrorDetails = {
          code: 'FAILED_CONTRACT',
          message: `Task payload validation failed: ${contractValidation.errors.join('; ')}`,
          category: 'contract',
          stage: 'FAILED_CONTRACT',
          raw: contractValidation.errors,
        };
        components.taskRegistry.transitionTask(
          taskId,
          'FAILED_CONTRACT',
          errorDetails.message,
          errorDetails,
        );
        await artifacts
          .saveTaskBundle(taskId, {
            status: 'failed',
            granularStatus: 'FAILED_CONTRACT',
            stateHistory: components.taskRegistry.getTask(taskId)?.stateHistory,
            errorDetails,
            timestamps: components.taskRegistry.getTask(taskId)?.timestamps,
            taskType: args.taskType || 'generic',
            objective: args.objective || '',
            repoPath,
          })
          .catch(() => {});

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  taskId,
                  status: 'failed',
                  granularStatus: 'FAILED_CONTRACT',
                  stateHistory: components.taskRegistry.getTask(taskId)?.stateHistory,
                  errorDetails,
                  error: errorDetails.message,
                  validationErrors: contractValidation.errors,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // 4. Policy Engine Checks (Allowed paths, Disallowed paths, Verification commands)
      const allowedPolicy = components.policyEngine.validateAllowedPaths(
        args.allowedPaths,
        repoPath,
      );
      if (!allowedPolicy.allowed) {
        const errorDetails: TaskErrorDetails = {
          code: allowedPolicy.code || 'FAILED_POLICY',
          message: `Allowed paths policy violation: ${allowedPolicy.reason}`,
          category: 'policy',
          stage: 'FAILED_POLICY',
        };
        components.taskRegistry.transitionTask(
          taskId,
          'FAILED_POLICY',
          errorDetails.message,
          errorDetails,
        );
        await artifacts
          .saveTaskBundle(taskId, {
            status: 'failed',
            granularStatus: 'FAILED_POLICY',
            stateHistory: components.taskRegistry.getTask(taskId)?.stateHistory,
            errorDetails,
            timestamps: components.taskRegistry.getTask(taskId)?.timestamps,
            taskType: args.taskType,
            objective: args.objective,
            repoPath,
          })
          .catch(() => {});

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  taskId,
                  status: 'failed',
                  granularStatus: 'FAILED_POLICY',
                  stateHistory: components.taskRegistry.getTask(taskId)?.stateHistory,
                  errorDetails,
                  error: errorDetails.message,
                  code: allowedPolicy.code,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // A path that is both permitted and forbidden is a self-contradictory
      // contract: the worker would have no way to satisfy it, so reject up front
      // rather than letting the worker guess.
      const contradictoryPaths = findContradictoryPaths(
        args.allowedPaths,
        args.disallowedPaths,
      );
      if (contradictoryPaths.length > 0) {
        const errorDetails: TaskErrorDetails = {
          code: 'FAILED_POLICY',
          message:
            `Contract conflict: ${contradictoryPaths
              .map((c) => `allowedPath "${c.allowed}" is excluded by disallowedPath "${c.disallowed}"`)
              .join('; ')}. Remove the overlap so the write boundary is unambiguous.`,
          category: 'policy',
          stage: 'FAILED_POLICY',
          raw: contradictoryPaths,
        };
        components.taskRegistry.transitionTask(
          taskId,
          'FAILED_POLICY',
          errorDetails.message,
          errorDetails,
        );
        await artifacts
          .saveTaskBundle(taskId, {
            status: 'failed',
            granularStatus: 'FAILED_POLICY',
            stateHistory: components.taskRegistry.getTask(taskId)?.stateHistory,
            errorDetails,
            timestamps: components.taskRegistry.getTask(taskId)?.timestamps,
            taskType: args.taskType,
            objective: args.objective,
            repoPath,
          })
          .catch(() => {});

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  taskId,
                  status: 'failed',
                  granularStatus: 'FAILED_POLICY',
                  stateHistory: components.taskRegistry.getTask(taskId)?.stateHistory,
                  errorDetails,
                  error: errorDetails.message,
                  code: 'FAILED_POLICY',
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const disallowedPolicy = components.policyEngine.validateDisallowedPaths(
        args.disallowedPaths,
        repoPath,
      );
      if (!disallowedPolicy.allowed) {
        const errorDetails: TaskErrorDetails = {
          code: disallowedPolicy.code || 'FAILED_POLICY',
          message: `Disallowed paths policy violation: ${disallowedPolicy.reason}`,
          category: 'policy',
          stage: 'FAILED_POLICY',
        };
        components.taskRegistry.transitionTask(
          taskId,
          'FAILED_POLICY',
          errorDetails.message,
          errorDetails,
        );
        await artifacts
          .saveTaskBundle(taskId, {
            status: 'failed',
            granularStatus: 'FAILED_POLICY',
            stateHistory: components.taskRegistry.getTask(taskId)?.stateHistory,
            errorDetails,
            timestamps: components.taskRegistry.getTask(taskId)?.timestamps,
            taskType: args.taskType,
            objective: args.objective,
            repoPath,
          })
          .catch(() => {});

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  taskId,
                  status: 'failed',
                  granularStatus: 'FAILED_POLICY',
                  stateHistory: components.taskRegistry.getTask(taskId)?.stateHistory,
                  errorDetails,
                  error: errorDetails.message,
                  code: disallowedPolicy.code,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      if (args.verificationCommands && args.verificationCommands.length > 0) {
        const cmdPolicy = components.policyEngine.validateVerificationCommands(
          args.verificationCommands,
        );
        if (!cmdPolicy.allowed) {
          const errorDetails: TaskErrorDetails = {
            code: cmdPolicy.code || 'FAILED_POLICY',
            message: `Verification command policy violation: ${cmdPolicy.reason}`,
            category: 'policy',
            stage: 'FAILED_POLICY',
          };
          components.taskRegistry.transitionTask(
            taskId,
            'FAILED_POLICY',
            errorDetails.message,
            errorDetails,
          );
          await artifacts
            .saveTaskBundle(taskId, {
              status: 'failed',
              granularStatus: 'FAILED_POLICY',
              stateHistory: components.taskRegistry.getTask(taskId)?.stateHistory,
              errorDetails,
              timestamps: components.taskRegistry.getTask(taskId)?.timestamps,
              taskType: args.taskType,
              objective: args.objective,
              repoPath,
            })
            .catch(() => {});

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    taskId,
                    status: 'failed',
                    granularStatus: 'FAILED_POLICY',
                    stateHistory: components.taskRegistry.getTask(taskId)?.stateHistory,
                    errorDetails,
                    error: errorDetails.message,
                    code: cmdPolicy.code,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
      }

      // 5. Repository Readiness Check
      const repoValidation = await components.repositoryInspector.validateRepoReady(repoPath, {
        checkFiles: args.requiredFiles,
      });
      if (!repoValidation.valid) {
        const errorDetails: TaskErrorDetails = {
          code: 'FAILED_POLICY',
          message: `Repository readiness validation failed: ${repoValidation.errors.join('; ')}`,
          category: 'repository',
          stage: 'FAILED_POLICY',
          raw: repoValidation.errors,
        };
        components.taskRegistry.transitionTask(
          taskId,
          'FAILED_POLICY',
          errorDetails.message,
          errorDetails,
        );
        await artifacts
          .saveTaskBundle(taskId, {
            status: 'failed',
            granularStatus: 'FAILED_POLICY',
            stateHistory: components.taskRegistry.getTask(taskId)?.stateHistory,
            errorDetails,
            timestamps: components.taskRegistry.getTask(taskId)?.timestamps,
            taskType: args.taskType,
            objective: args.objective,
            repoPath,
          })
          .catch(() => {});

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  taskId,
                  status: 'failed',
                  granularStatus: 'FAILED_POLICY',
                  stateHistory: components.taskRegistry.getTask(taskId)?.stateHistory,
                  errorDetails,
                  error: errorDetails.message,
                  errors: repoValidation.errors,
                  warnings: repoValidation.warnings,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      try {
        // 6. Transition to PREPARING
        components.taskRegistry.transitionTask(
          taskId,
          'PREPARING',
          'Creating git worktree and constructing worker prompt',
        );

        const worktree = await components.worktreeManager.createWorktree(taskId, { repoPath });
        components.taskRegistry.updateTask(taskId, { worktreeId: worktree.worktreeId });

        const prompt = buildWorkerPrompt({
          objective: args.objective,
          context: args.context,
          acceptanceCriteria: args.acceptanceCriteria,
          allowedPaths: args.allowedPaths,
          disallowedPaths: args.disallowedPaths,
          verificationCommands: args.verificationCommands,
        });

        if (args.repoPath) {
          components.policyEngine.loadProjectPolicy(args.repoPath);
        }

        const effectivePolicy = components.policyEngine.getEffectivePolicy();
        const modelProfile =
          args.modelProfile ?? effectivePolicy.defaultModelProfile ?? 'DEFAULT';
        const resolvedModel = await components.modelRouter.resolveAgyModel(modelProfile);

        // 7. Transition to READY
        components.taskRegistry.transitionTask(
          taskId,
          'READY',
          'Environment prepared and worker CLI arguments ready',
        );

        // 8. Transition to RUNNING & Spawn Worker
        components.taskRegistry.transitionTask(
          taskId,
          'RUNNING',
          'Spawning worker process',
        );

        const workerCommand = process.env.AGY_COMMAND || 'agy';
        const effectiveTimeoutSeconds = args.timeoutSeconds ?? effectivePolicy.taskTimeout;
        const invocation = await buildWorkerInvocation({
          workspacePath: worktree.path,
          prompt,
          model: resolvedModel,
          timeoutSeconds: effectiveTimeoutSeconds,
          autoApprove: effectivePolicy.workerAutoApprove,
          sandbox: effectivePolicy.workerSandbox,
        });

        const workerHandle = await components.workerDriver.spawnWorker({
          taskId,
          command: workerCommand,
          args: invocation.args,
          cwd: worktree.path,
          timeoutMs: effectiveTimeoutSeconds ? effectiveTimeoutSeconds * 1000 : undefined,
          sandbox: components.policyEngine.config.sandbox,
          sandboxImage: components.policyEngine.config.sandboxImage,
        });

        components.taskRegistry.updateTask(taskId, { workerId: workerHandle.workerId });

        // Run the remainder of the task lifecycle in the background to prevent MCP timeouts
        Promise.resolve().then(async () => {
          try {
            const workerResult = await workerHandle.promise;

            // Drop the externalised prompt file before diffing so it never
            // shows up as part of the worker's changes.
            await invocation.cleanup();

            const currentTaskState = components.taskRegistry.getTask(taskId)?.granularStatus;
            if (currentTaskState === 'CANCELLED' || currentTaskState === 'DISCARDED') {
              return; // Task was discarded/cancelled concurrently, abort diff collection
            }

            const combinedOutput = `${workerResult.stderr}\n${workerResult.stdout}`;

            // Checked before the auth branch: a quota message is the more
            // specific diagnosis, and misreporting it as an auth failure would
            // send the leader agent to re-run `agy login` for no reason.
            if (workerResult.exitCode !== 0 && isQuotaError(combinedOutput)) {
              const errorDetails = quotaErrorDetails(combinedOutput);
              components.taskRegistry.transitionTask(
                taskId,
                'QUOTA_EXHAUSTED',
                errorDetails.message,
                errorDetails,
              );
              await artifacts
                .saveTaskBundle(taskId, {
                  status: 'failed',
                  granularStatus: 'QUOTA_EXHAUSTED',
                  stateHistory: components.taskRegistry.getTask(taskId)?.stateHistory,
                  errorDetails,
                  timestamps: components.taskRegistry.getTask(taskId)?.timestamps,
                  workerStdout: workerResult.stdout,
                  workerStderr: workerResult.stderr,
                  taskType: args.taskType,
                  objective: args.objective,
                  repoPath,
                })
                .catch(() => {});

              return;
            }

            if (workerResult.exitCode !== 0 && isAuthError(combinedOutput)) {
              const errorDetails: TaskErrorDetails = {
                code: 'AUTH_REQUIRED',
                message:
                  'Antigravity CLI authentication required. Please run "agy login" in your terminal to authenticate.',
                category: 'authentication',
                stage: 'AUTH_REQUIRED',
              };
              components.taskRegistry.transitionTask(
                taskId,
                'AUTH_REQUIRED',
                errorDetails.message,
                errorDetails,
              );
              await artifacts
                .saveTaskBundle(taskId, {
                  status: 'failed',
                  granularStatus: 'AUTH_REQUIRED',
                  stateHistory: components.taskRegistry.getTask(taskId)?.stateHistory,
                  errorDetails,
                  timestamps: components.taskRegistry.getTask(taskId)?.timestamps,
                  workerStdout: workerResult.stdout,
                  workerStderr: workerResult.stderr,
                  taskType: args.taskType,
                  objective: args.objective,
                  repoPath,
                })
                .catch(() => {});

              return;
            }

            // 9. Transition to COLLECTING (gathering patch diff details)
            components.taskRegistry.transitionTask(
              taskId,
              'COLLECTING',
              'Gathering git diff patch and changed files',
            );

            const diffResult = await components.worktreeManager.getDiffDetails(worktree.worktreeId);

            // 10. Verification phase
            let verificationResults: any[] = [];
            if (args.verificationCommands && args.verificationCommands.length > 0) {
              components.taskRegistry.transitionTask(
                taskId,
                'VERIFYING',
                'Running verification test suite',
              );
              const vRes = await components.verificationEngine.verifyWorktree(
                worktree.path,
                args.verificationCommands,
              );
              verificationResults = vRes.results;
            }

            // Determine final terminal state
            let finalGranularState: GranularTaskState = 'COMPLETED';
            let errorDetails: TaskErrorDetails | undefined = undefined;

            const producedNoChanges = (diffResult.changedFiles?.length ?? 0) === 0;

            if (workerResult.exitCode !== 0) {
              finalGranularState = 'FAILED_WORKER';
              errorDetails = {
                code: 'FAILED_WORKER',
                message: `Worker process exited with non-zero exit code ${workerResult.exitCode}`,
                category: 'execution',
                stage: 'FAILED_WORKER',
              };
            } else if (producedNoChanges) {
              // A clean exit that changed nothing is a failure, not a success.
              // The worker CLI exits 0 when it silently skips work — for example
              // when it lacked write permission, or resolved a workspace other
              // than the one it was pointed at. Reporting COMPLETED here would
              // hand the leader agent an empty patch and call it done.
              finalGranularState = 'FAILED_WORKER';
              errorDetails = {
                code: 'WORKER_NO_CHANGES',
                message:
                  'Worker exited successfully but changed no files. ' +
                  'This usually means it could not write to the workspace. ' +
                  'Check inspect_task mode="logs" for the worker output, and run ' +
                  '"gelada doctor" to verify the worker CLI can edit files headlessly.',
                category: 'execution',
                stage: 'FAILED_WORKER',
                raw: {
                  exitCode: workerResult.exitCode,
                  stdoutTail: workerResult.stdout.slice(-2000),
                  stderrTail: workerResult.stderr.slice(-2000),
                },
              };
            } else if (
              verificationResults.length > 0 &&
              verificationResults.some((r: any) => !r.passed)
            ) {
              finalGranularState = 'FAILED_VERIFICATION';
              errorDetails = {
                code: 'FAILED_VERIFICATION',
                message: 'One or more verification commands failed',
                category: 'verification',
                stage: 'FAILED_VERIFICATION',
              };
            } else if (repoValidation.warnings && repoValidation.warnings.length > 0) {
              finalGranularState = 'COMPLETED_WITH_WARNINGS';
            }

            const finalLegacyStatus = mapGranularToLegacyStatus(finalGranularState);

            // 11. Persist the artifact bundle *before* announcing the terminal
            //     state. A leader agent polls inspect_task and acts the moment a
            //     task looks finished; publishing the state first leaves a window
            //     where the task reads as COMPLETED but its diff and artifacts
            //     are not on disk yet.
            await artifacts.saveTaskBundle(taskId, {
              taskContract: {
                taskId,
                description: args.objective,
                targetDirectory: repoPath,
                allowedTools: args.allowedPaths,
                maxDurationSeconds: args.timeoutSeconds,
              },
              prompt,
              patch: diffResult.rawDiff,
              workerStdout: workerResult.stdout,
              workerStderr: workerResult.stderr,
              verificationResults,
              executionSummary: {
                taskId,
                status: finalLegacyStatus,
                granularStatus: finalGranularState,
                taskType: args.taskType,
                objective: args.objective,
                changedFiles: diffResult.changedFiles,
              },
              status: finalLegacyStatus,
              granularStatus: finalGranularState,
              stateHistory: components.taskRegistry.getTask(taskId)?.stateHistory,
              errorDetails,
              timestamps: components.taskRegistry.getTask(taskId)?.timestamps,
              taskType: args.taskType,
              objective: args.objective,
              repoPath,
              changedFiles: diffResult.changedFiles,
              revisions: 0,
            });

            // 12. Publish the terminal state together with its results, so a
            //     task never reads as finished without them.
            components.taskRegistry.transitionTask(
              taskId,
              finalGranularState,
              `Task reached terminal state ${finalGranularState}`,
              errorDetails,
              {
                latestDiff: diffResult.rawDiff,
                changedFiles: diffResult.changedFiles,
                verificationResults,
                workerOutput: {
                  stdout: workerResult.stdout,
                  stderr: workerResult.stderr,
                },
              },
            );

            // 13. Release the worktree when the worker left nothing behind.
            //     A worktree that does contain changes is kept so the leader can
            //     still inspect or apply them; discard_task frees it explicitly.
            if (producedNoChanges) {
              await components.worktreeManager
                .removeWorktree(worktree.worktreeId, { force: true })
                .catch(() => {});
            }

            // 14. Trigger automatic artifact retention cleanup
            try {
              const effectivePolicy = components.policyEngine.getEffectivePolicy();
              await artifacts.cleanup(effectivePolicy?.retention);
            } catch (cleanupErr) {
              console.warn(`[ArtifactManager] Non-fatal cleanup warning for task ${taskId}:`, cleanupErr);
            }
          } catch (err: any) {
            await invocation.cleanup().catch(() => {});

            let errorMessage = err.message || String(err);
            let errorCode = err.code || 'EXECUTION_FAILED';
            let granularState: GranularTaskState = 'FAILED_WORKER';

            if (
              err.code === 'ENOENT' ||
              err.cause?.code === 'ENOENT' ||
              err.code === 'WORKER_NOT_FOUND' ||
              /enoent|not found/i.test(errorMessage)
            ) {
              errorMessage = `Antigravity CLI executable '${process.env.AGY_COMMAND || 'agy'}' was not found. Please ensure agy is installed and in your PATH.`;
              errorCode = 'AGY_NOT_FOUND';
              granularState = 'FAILED_WORKER';
            } else if (isQuotaError(errorMessage)) {
              const quota = quotaErrorDetails(errorMessage);
              errorMessage = quota.message;
              errorCode = 'QUOTA_EXHAUSTED';
              granularState = 'QUOTA_EXHAUSTED';
            } else if (isAuthError(errorMessage)) {
              errorMessage =
                'Antigravity CLI authentication required. Please run "agy login" in your terminal to authenticate.';
              errorCode = 'AUTH_REQUIRED';
              granularState = 'AUTH_REQUIRED';
            }

            const errorDetails: TaskErrorDetails = {
              code: errorCode,
              message: errorMessage,
              category: 'execution',
              stage: granularState,
            };

            components.taskRegistry.transitionTask(taskId, granularState, errorMessage, errorDetails);

            await artifacts
              .saveTaskBundle(taskId, {
                status: 'failed',
                granularStatus: granularState,
                stateHistory: components.taskRegistry.getTask(taskId)?.stateHistory,
                errorDetails,
                timestamps: components.taskRegistry.getTask(taskId)?.timestamps,
                taskType: args.taskType || 'generic',
                objective: args.objective || '',
                repoPath,
              })
              .catch(() => {});
          }
        }).catch(err => {
          console.error(`[DelegateTask] Unhandled error in background task ${taskId}:`, err);
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  taskId,
                  status: 'running',
                  granularStatus: 'RUNNING',
                  stateHistory: components.taskRegistry.getTask(taskId)?.stateHistory,
                  model: resolvedModel,
                  worktreePath: worktree.path,
                  // Spell out the protocol: an agent that is not told how to
                  // wait tends to either give up or poll in a tight loop.
                  nextStep: {
                    action: 'inspect_task',
                    arguments: { taskId, mode: 'summary' },
                    pollEverySeconds: 5,
                    expectedDurationSeconds: effectiveTimeoutSeconds ?? 300,
                    until:
                      'granularStatus is one of COMPLETED, COMPLETED_WITH_WARNINGS, ' +
                      'FAILED_CONTRACT, FAILED_WORKER, FAILED_POLICY, FAILED_VERIFICATION, ' +
                      'AUTH_REQUIRED, QUOTA_EXHAUSTED, CANCELLED, DISCARDED',
                    then:
                      'On success read the patch with inspect_task mode="diff", review it, and ' +
                      'apply what you accept — Gelada never writes to your working tree. ' +
                      'On failure read inspect_task mode="logs".',
                  },
                  message:
                    `Worker running in an isolated worktree. Poll inspect_task with taskId ` +
                    `"${taskId}" every ~5s until it reaches a terminal state; do other work meanwhile.`,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err: any) {
        let errorMessage = err.message || String(err);
        let errorCode = err.code || 'EXECUTION_FAILED';
        let granularState: GranularTaskState = 'FAILED_WORKER';

        if (err instanceof ModelRouterError) {
          errorCode = 'UNKNOWN_MODEL';
          granularState = 'FAILED_CONTRACT';
        } else if (
          err.code === 'ENOENT' ||
          err.cause?.code === 'ENOENT' ||
          err.code === 'WORKER_NOT_FOUND' ||
          /enoent|not found/i.test(errorMessage)
        ) {
          errorMessage = `Antigravity CLI executable '${process.env.AGY_COMMAND || 'agy'}' was not found. Please ensure agy is installed and in your PATH.`;
          errorCode = 'AGY_NOT_FOUND';
          granularState = 'FAILED_WORKER';
        } else if (isQuotaError(errorMessage)) {
          errorMessage = quotaErrorDetails(errorMessage).message;
          errorCode = 'QUOTA_EXHAUSTED';
          granularState = 'QUOTA_EXHAUSTED';
        } else if (isAuthError(errorMessage)) {
          errorMessage =
            'Antigravity CLI authentication required. Please run "agy login" in your terminal to authenticate.';
          errorCode = 'AUTH_REQUIRED';
          granularState = 'AUTH_REQUIRED';
        }

        const errorDetails: TaskErrorDetails = {
          code: errorCode,
          message: errorMessage,
          category: 'execution',
          stage: granularState,
        };

        components.taskRegistry.transitionTask(taskId, granularState, errorMessage, errorDetails);

        await artifacts
          .saveTaskBundle(taskId, {
            status: 'failed',
            granularStatus: granularState,
            stateHistory: components.taskRegistry.getTask(taskId)?.stateHistory,
            errorDetails,
            timestamps: components.taskRegistry.getTask(taskId)?.timestamps,
            taskType: args.taskType || 'generic',
            objective: args.objective || '',
            repoPath,
          })
          .catch(() => {});

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  taskId,
                  status: 'failed',
                  granularStatus: granularState,
                  stateHistory: components.taskRegistry.getTask(taskId)?.stateHistory,
                  errorDetails,
                  error: errorMessage,
                  code: errorCode,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );
}

