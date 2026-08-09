import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GeladaServerComponents } from '../server.js';
import { z } from 'zod';

export const discardTaskInputSchema = z.object({
  taskId: z.string().describe('Identifier of the task to discard'),
  keepLogs: z.boolean().optional().default(false).describe('Whether to retain logs after cleanup'),
});

export type DiscardTaskInput = z.infer<typeof discardTaskInputSchema>;

export function registerDiscardTaskTool(
  mcpServer: McpServer,
  components: GeladaServerComponents,
): void {
  mcpServer.registerTool(
    'discard_task',
    {
      title: 'Discard a task and free its worktree',
      description:
        'Stop a task if it is still running and delete its worktree. Call this once you have taken what you need from the patch — worktrees are otherwise kept so their changes stay inspectable.\n' +
        '\n' +
        'The patch and logs remain available through inspect_task when keepLogs is set. This does not touch your working tree.',
      inputSchema: discardTaskInputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      const keepLogs = args.keepLogs ?? false;
      const task = components.taskRegistry.getTask(args.taskId);

      let cleanedUp = false;
      let message = `Task ${args.taskId} not found in registry.`;

      if (task) {
        if (task.workerId) {
          components.taskRegistry.transitionTask(
            args.taskId,
            'CANCELLED',
            'Worker process terminated during task discard',
          );
          await components.workerDriver.terminateWorker(task.workerId);
        }
        if (task.worktreeId) {
          await components.worktreeManager.removeWorktree(task.worktreeId, {
            retainOnFailure: keepLogs,
          });
        }
        components.taskRegistry.transitionTask(
          args.taskId,
          'DISCARDED',
          'Task discarded and resources cleaned up',
        );
        cleanedUp = true;
        message = `Task ${args.taskId} and its associated worktree resources have been discarded.`;
      }

      const currentTask = components.taskRegistry.getTask(args.taskId);

      if (keepLogs) {
        try {
          const metaStr = await components.artifactManager.getArtifact('metadata', args.taskId);
          if (metaStr) {
            const meta = JSON.parse(metaStr);
            meta.status = 'discarded';
            meta.granularStatus = 'DISCARDED';
            if (currentTask?.stateHistory) {
              meta.stateHistory = currentTask.stateHistory;
            }
            meta.updatedAt = Date.now();
            await components.artifactManager.saveArtifact('metadata', meta, {
              taskId: args.taskId,
              category: 'metadata',
              filename: 'metadata.json',
            });
          }
        } catch {
          // ignore if metadata file does not exist
        }
      } else {
        try {
          await components.artifactManager.deleteArtifacts(args.taskId);
        } catch {
          // ignore if artifacts directory does not exist
        }
      }

      const result = {
        taskId: args.taskId,
        status: 'discarded',
        granularStatus: 'DISCARDED',
        stateHistory: currentTask?.stateHistory,
        cleanedUp,
        logsRetained: keepLogs,
        message,
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

