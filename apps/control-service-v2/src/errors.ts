export class ControlServiceError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  public constructor(input: {
    message: string;
    statusCode: number;
    code: string;
    details?: Record<string, unknown>;
  }) {
    super(input.message);
    this.name = 'ControlServiceError';
    this.statusCode = input.statusCode;
    this.code = input.code;
    this.details = input.details;
  }
}

export function isControlServiceError(error: unknown): error is ControlServiceError {
  return error instanceof ControlServiceError;
}
