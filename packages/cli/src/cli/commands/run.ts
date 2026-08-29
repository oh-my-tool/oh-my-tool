import { coerceInput } from "../parseArgs";
import { withRuntime } from "../context";
import type { ExecutionResult } from "../../runtime/result";

export async function runTool(
  toolName: string,
  keyValues: Record<string, string>,
  useStdin: boolean,
): Promise<ExecutionResult> {
  let input: Record<string, unknown>;
  if (useStdin) {
    input = await readStdinJson();
  } else {
    input = coerceInput(keyValues);
  }
  return withRuntime((runtime) => runtime.run(toolName, input), { targetTool: toolName });
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
