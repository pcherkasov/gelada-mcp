export class GeladaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ContractError extends GeladaError {
  constructor(message: string) {
    super(`Contract Validation Failed: ${message}`);
  }
}

export class PolicyViolationError extends GeladaError {
  constructor(message: string) {
    super(`Policy Violation: ${message}`);
  }
}

export class AuthError extends GeladaError {
  constructor(message: string) {
    super(`Authentication Required: ${message}`);
  }
}

export class WorkerError extends GeladaError {
  constructor(message: string) {
    super(`Worker Error: ${message}`);
  }
}

export class VerificationError extends GeladaError {
  constructor(message: string) {
    super(`Verification Failed: ${message}`);
  }
}

export class ConfigurationError extends GeladaError {
  constructor(message: string) {
    super(`Configuration Error: ${message}`);
  }
}

export class TaskCancelledError extends GeladaError {
  constructor(message: string = 'Task was cancelled') {
    super(`Task Cancelled: ${message}`);
  }
}
