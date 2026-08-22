import { coerceInput } from "../parseArgs";
import { createRuntime } from "../context";
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
  const runtime = await createRuntime();
  const result = await runtime.run(toolName, input);
  if (result.ok) {
    return { ok: true, tool: toolName, data: result.output, meta: {} };
  }
  return { ok: false, tool: toolName, error: result.error ?? { code: "EXECUTION_FAILED", message: "execution failed" } };
}

function readStdinJson(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    const stdin = process.stdin;
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk: string) => (data += chunk));
    stdin.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    stdin.on("error", reject);
  });
}
