import { coerceInput } from "../parseArgs";
import { withRuntime } from "../context";
import type { OmtResult } from "../../core/result";

export async function runTool(
  toolName: string,
  keyValues: Record<string, string>,
  useStdin: boolean,
): Promise<OmtResult> {
  let input: Record<string, unknown>;
  if (useStdin) {
    input = await readStdinJson();
  } else {
    input = coerceInput(keyValues);
  }
  return withRuntime(async (runtime) => {
    const result = await runtime.run(toolName, input);
    if (result.ok) {
      return { ok: true, tool: toolName, data: result.output, meta: result.meta ?? {} };
    }
    return { ok: false, tool: toolName, error: result.error ?? { code: "EXECUTION_FAILED", message: "execution failed" } };
  }, { targetTool: toolName });
}

function readStdinJson(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    const stdin = process.stdin;
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk: string) => (data += chunk));
    stdin.on("end", () => {
      try {
        const parsed: unknown = JSON.parse(data);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new Error("stdin JSON must be an object"));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch (e) {
        reject(e);
      }
    });
    stdin.on("error", reject);
  });
}
