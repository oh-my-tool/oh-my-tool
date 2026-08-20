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

