export interface ToolResult {
  data: unknown;
  meta?: Record<string, unknown>;
}

export interface ExecutionResult {
  ok: boolean;
  toolId: string;
  output?: unknown;
  error?: { code: string; message: string };
}
