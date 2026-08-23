export interface OmtOk {
  ok: true;
  tool: string;
  data: unknown;
  meta: Record<string, unknown>;
}

export interface OmtErr {
  ok: false;
  tool: string;
  error: { code: string; message: string; details?: unknown };
}

export type OmtResult = OmtOk | OmtErr;
