import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GeladaServerComponents } from '../server.js';
import { z } from 'zod';

export const cancelTaskInputSchema = z.object({
  taskId: z.string().describe('Identifier of the task to cancel'),
});

export type CancelTaskInput = z.infer<typeof cancelTaskInputSchema>;

export function registerCancelTaskTool(
  mcpServer: McpServer,
  components: GeladaServerComponents,
): void {
  mcpServer.registerTool(
    'cancel_task',
    {
      title: 'Cancel a running worker',
      description:
        'Terminate a running worker while keeping the task\'s history and worktree, so whatever it produced before being stopped stays inspectable. Use discard_task instead when you also want the worktree gone.',
      inputSchema: cancelTaskInputSchema.shape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      const task = components.taskRegistry.getTask(args.taskId);

      if (!task) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  taskId: args.taskId,
                  status: 'error',
                  message: `Task ${args.taskId} not found in registry.`,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      let canceled = false;
      let message = `Task ${args.taskId} is not in a running state.`;

      if (
        task.granularStatus !== 'COMPLETED' &&
        task.granularStatus !== 'COMPLETED_WITH_WARNINGS' &&
        task.granularStatus !== 'DISCARDED' &&
        task.granularStatus !== 'CANCELLED' &&
        !task.granularStatus.startsWith('FAILED_')
      ) {
        if (task.workerId) {
          await components.workerDriver.terminateWorker(task.workerId);
        }

        components.taskRegistry.transitionTask(
          args.taskId,
          'CANCELLED',
          'Task cancelled by user request',
        );
        canceled = true;
        message = `Task ${args.taskId} has been successfully cancelled.`;
      } else {
        if (task.granularStatus === 'CANCELLED') {
          message = `Task ${args.taskId} is already cancelled.`;
        } else {
          message = `Task ${args.taskId} cannot be cancelled because it is in state ${task.granularStatus}.`;
        }
      }

      const updatedTask = components.taskRegistry.getTask(args.taskId);

      const result = {
        taskId: args.taskId,
        status: updatedTask?.status || 'cancelled',
        granularStatus: updatedTask?.granularStatus || 'CANCELLED',
        stateHistory: updatedTask?.stateHistory,
        canceled,
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
