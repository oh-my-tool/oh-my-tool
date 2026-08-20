import { cp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseManifest, validateManifest, checkSdkCompatibility } from "./manifest";

export interface InstalledRef {
  id: string;
  version: string;
  target: string;
}

export async function installLocalExtension(home: string, srcDir: string): Promise<InstalledRef> {
  const manifest = parseManifest(await readFile(join(srcDir, "omt.manifest.json"), "utf8"));
  validateManifest(manifest);
  checkSdkCompatibility(manifest.sdkVersion);
  const target = join(home, "extensions", manifest.id, manifest.version);
  await mkdir(target, { recursive: true });
  await cp(srcDir, target, { recursive: true, filter: (s: string) => !s.includes("node_modules") });
  return { id: manifest.id, version: manifest.version, target };
}