import { SecretsManager } from "../../secrets/secrets";
import type { SecretStore } from "@oh-my-tool/sdk";

export interface SecretSetResult {
  ok: true;
  name: string;
}

export async function runSecretSet(
  name: string,
  value: string,
  store?: SecretStore,
): Promise<SecretSetResult> {
  const mgr = new SecretsManager(store);
  await mgr.set(name, value);
  return { ok: true, name };
}

export interface SecretListResult {
  names: string[];
  supported: boolean;
  hint?: string;
}

/** 从 cmdkey /list 输出解析 oh-my-tool 命名空间下的 secret 名（不返回值）。 */
export function parseSecretNamesFromCmdkey(output: string): string[] {
  const names = new Set<string>();
  const re = /oh-my-tool\/([A-Za-z0-9:._@-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    names.add(m[1]);
  }
  return [...names].sort();
}

type CmdkeyExec = (args: string[]) => Promise<string>;

async function defaultCmdkeyList(): Promise<string> {
  const proc = Bun.spawn(["cmdkey", "/list"], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`cmdkey /list exited ${code}`);
  return out;
}

/**
 * 列出已设置的 secret 名（只列名、不显值）。
 * Bun.secrets 无枚举 API，Windows 下通过 cmdkey 解析 oh-my-tool/ 前缀；
 * 非 Windows 不支持枚举，返回 supported=false。
 */
export async function runSecretList(
  exec: CmdkeyExec = defaultCmdkeyList,
): Promise<SecretListResult> {
  if (process.platform !== "win32") {
    return {
      names: [],
      supported: false,
      hint: "Bun.secrets 无枚举 API；secret list 仅在 Windows（通过 cmdkey）支持",
    };
  }
  try {
    const out = await exec(["cmdkey", "/list"]);
    return { names: parseSecretNamesFromCmdkey(out), supported: true };
  } catch (e) {
    return {
      names: [],
      supported: false,
      hint: `cmdkey 调用失败: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
