export interface ToolResult {
  data: unknown;
  meta?: Record<string, unknown>;
}

export interface ExecutionOk {
  ok: true;
  toolId: string;
  output: unknown;
  meta: Record<string, unknown>;
}

export interface ExecutionError {
  ok: false;
  toolId: string;
  error: { code: string; message: string; details?: unknown };
}

export type ExecutionResult = ExecutionOk | ExecutionError;
