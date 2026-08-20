export interface OmtOk {
  ok: true;
  tool: string;
  data: unknown;
  meta: Record<string, unknown>;
}

export interface OmtErr {
  ok: false;
  tool: string;
  error: { code: string; message: string };
}

export type OmtResult = OmtOk | OmtErr;
