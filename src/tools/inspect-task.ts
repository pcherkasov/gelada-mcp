import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GeladaServerComponents } from '../server.js';
import { mapLegacyToGranularStatus } from '../types/task.js';

export const inspectTaskInputSchema = z.object({
  taskId: z.string().describe('Identifier of the task to inspect'),
  mode: z
    .enum(['summary', 'diff', 'files', 'verifications', 'logs', 'history'])
    .optional()
    .default('summary')
    .describe('Inspection detail mode'),
});

export type InspectTaskInput = z.infer<typeof inspectTaskInputSchema>;

export function registerInspectTaskTool(
  mcpServer: McpServer,
  components: GeladaServerComponents,
): void {
  mcpServer.tool(
    'inspect_task',
    'Inspect state, diff, verification results, or logs of a delegated task.',
    inspectTaskInputSchema.shape,
    async (args) => {
      const mode = args.mode ?? 'summary';
      const task = components.taskRegistry.getTask(args.taskId);
      const artifacts = await components.artifactManager.listArtifacts(args.taskId).catch(() => []);

      if (!task && artifacts.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Task ${args.taskId} not found in registry or artifacts.`,
            },
          ],
        };
      }

      let artifactMeta: any = null;
      try {
        const metaStr = await components.artifactManager.getArtifact('metadata', args.taskId);
        if (metaStr) {
          artifactMeta = JSON.parse(metaStr);
        }
      } catch {
        // ignore JSON parse error
      }

      const repoPath = task?.repoPath || artifactMeta?.repoPath || process.cwd();
      const currentStatus = task?.status || artifactMeta?.status || 'unknown';
      const granularStatus =
        task?.granularStatus ||
        artifactMeta?.granularStatus ||
        mapLegacyToGranularStatus(currentStatus as any);
      const stateHistory = task?.stateHistory || artifactMeta?.stateHistory || [];
      const errorDetails = task?.errorDetails || artifactMeta?.errorDetails;
      const timestamps = task?.timestamps || artifactMeta?.timestamps;
      const currentObjective = task?.objective || artifactMeta?.objective || '';
      const currentRevisions = task?.revisions ?? artifactMeta?.revisions ?? 0;
      const changedFiles = task?.changedFiles || artifactMeta?.changedFiles || [];

      let details: any = {};

      switch (mode) {
        case 'summary': {
          let repoState: any = null;
          try {
            repoState = await components.repositoryInspector.inspectRepo(repoPath);
          } catch {
            // repo path might not exist or not be git repo
          }

          let verificationPassed: boolean | null = null;
          let verifications: any[] | undefined = task?.verificationResults;
          if (!verifications) {
            try {
              const vStr = await components.artifactManager.getArtifact(
                'verification_results',
                args.taskId,
              );
              if (vStr) verifications = JSON.parse(vStr);
            } catch {
              // ignore
            }
          }
          if (verifications && verifications.length > 0) {
            verificationPassed = verifications.every((r: any) => r.passed);
          }

          details = {
            objective: currentObjective,
            status: currentStatus,
            granularStatus,
            stateHistory,
            errorDetails,
            revisions: currentRevisions,
            changedFiles,
            diffSummary:
              changedFiles.length > 0 ? `${changedFiles.length} file(s) changed` : 'No changes yet',
            verificationPassed,
            repoState: repoState
              ? {
                  branch: repoState.currentBranch,
                  isClean: repoState.isClean,
                  commitHash: repoState.shortCommitHash,
                }
              : null,
            artifactsCount: artifacts.length,
          };
          break;
        }
        case 'diff': {
          let patch = task?.latestDiff;
          if (!patch) {
            patch =
              (await components.artifactManager.getArtifact('patch', args.taskId)) ||
              'No diff available';
          }
          details = {
            diff: patch,
            granularStatus,
          };
          break;
        }
        case 'files': {
          let fileChecks: any = null;
          if (changedFiles.length > 0) {
            try {
              fileChecks = await components.repositoryInspector.checkFilesExist(
                repoPath,
                changedFiles,
              );
            } catch {
              // ignore
            }
          }
          details = {
            changedFiles,
            fileChecks: fileChecks || [],
            granularStatus,
          };
          break;
        }
        case 'verifications': {
          let verifications: any[] | null = task?.verificationResults || null;
          if (!verifications) {
            try {
              const vStr = await components.artifactManager.getArtifact(
                'verification_results',
                args.taskId,
              );
              if (vStr) verifications = JSON.parse(vStr);
            } catch {
              // ignore
            }
          }
          details = {
            verificationResults: verifications || [],
            granularStatus,
          };
          break;
        }
        case 'logs': {
          let stdout = task?.workerOutput?.stdout;
          let stderr = task?.workerOutput?.stderr;

          if (stdout === undefined) {
            stdout =
              (await components.artifactManager.getArtifact('worker_stdout', args.taskId)) || '';
          }
          if (stderr === undefined) {
            stderr =
              (await components.artifactManager.getArtifact('worker_stderr', args.taskId)) || '';
          }

          details = {
            stdout,
            stderr,
            granularStatus,
            errorDetails,
          };
          break;
        }
        case 'history': {
          details = {
            createdAt: task?.createdAt
              ? new Date(task.createdAt).toISOString()
              : artifactMeta?.createdAt
                ? new Date(artifactMeta.createdAt).toISOString()
                : null,
            revisions: currentRevisions,
            status: currentStatus,
            granularStatus,
            stateHistory,
            errorDetails,
            timestamps,
            artifacts: artifacts.map((a) => ({
              artifactId: a.artifactId,
              filename: a.filename,
              category: a.category,
              sizeBytes: a.sizeBytes,
              createdAt: new Date(a.createdAt).toISOString(),
            })),
          };
          break;
        }
      }

      const result = {
        taskId: args.taskId,
        mode,
        status: currentStatus,
        granularStatus,
        stateHistory,
        errorDetails,
        details,
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

