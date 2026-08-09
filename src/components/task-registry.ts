import {
  GranularTaskState,
  LegacyTaskStatus,
  StateTransition,
  TaskErrorDetails,
  TaskTimestamps,
  mapGranularToLegacyStatus,
  mapLegacyToGranularStatus,
} from '../types/task.js';

export {
  GranularTaskState,
  LegacyTaskStatus,
  StateTransition,
  TaskErrorDetails,
  TaskTimestamps,
  mapGranularToLegacyStatus,
  mapLegacyToGranularStatus,
};

export interface TaskRecord {
  taskId: string;
  status: LegacyTaskStatus;
  granularStatus: GranularTaskState;
  stateHistory: StateTransition[];
  errorDetails?: TaskErrorDetails;
  timestamps: TaskTimestamps;
  worktreeId?: string;
  workerId?: string;
  repoPath: string;
  taskType: string;
  objective: string;
  createdAt: number;
  revisions: number;
  latestDiff?: string;
  changedFiles?: string[];
  verificationResults?: any[];
  workerOutput?: {
    stdout: string;
    stderr: string;
  };
}

export interface RegisterTaskInput {
  taskId: string;
  repoPath?: string;
  taskType?: string;
  objective?: string;
  status?: LegacyTaskStatus;
  granularStatus?: GranularTaskState;
  stateHistory?: StateTransition[];
  errorDetails?: TaskErrorDetails;
  timestamps?: TaskTimestamps;
  createdAt?: number;
  revisions?: number;
  worktreeId?: string;
  workerId?: string;
  latestDiff?: string;
  changedFiles?: string[];
  verificationResults?: any[];
  workerOutput?: {
    stdout: string;
    stderr: string;
  };
}

export class TaskRegistry {
  private tasks: Map<string, TaskRecord> = new Map();

  public registerTask(input: RegisterTaskInput | TaskRecord): TaskRecord {
    const createdAt = input.createdAt || Date.now();
    const granularStatus =
      input.granularStatus || (input.status ? mapLegacyToGranularStatus(input.status) : 'CREATED');
    const legacyStatus = input.status || mapGranularToLegacyStatus(granularStatus);

    const initialTransition: StateTransition = {
      state: granularStatus,
      fromState: null,
      toState: granularStatus,
      timestamp: new Date(createdAt).toISOString(),
      details: `Task registered with state ${granularStatus}`,
    };

    const record: TaskRecord = {
      taskId: input.taskId,
      status: legacyStatus,
      granularStatus,
      stateHistory:
        input.stateHistory && input.stateHistory.length > 0
          ? input.stateHistory
          : [initialTransition],
      errorDetails: input.errorDetails,
      timestamps: input.timestamps || { createdAt },
      worktreeId: input.worktreeId,
      workerId: input.workerId,
      repoPath: input.repoPath || process.cwd(),
      taskType: input.taskType || 'generic',
      objective: input.objective || '',
      createdAt,
      revisions: input.revisions ?? 0,
      latestDiff: input.latestDiff,
      changedFiles: input.changedFiles,
      verificationResults: input.verificationResults,
      workerOutput: input.workerOutput,
    };

    this.tasks.set(record.taskId, record);
    return record;
  }

  public getTask(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  public transitionTask(
    taskId: string,
    toState: GranularTaskState,
    details?: string,
    errorDetails?: TaskErrorDetails,
    extraUpdates?: Partial<TaskRecord>,
  ): TaskRecord | undefined {
    const existing = this.tasks.get(taskId);
    if (!existing) {
      return undefined;
    }

    const fromState = existing.granularStatus;
    const nowMs = Date.now();
    const timestampStr = new Date(nowMs).toISOString();

    const transition: StateTransition = {
      state: toState,
      fromState,
      toState,
      timestamp: timestampStr,
      details: details || `Transitioned from ${fromState} to ${toState}`,
    };

    const timestamps: TaskTimestamps = { ...existing.timestamps };
    if (toState === 'VALIDATING') timestamps.validatedAt = nowMs;
    else if (toState === 'PREPARING') timestamps.preparedAt = nowMs;
    else if (toState === 'RUNNING') timestamps.startedAt = nowMs;
    else if (toState === 'COLLECTING') timestamps.collectedAt = nowMs;
    else if (toState === 'VERIFYING') timestamps.verifiedAt = nowMs;
    else if (toState === 'COMPLETED' || toState === 'COMPLETED_WITH_WARNINGS')
      timestamps.completedAt = nowMs;
    else if (
      toState.startsWith('FAILED_') ||
      toState === 'AUTH_REQUIRED' ||
      toState === 'CANCELLED'
    )
      timestamps.failedAt = nowMs;

    const legacyStatus = mapGranularToLegacyStatus(toState);
    const updatedError = errorDetails || extraUpdates?.errorDetails || existing.errorDetails;

    const updated: TaskRecord = {
      ...existing,
      ...extraUpdates,
      status: legacyStatus,
      granularStatus: toState,
      stateHistory: [...existing.stateHistory, transition],
      errorDetails: updatedError,
      timestamps,
    };

    this.tasks.set(taskId, updated);
    return updated;
  }

  public updateTask(taskId: string, updates: Partial<TaskRecord>): TaskRecord | undefined {
    const existing = this.tasks.get(taskId);
    if (!existing) {
      return undefined;
    }

    let targetGranular = updates.granularStatus;
    if (!targetGranular && updates.status && updates.status !== existing.status) {
      targetGranular = mapLegacyToGranularStatus(updates.status);
    }

    if (targetGranular && targetGranular !== existing.granularStatus) {
      return this.transitionTask(
        taskId,
        targetGranular,
        `Task updated to ${targetGranular}`,
        updates.errorDetails,
        updates,
      );
    }

    const legacyStatus = updates.granularStatus
      ? mapGranularToLegacyStatus(updates.granularStatus)
      : updates.status || existing.status;

    const updated: TaskRecord = {
      ...existing,
      ...updates,
      status: legacyStatus,
      granularStatus: updates.granularStatus || existing.granularStatus,
    };

    this.tasks.set(taskId, updated);
    return updated;
  }

  public removeTask(taskId: string): boolean {
    return this.tasks.delete(taskId);
  }

  public listTasks(): TaskRecord[] {
    return Array.from(this.tasks.values());
  }
}

