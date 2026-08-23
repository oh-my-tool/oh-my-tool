export class RuntimeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RuntimeError";
  }
}

export { RuntimeError as OmtError };
