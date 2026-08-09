import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GeladaServerComponents } from '../server.js';
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
    .describe('Allowed file paths or glob patterns for worker edits'),
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

export function registerDelegateTaskTool(
  mcpServer: McpServer,
  components: GeladaServerComponents,
): void {
  mcpServer.tool(
    'delegate_task',
    'Delegate a routine coding task to a local worker agent.',
    delegateTaskInputSchema.shape,
    async (args) => {
      const repoPath = args.repoPath ?? process.cwd();
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
        await components.artifactManager
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
        await components.artifactManager
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
        await components.artifactManager
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
          await components.artifactManager
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
        checkFiles: args.allowedPaths,
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
        await components.artifactManager
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

        const promptSections = [
          `Objective: ${args.objective}`,
          args.context ? `Context: ${args.context}` : '',
          args.acceptanceCriteria
            ? `Acceptance Criteria:\n${args.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`
            : '',
          args.allowedPaths ? `Allowed Paths: ${args.allowedPaths.join(', ')}` : '',
          args.disallowedPaths ? `Disallowed Paths: ${args.disallowedPaths.join(', ')}` : '',
        ].filter(Boolean);
        const prompt = promptSections.join('\n\n');

        if (args.repoPath) {
          components.policyEngine.loadProjectPolicy(args.repoPath);
        }

        const effectivePolicy = components.policyEngine.getEffectivePolicy();
        const modelProfile =
          args.modelProfile ?? effectivePolicy.defaultModelProfile ?? 'default';
        const resolvedModel = components.modelRouter.resolveAgyModel(modelProfile);

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
        const workerArgs = ['--model', resolvedModel, '--prompt', prompt];

        const workerHandle = await components.workerDriver.spawnWorker({
          taskId,
          command: workerCommand,
          args: workerArgs,
          cwd: worktree.path,
          timeoutMs: args.timeoutSeconds ? args.timeoutSeconds * 1000 : undefined,
          sandbox: components.policyEngine.config.sandbox,
          sandboxImage: components.policyEngine.config.sandboxImage,
        });

        components.taskRegistry.updateTask(taskId, { workerId: workerHandle.workerId });

        // Run the remainder of the task lifecycle in the background to prevent MCP timeouts
        Promise.resolve().then(async () => {
          try {
            const workerResult = await workerHandle.promise;

            const currentTaskState = components.taskRegistry.getTask(taskId)?.granularStatus;
            if (currentTaskState === 'CANCELLED' || currentTaskState === 'DISCARDED') {
              return; // Task was discarded/cancelled concurrently, abort diff collection
            }

            const combinedOutput = `${workerResult.stderr}\n${workerResult.stdout}`;
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
              await components.artifactManager
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

            if (workerResult.exitCode !== 0) {
              finalGranularState = 'FAILED_WORKER';
              errorDetails = {
                code: 'FAILED_WORKER',
                message: `Worker process exited with non-zero exit code ${workerResult.exitCode}`,
                category: 'execution',
                stage: 'FAILED_WORKER',
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

            components.taskRegistry.transitionTask(
              taskId,
              finalGranularState,
              `Task reached terminal state ${finalGranularState}`,
              errorDetails,
            );

            // 11. Persist artifact bundle
            await components.artifactManager.saveTaskBundle(taskId, {
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

            // 12. Update registry record details
            components.taskRegistry.updateTask(taskId, {
              latestDiff: diffResult.rawDiff,
              changedFiles: diffResult.changedFiles,
              verificationResults,
              workerOutput: {
                stdout: workerResult.stdout,
                stderr: workerResult.stderr,
              },
            });

            // 13. Trigger automatic artifact retention cleanup
            try {
              const effectivePolicy = components.policyEngine.getEffectivePolicy();
              await components.artifactManager.cleanup(effectivePolicy?.retention);
            } catch (cleanupErr) {
              console.warn(`[ArtifactManager] Non-fatal cleanup warning for task ${taskId}:`, cleanupErr);
            }
          } catch (err: any) {
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

            await components.artifactManager
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
                  message: 'Worker spawned in the background. Use inspect_task to check its status.',
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

        if (
          err.code === 'ENOENT' ||
          err.cause?.code === 'ENOENT' ||
          err.code === 'WORKER_NOT_FOUND' ||
          /enoent|not found/i.test(errorMessage)
        ) {
          errorMessage = `Antigravity CLI executable '${process.env.AGY_COMMAND || 'agy'}' was not found. Please ensure agy is installed and in your PATH.`;
          errorCode = 'AGY_NOT_FOUND';
          granularState = 'FAILED_WORKER';
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

        await components.artifactManager
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

