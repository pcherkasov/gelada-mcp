export type GranularTaskState =
  | 'CREATED'
  | 'VALIDATING'
  | 'PREPARING'
  | 'READY'
  | 'RUNNING'
  | 'COLLECTING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'COMPLETED_WITH_WARNINGS'
  | 'REVISION_REQUIRED'
  | 'FAILED_CONTRACT'
  | 'FAILED_WORKER'
  | 'FAILED_POLICY'
  | 'FAILED_VERIFICATION'
  | 'AUTH_REQUIRED'
  // Distinct from AUTH_REQUIRED and from FAILED_WORKER on purpose. Nothing is
  // wrong with the task or the credentials: the worker's model quota ran out,
  // and the same task will succeed once the window resets. A leader agent needs
  // to branch on that — retrying immediately fails again, and rewriting the task
  // fixes nothing.
  | 'QUOTA_EXHAUSTED'
  | 'CANCELLED'
  | 'DISCARDED';

export type LegacyTaskStatus = 'running' | 'completed' | 'failed' | 'discarded' | 'revised';

export interface StateTransition {
  state: GranularTaskState;
  fromState?: GranularTaskState | null;
  toState?: GranularTaskState;
  timestamp: string;
  details?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskErrorDetails {
  code: string;
  message: string;
  category?: string;
  stage?: GranularTaskState;
  possibleCause?: string;
  recommendedAction?: string;
  logPath?: string;
  worktreeSaved?: boolean;
  raw?: any;
}

export interface TaskTimestamps {
  createdAt: number;
  validatedAt?: number;
  preparedAt?: number;
  startedAt?: number;
  collectedAt?: number;
  verifiedAt?: number;
  completedAt?: number;
  failedAt?: number;
}

export function mapGranularToLegacyStatus(granularStatus: GranularTaskState): LegacyTaskStatus {
  switch (granularStatus) {
    case 'CREATED':
    case 'VALIDATING':
    case 'PREPARING':
    case 'READY':
    case 'RUNNING':
    case 'COLLECTING':
    case 'VERIFYING':
      return 'running';
    case 'COMPLETED':
    case 'COMPLETED_WITH_WARNINGS':
      return 'completed';
    case 'REVISION_REQUIRED':
      return 'revised';
    case 'FAILED_CONTRACT':
    case 'FAILED_WORKER':
    case 'FAILED_POLICY':
    case 'FAILED_VERIFICATION':
    case 'AUTH_REQUIRED':
    case 'QUOTA_EXHAUSTED':
    case 'CANCELLED':
      return 'failed';
    case 'DISCARDED':
      return 'discarded';
    default:
      return 'running';
  }
}

export function mapLegacyToGranularStatus(legacyStatus: LegacyTaskStatus): GranularTaskState {
  switch (legacyStatus) {
    case 'running':
      return 'RUNNING';
    case 'completed':
      return 'COMPLETED';
    case 'revised':
      return 'REVISION_REQUIRED';
    case 'failed':
      return 'FAILED_WORKER';
    case 'discarded':
      return 'DISCARDED';
    default:
      return 'RUNNING';
  }
}
