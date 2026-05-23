/**
 * Pi Forge Custom Error Types
 */

export class ForgeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ForgeError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ConfigError extends ForgeError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONFIG_ERROR', context);
    this.name = 'ConfigError';
  }
}

export class GitError extends ForgeError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'GIT_ERROR', context);
    this.name = 'GitError';
  }
}

export class GateError extends ForgeError {
  constructor(
    message: string,
    public readonly gate: string,
    public readonly exitCode: number,
    public readonly output: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'GATE_ERROR', context);
    this.name = 'GateError';
  }
}

export class ValidationError extends ForgeError {
  constructor(message: string, public readonly issues: string[], context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', context);
    this.name = 'ValidationError';
  }
}

export class OrchestratorError extends ForgeError {
  constructor(message: string, code?: string, context?: Record<string, unknown>) {
    super(message, code ?? 'ORCHESTRATOR_ERROR', context);
    this.name = 'OrchestratorError';
  }
}

export class StateError extends ForgeError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'STATE_ERROR', context);
    this.name = 'StateError';
  }
}
