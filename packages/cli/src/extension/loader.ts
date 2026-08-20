import { pathToFileURL } from "node:url";
import type { ExtensionDefinition } from "@oh-my-tool/sdk";
import { OmtError } from "../core/registry";
import type { InstalledExtension } from "./discovery";
import { validateHandlers } from "./manifest";

export async function loadExtension(
  installed: InstalledExtension,
): Promise<ExtensionDefinition> {
  let mod: unknown;
  try {
    mod = await import(pathToFileURL(installed.entry).href);
  } catch (e) {
    throw new OmtError(
      "LOAD_FAILED",
      `failed to load extension '${installed.id}': ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const def = (mod as any)?.default ?? mod;
  if (!def || typeof def.handlers !== "object" || def.handlers === null) {
    throw new OmtError("LOAD_FAILED", `extension '${installed.id}' has no handlers`);
  }

  const handlerNames = Object.keys(def.handlers);
  try {
    validateHandlers(installed.manifest, handlerNames);
  } catch (e) {
    throw new OmtError("LOAD_FAILED", (e as Error).message);
  }
  return def as ExtensionDefinition;
}
