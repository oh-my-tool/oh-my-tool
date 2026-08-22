export class RuntimeError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "RuntimeError";
  }
}

export { RuntimeError as OmtError };
