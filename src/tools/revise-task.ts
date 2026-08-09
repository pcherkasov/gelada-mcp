import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GeladaServerComponents } from '../server.js';
import { isAuthError } from './delegate-task.js';
import {
  GranularTaskState,
  TaskErrorDetails,
  mapGranularToLegacyStatus,
} from '../types/task.js';
export { isAuthError };

export const reviseTaskInputSchema = z.object({
  taskId: z.string().describe('Identifier of the task to revise'),
  revisionNotes: z.string().describe('Feedback and revision instructions for the worker'),
  additionalCriteria: z
    .array(z.string())
    .optional()
    .describe('Additional acceptance criteria for this revision'),
  additionalVerificationCommands: z
    .array(z.string())
    .optional()
    .describe('Additional verification commands'),
});

export type ReviseTaskInput = z.infer<typeof reviseTaskInputSchema>;

export function registerReviseTaskTool(
  mcpServer: McpServer,
  components: GeladaServerComponents,
): void {
  mcpServer.tool(
    'revise_task',
    'Revise an existing delegated task with feedback and revision notes.',
    reviseTaskInputSchema.shape,
    async (args) => {
      // 1. Contract Validation
      const valResult = components.contractValidator.validateReviseTaskPayload(args);
      if (!valResult.valid) {
        const errorDetails: TaskErrorDetails = {
          code: 'FAILED_CONTRACT',
          message: `Revise task payload validation failed: ${valResult.errors.join('; ')}`,
          category: 'contract',
          stage: 'FAILED_CONTRACT',
          raw: valResult.errors,
        };
        if (args.taskId) {
          components.taskRegistry.transitionTask(
            args.taskId,
            'FAILED_CONTRACT',
            errorDetails.message,
            errorDetails,
          );
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  taskId: args.taskId,
                  status: 'failed',
                  granularStatus: 'FAILED_CONTRACT',
                  errorDetails,
                  error: errorDetails.message,
                  validationErrors: valResult.errors,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // 2. Policy Engine Checks
      if (args.additionalVerificationCommands && args.additionalVerificationCommands.length > 0) {
        const cmdPolicy = components.policyEngine.validateVerificationCommands(
          args.additionalVerificationCommands,
        );
        if (!cmdPolicy.allowed) {
          const errorDetails: TaskErrorDetails = {
            code: cmdPolicy.code || 'FAILED_POLICY',
            message: `Verification command policy violation: ${cmdPolicy.reason}`,
            category: 'policy',
            stage: 'FAILED_POLICY',
          };
          if (args.taskId) {
            components.taskRegistry.transitionTask(
              args.taskId,
              'FAILED_POLICY',
              errorDetails.message,
              errorDetails,
            );
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    taskId: args.taskId,
                    status: 'failed',
                    granularStatus: 'FAILED_POLICY',
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

      const task = components.taskRegistry.getTask(args.taskId);
      if (!task) {
        return {
          content: [{ type: 'text', text: `Error: Task ${args.taskId} not found.` }],
        };
      }
      if (!task.worktreeId) {
        return {
          content: [{ type: 'text', text: `Error: Worktree not found for task ${args.taskId}.` }],
        };
      }

      const worktree = components.worktreeManager.getWorktree(task.worktreeId);
      if (!worktree) {
        return {
          content: [{ type: 'text', text: `Error: Worktree data missing for ${task.worktreeId}.` }],
        };
      }

      try {
        // Transition state to PREPARING for revision execution
        components.taskRegistry.transitionTask(
          args.taskId,
          'PREPARING',
          'Preparing revision execution context',
        );

        const promptSections = [
          `Feedback: ${args.revisionNotes}`,
          args.additionalCriteria
            ? `Additional Criteria:\n${args.additionalCriteria.map((c) => `- ${c}`).join('\n')}`
            : '',
        ].filter(Boolean);
        const prompt = promptSections.join('\n\n');

        if (task.repoPath) {
          components.policyEngine.loadProjectPolicy(task.repoPath);
        }
        const effectivePolicy = components.policyEngine.getEffectivePolicy();
        const modelProfile = effectivePolicy.defaultModelProfile ?? 'default';
        const resolvedModel = components.modelRouter.resolveAgyModel(modelProfile);

        // Transition state to READY
        components.taskRegistry.transitionTask(
          args.taskId,
          'READY',
          'Revision prompt constructed and worker ready',
        );

        // Transition state to RUNNING
        components.taskRegistry.transitionTask(
          args.taskId,
          'RUNNING',
          'Spawning worker process for revision',
        );

        const workerCommand = process.env.AGY_COMMAND || 'agy';
        const workerArgs = ['--model', resolvedModel, '--prompt', prompt];

        const workerHandle = await components.workerDriver.spawnWorker({
          taskId: args.taskId,
          command: workerCommand,
          args: workerArgs,
          cwd: worktree.path,
          env: {
            AGY_TASK_MODE: 'revise',
          },
          sandbox: components.policyEngine.config.sandbox,
          sandboxImage: components.policyEngine.config.sandboxImage,
        });

        components.taskRegistry.updateTask(args.taskId, { workerId: workerHandle.workerId });

        const workerResult = await workerHandle.promise;

        const currentTaskState = components.taskRegistry.getTask(args.taskId)?.granularStatus;
        if (currentTaskState === 'CANCELLED' || currentTaskState === 'DISCARDED') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  taskId: args.taskId,
                  status: 'failed',
                  granularStatus: currentTaskState,
                  message: `Task was ${currentTaskState.toLowerCase()} during revision worker execution.`
                }, null, 2),
              },
            ],
          };
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
            args.taskId,
            'AUTH_REQUIRED',
            errorDetails.message,
            errorDetails,
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    taskId: args.taskId,
                    status: 'failed',
                    granularStatus: 'AUTH_REQUIRED',
                    errorDetails,
                    error: errorDetails.message,
                    code: 'AUTH_REQUIRED',
                    details: workerResult.stderr || workerResult.stdout,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // Transition to COLLECTING
        components.taskRegistry.transitionTask(
          args.taskId,
          'COLLECTING',
          'Gathering git patch diff for revision',
        );

        const diffResult = await components.worktreeManager.getDiffDetails(task.worktreeId);

        let verificationResults: any[] = task.verificationResults || [];
        if (args.additionalVerificationCommands && args.additionalVerificationCommands.length > 0) {
          components.taskRegistry.transitionTask(
            args.taskId,
            'VERIFYING',
            'Running additional verification suite for revision',
          );
          const vRes = await components.verificationEngine.verifyWorktree(
            worktree.path,
            args.additionalVerificationCommands,
          );
          verificationResults = [...verificationResults, ...vRes.results];
        }

        let finalGranularState: GranularTaskState = 'COMPLETED';
        let errorDetails: TaskErrorDetails | undefined = undefined;

        if (workerResult.exitCode !== 0) {
          finalGranularState = 'FAILED_WORKER';
          errorDetails = {
            code: 'FAILED_WORKER',
            message: `Worker process exited with code ${workerResult.exitCode}`,
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
            message: 'One or more verification commands failed during revision',
            category: 'verification',
            stage: 'FAILED_VERIFICATION',
          };
        }

        const finalLegacyStatus = mapGranularToLegacyStatus(finalGranularState);
        const newRevisions = task.revisions + 1;

        // Save revision artifacts to .gelada/artifacts/<taskId>/revisions/rev_<N>_*
        await components.artifactManager.saveArtifact(`rev_${newRevisions}_prompt`, prompt, {
          taskId: args.taskId,
          category: 'prompt',
          filename: `revisions/rev_${newRevisions}_prompt.txt`,
        });

        await components.artifactManager.saveArtifact(
          `rev_${newRevisions}_patch`,
          diffResult.rawDiff,
          {
            taskId: args.taskId,
            category: 'diff',
            contentType: 'text/x-diff',
            filename: `revisions/rev_${newRevisions}_patch.diff`,
          },
        );

        await components.artifactManager.saveArtifact(
          `rev_${newRevisions}_stdout`,
          workerResult.stdout,
          {
            taskId: args.taskId,
            category: 'log',
            filename: `revisions/rev_${newRevisions}_stdout.log`,
          },
        );

        await components.artifactManager.saveArtifact(
          `rev_${newRevisions}_stderr`,
          workerResult.stderr,
          {
            taskId: args.taskId,
            category: 'log',
            filename: `revisions/rev_${newRevisions}_stderr.log`,
          },
        );

        if (verificationResults && verificationResults.length > 0) {
          await components.artifactManager.saveArtifact(
            `rev_${newRevisions}_verification`,
            verificationResults,
            {
              taskId: args.taskId,
              category: 'verification',
              filename: `revisions/rev_${newRevisions}_verification.json`,
            },
          );
        }

        components.taskRegistry.transitionTask(
          args.taskId,
          finalGranularState,
          `Revision ${newRevisions} finished with state ${finalGranularState}`,
          errorDetails,
        );

        const updatedTask = components.taskRegistry.getTask(args.taskId);

        try {
          const metaStr = await components.artifactManager.getArtifact('metadata', args.taskId);
          if (metaStr) {
            const meta = JSON.parse(metaStr);
            meta.status = finalLegacyStatus;
            meta.granularStatus = finalGranularState;
            meta.stateHistory = updatedTask?.stateHistory;
            meta.errorDetails = errorDetails;
            meta.timestamps = updatedTask?.timestamps;
            meta.revisions = newRevisions;
            meta.updatedAt = Date.now();
            meta.changedFiles = diffResult.changedFiles;
            await components.artifactManager.saveArtifact('metadata', meta, {
              taskId: args.taskId,
              category: 'metadata',
              filename: 'metadata.json',
            });
          }
        } catch {
          // ignore if metadata does not exist
        }

        components.taskRegistry.updateTask(args.taskId, {
          revisions: newRevisions,
          latestDiff: diffResult.rawDiff,
          changedFiles: diffResult.changedFiles,
          verificationResults,
          workerOutput: {
            stdout: workerResult.stdout,
            stderr: workerResult.stderr,
          },
        });

        // Trigger automatic artifact retention cleanup
        try {
          const effectivePolicy = components.policyEngine.getEffectivePolicy();
          await components.artifactManager.cleanup(effectivePolicy?.retention);
        } catch (cleanupErr) {
          console.warn(`[ArtifactManager] Non-fatal cleanup warning for task ${args.taskId}:`, cleanupErr);
        }

        const result = {
          taskId: args.taskId,
          status: finalLegacyStatus,
          granularStatus: finalGranularState,
          stateHistory: updatedTask?.stateHistory,
          errorDetails,
          revisionCount: newRevisions,
          notes: `Revision applied: ${args.revisionNotes}`,
          changedFiles: diffResult.changedFiles,
          diff: diffResult.rawDiff,
          verificationResults,
          workerOutput: workerResult.stdout,
          stderr: workerResult.stderr,
          nextAction: 'Inspect task or provide further revision.',
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
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

        components.taskRegistry.transitionTask(
          args.taskId,
          granularState,
          errorMessage,
          errorDetails,
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  taskId: args.taskId,
                  status: 'failed',
                  granularStatus: granularState,
                  stateHistory: components.taskRegistry.getTask(args.taskId)?.stateHistory,
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
