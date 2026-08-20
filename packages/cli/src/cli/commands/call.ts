import { discoverExtensions } from "../../extension/discovery";
import { createRegistry } from "../../core/registry";
import { executeTool } from "../../core/executor";
import { loadConfig } from "../../config/config";
import { SecretsManager } from "../../secrets/secrets";
import { coerceInput } from "../parseArgs";
import { homeDir } from "../context";
import type { OmtResult } from "../../core/result";

export async function runCall(
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
  const deps = {
    registry: createRegistry(discoverExtensions(homeDir())),
    config: loadConfig(homeDir()),
    secrets: new SecretsManager(),
  };
  return executeTool(deps, toolName, input);
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

