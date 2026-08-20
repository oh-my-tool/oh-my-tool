import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionManifest } from "@oh-my-tool/sdk";
import { parseManifest, validateManifest, checkSdkCompatibility } from "./manifest";

export interface InstalledExtension {
  id: string;
  version: string;
  dir: string;
  manifest: ExtensionManifest;
  entry: string;
}

const EXTENSIONS_DIR = "extensions";

function readEntry(dir: string): string {
  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, any>;
      const entry = pkg.omt?.entry;
      if (typeof entry === "string") {
        return join(dir, entry.replace(/^\.\//, ""));
      }
    } catch {
      // ignore malformed package.json, fall through
    }
  }
  return join(dir, "src", "index.ts");
}

export function discoverExtensions(home: string): InstalledExtension[] {
  const root = join(home, EXTENSIONS_DIR);
  if (!existsSync(root)) return [];

  const out: InstalledExtension[] = [];
  for (const id of readdirSync(root)) {
    const idDir = join(root, id);
    if (!statSync(idDir).isDirectory()) continue;
    for (const version of readdirSync(idDir)) {
      const versionDir = join(idDir, version);
      if (!statSync(versionDir).isDirectory()) continue;
      const manifestPath = join(versionDir, "omt.manifest.json");
      if (!existsSync(manifestPath)) continue;
      try {
        const manifest = parseManifest(readFileSync(manifestPath, "utf8"));
        validateManifest(manifest);
        checkSdkCompatibility(manifest.sdkVersion);
        out.push({
          id,
          version,
          dir: versionDir,
          manifest,
          entry: readEntry(versionDir),
        });
      } catch {
        // skip invalid or incompatible manifests
      }
    }
  }
  return out;
}