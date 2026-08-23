export interface ToolResult {
  data: unknown;
  meta?: Record<string, unknown>;
}

export interface ExecutionResult {
  ok: boolean;
  toolId: string;
  output?: unknown;
  meta?: Record<string, unknown>;
  error?: { code: string; message: string; details?: unknown };
}
