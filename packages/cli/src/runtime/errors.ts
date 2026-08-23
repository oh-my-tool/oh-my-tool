export class RuntimeError extends Error {
  constructor(public readonly code: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "RuntimeError";
  }
}

export { RuntimeError as OmtError };
