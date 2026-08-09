export interface TaskContract {
  taskId: string;
  description: string;
  targetDirectory: string;
  allowedTools?: string[];
  maxDurationSeconds?: number;
}

export interface DelegateTaskPayload {
  repoPath?: string;
  taskType: string;
  objective: string;
  context?: string;
  acceptanceCriteria?: string[];
  allowedPaths?: string[];
  disallowedPaths?: string[];
  verificationCommands?: string[];
  modelProfile?: string;
  timeoutSeconds?: number;
}

export interface ReviseTaskPayload {
  taskId: string;
  revisionNotes: string;
  additionalCriteria?: string[];
  additionalVerificationCommands?: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export class ContractValidator {
  public validateContract(contract: unknown): ValidationResult {
    const errors: string[] = [];

    if (!contract || typeof contract !== 'object') {
      return {
        valid: false,
        errors: ['Contract payload must be a non-null object.'],
      };
    }

    const c = contract as Record<string, unknown>;

    if (!c.taskId || typeof c.taskId !== 'string' || c.taskId.trim() === '') {
      errors.push('Task ID is required and must be a non-empty string.');
    }
    if (!c.description || typeof c.description !== 'string' || c.description.trim() === '') {
      errors.push('Task description is required and must be a non-empty string.');
    }
    if (
      !c.targetDirectory ||
      typeof c.targetDirectory !== 'string' ||
      c.targetDirectory.trim() === ''
    ) {
      errors.push('Target directory is required and must be a non-empty string.');
    }

    if (c.maxDurationSeconds !== undefined) {
      const timeoutRes = this.validateTimeout(c.maxDurationSeconds);
      if (!timeoutRes.valid) {
        errors.push(...timeoutRes.errors);
      }
    }

    if (c.allowedTools !== undefined) {
      const toolsRes = this.validatePaths(c.allowedTools, 'allowedTools');
      if (!toolsRes.valid) {
        errors.push(...toolsRes.errors);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  public validateDelegateTaskPayload(payload: unknown): ValidationResult {
    const errors: string[] = [];

    if (!payload || typeof payload !== 'object') {
      return {
        valid: false,
        errors: ['Delegate task payload must be a non-null object.'],
      };
    }

    const p = payload as Record<string, unknown>;

    // objective
    if (!p.objective || typeof p.objective !== 'string' || p.objective.trim() === '') {
      errors.push('Objective is required and must be a non-empty string.');
    }

    // taskType
    const taskTypeRes = this.validateTaskType(p.taskType);
    if (!taskTypeRes.valid) {
      errors.push(...taskTypeRes.errors);
    }

    // repoPath
    if (p.repoPath !== undefined) {
      if (typeof p.repoPath !== 'string' || p.repoPath.trim() === '') {
        errors.push('repoPath must be a non-empty string if provided.');
      } else if (p.repoPath.includes('\0')) {
        errors.push('repoPath contains illegal characters.');
      }
    }

    // timeoutSeconds
    if (p.timeoutSeconds !== undefined) {
      const timeoutRes = this.validateTimeout(p.timeoutSeconds);
      if (!timeoutRes.valid) {
        errors.push(...timeoutRes.errors);
      }
    }

    // allowedPaths & disallowedPaths
    if (p.allowedPaths !== undefined) {
      const pathsRes = this.validatePaths(p.allowedPaths, 'allowedPaths');
      if (!pathsRes.valid) errors.push(...pathsRes.errors);
    }
    if (p.disallowedPaths !== undefined) {
      const pathsRes = this.validatePaths(p.disallowedPaths, 'disallowedPaths');
      if (!pathsRes.valid) errors.push(...pathsRes.errors);
    }

    // verificationCommands
    if (p.verificationCommands !== undefined) {
      const cmdRes = this.validatePaths(p.verificationCommands, 'verificationCommands');
      if (!cmdRes.valid) errors.push(...cmdRes.errors);
    }

    // acceptanceCriteria
    if (p.acceptanceCriteria !== undefined) {
      const critRes = this.validatePaths(p.acceptanceCriteria, 'acceptanceCriteria');
      if (!critRes.valid) errors.push(...critRes.errors);
    }

    // context
    if (p.context !== undefined && typeof p.context !== 'string') {
      errors.push('context must be a string if provided.');
    }

    // modelProfile
    if (
      p.modelProfile !== undefined &&
      (typeof p.modelProfile !== 'string' || p.modelProfile.trim() === '')
    ) {
      errors.push('modelProfile must be a non-empty string if provided.');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  public validateReviseTaskPayload(payload: unknown): ValidationResult {
    const errors: string[] = [];

    if (!payload || typeof payload !== 'object') {
      return {
        valid: false,
        errors: ['Revise task payload must be a non-null object.'],
      };
    }

    const p = payload as Record<string, unknown>;

    if (!p.taskId || typeof p.taskId !== 'string' || p.taskId.trim() === '') {
      errors.push('taskId is required and must be a non-empty string.');
    }
    if (!p.revisionNotes || typeof p.revisionNotes !== 'string' || p.revisionNotes.trim() === '') {
      errors.push('revisionNotes is required and must be a non-empty string.');
    }

    if (p.additionalCriteria !== undefined) {
      const res = this.validatePaths(p.additionalCriteria, 'additionalCriteria');
      if (!res.valid) errors.push(...res.errors);
    }
    if (p.additionalVerificationCommands !== undefined) {
      const res = this.validatePaths(
        p.additionalVerificationCommands,
        'additionalVerificationCommands',
      );
      if (!res.valid) errors.push(...res.errors);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  public validatePaths(paths?: unknown, fieldName: string = 'paths'): ValidationResult {
    const errors: string[] = [];
    if (!Array.isArray(paths)) {
      return { valid: false, errors: [`${fieldName} must be an array of strings.`] };
    }
    for (let i = 0; i < paths.length; i++) {
      const item = paths[i];
      if (typeof item !== 'string' || item.trim() === '') {
        errors.push(`${fieldName}[${i}] must be a non-empty string.`);
      } else if (item.includes('\0')) {
        errors.push(`${fieldName}[${i}] contains null bytes.`);
      }
    }
    return { valid: errors.length === 0, errors };
  }

  public validateTimeout(timeoutSeconds?: unknown): ValidationResult {
    const errors: string[] = [];
    if (
      typeof timeoutSeconds !== 'number' ||
      !Number.isFinite(timeoutSeconds) ||
      timeoutSeconds <= 0
    ) {
      errors.push('timeoutSeconds must be a positive finite number.');
    } else if (timeoutSeconds > 86400) {
      errors.push('timeoutSeconds exceeds maximum limit of 86400 seconds (24 hours).');
    }
    return { valid: errors.length === 0, errors };
  }

  public validateTaskType(taskType?: unknown): ValidationResult {
    if (typeof taskType !== 'string' || taskType.trim() === '') {
      return { valid: false, errors: ['taskType is required and must be a non-empty string.'] };
    }
    return { valid: true, errors: [] };
  }
}
