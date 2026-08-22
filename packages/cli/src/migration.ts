import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { OhMyToolPaths } from "./paths";

export type MigrationStatus =
  | "migrated"
  | "skipped-custom-home"
  | "skipped-no-legacy"
  | "skipped-destination-exists";

export interface MigrationResult {
  readonly status: MigrationStatus;
  readonly legacyHome: string;
  readonly home: string;
  readonly legacyPreserved: true;
}

const KNOWN_STATE = ["config.toml", "extensions", "integrations", "cache", "logs"];

export async function migrateLegacyHome(paths: OhMyToolPaths): Promise<MigrationResult> {
  const base = { legacyHome: paths.legacyHome, home: paths.home, legacyPreserved: true as const };
  if (paths.isCustomHome) return { ...base, status: "skipped-custom-home" };
  if (!existsSync(paths.legacyHome)) return { ...base, status: "skipped-no-legacy" };
  if (existsSync(paths.home)) return { ...base, status: "skipped-destination-exists" };

  mkdirSync(paths.home, { recursive: true });
  for (const name of KNOWN_STATE) {
    const source = join(paths.legacyHome, name);
    if (!existsSync(source)) continue;
    const destination = join(paths.home, name);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true, errorOnExist: true });
  }
  return { ...base, status: "migrated" };
}

export async function prepareHome(paths: OhMyToolPaths): Promise<MigrationResult> {
  const migration = await migrateLegacyHome(paths);
  mkdirSync(paths.home, { recursive: true });
  for (const directory of [paths.extensions, paths.integrations, dirname(paths.audit)]) {
    mkdirSync(directory, { recursive: true });
  }
  return migration;
}
