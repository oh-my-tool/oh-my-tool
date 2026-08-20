import { discoverExtensions } from "../../extension/discovery";
import { installLocalExtension, type InstalledRef } from "../../extension/install";
import { homeDir } from "../context";

export interface InstalledInfo {
  id: string;
  version: string;
  entry: string;
  toolCount: number;
}

export async function runExtensionList(): Promise<InstalledInfo[]> {
  return discoverExtensions(homeDir()).map((e) => ({
    id: e.id,
    version: e.version,
    entry: e.entry,
    toolCount: e.manifest.tools.length,
  }));
}

export async function runExtensionInstall(spec: string): Promise<InstalledRef> {
  return installLocalExtension(homeDir(), spec);
}

