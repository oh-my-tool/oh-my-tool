import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseManifest, validateManifest, checkSdkCompatibility } from "./manifest";

const execFile = promisify(execFileCallback);
const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const OFFICIAL_PACKAGE_RE = /^@oh-my-tool\/[a-z0-9][a-z0-9._-]*$/;
const EXTENSION_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

export interface InstalledRef {
  id: string;
  version: string;
  target: string;
}

export interface NpmExtensionSpec {
  packageName: string;
  npmSpec: string;
  version?: string;
}

export class ExtensionInstallError extends Error {}

export function npmExecutableForPlatform(platform: string = process.platform): string {
  return platform === "win32" ? "npm.cmd" : "npm";
}

export function npmShellForPlatform(platform: string = process.platform): boolean {
  return platform === "win32";
}

export interface NpmInstallDependencies {
  install(spec: string, tempDir: string): Promise<void>;
  execFile?(
    file: string,
    args: string[],
    options: { cwd: string; shell: boolean; timeout: number; maxBuffer: number },
  ): Promise<unknown>;
}

export function normalizeNpmExtensionSpec(spec: string): NpmExtensionSpec {
  const trimmed = spec.trim();
  if (!trimmed) throw new ExtensionInstallError("extension package name must not be empty");

  let packageName = trimmed;
  let version: string | undefined;
  const separator = trimmed.startsWith("@") ? trimmed.lastIndexOf("@") : trimmed.indexOf("@");
  if (separator > 0) {
    packageName = trimmed.slice(0, separator);
    version = trimmed.slice(separator + 1);
    if (!EXACT_VERSION_RE.test(version)) {
      throw new ExtensionInstallError("npm extension versions must be exact semver values, for example 0.3.1");
    }
  }

  if (!trimmed.startsWith("@")) packageName = `@oh-my-tool/${packageName}`;
  if (!OFFICIAL_PACKAGE_RE.test(packageName)) {
    throw new ExtensionInstallError("only official @oh-my-tool extension packages are supported");
  }
  return { packageName, npmSpec: `${packageName}${version === undefined ? "" : `@${version}`}`, ...(version === undefined ? {} : { version }) };
}

async function installExtensionDirectory(home: string, srcDir: string, expectedPackage?: NpmExtensionSpec): Promise<InstalledRef> {
  const manifest = parseManifest(await readFile(join(srcDir, "omt.manifest.json"), "utf8"));
  validateManifest(manifest);
  checkSdkCompatibility(manifest.sdkVersion);
  if (!EXTENSION_ID_RE.test(manifest.id)) throw new ExtensionInstallError(`invalid extension id '${manifest.id}'`);
  if (expectedPackage !== undefined) {
    const packageJson = JSON.parse(await readFile(join(srcDir, "package.json"), "utf8")) as { name?: unknown; version?: unknown };
    if (packageJson.name !== expectedPackage.packageName) {
      throw new ExtensionInstallError(`package manifest mismatch: expected '${expectedPackage.packageName}'`);
    }
    if (packageJson.version !== manifest.version) {
      throw new ExtensionInstallError("package.json and omt.manifest.json versions do not match");
    }
    if (expectedPackage.version !== undefined && packageJson.version !== expectedPackage.version) {
      throw new ExtensionInstallError(`npm package '${expectedPackage.npmSpec}' resolved to an unexpected version`);
    }
  }
  const target = join(home, "extensions", manifest.id, manifest.version);
  await mkdir(target, { recursive: true });
  // 显式 force:true：Bun 的 fs.cp 在带 filter 时默认覆盖失效（重装不更新旧文件）
  await cp(srcDir, target, {
    recursive: true,
    force: true,
    filter: (s: string) => basename(s) !== "node_modules",
  });
  return { id: manifest.id, version: manifest.version, target };
}

export async function installLocalExtension(home: string, srcDir: string): Promise<InstalledRef> {
  return installExtensionDirectory(home, srcDir);
}

export async function installNpmExtension(
  home: string,
  spec: string,
  dependencies: Partial<NpmInstallDependencies> = {},
): Promise<InstalledRef> {
  const normalized = normalizeNpmExtensionSpec(spec);
  const temp = await mkdtemp(join(tmpdir(), "oh-my-tool-npm-"));
  try {
    await writeFile(join(temp, "package.json"), JSON.stringify({ private: true }), "utf8");
    try {
      if (dependencies.install !== undefined) {
        await dependencies.install(normalized.npmSpec, temp);
      } else {
        const runNpm: NonNullable<NpmInstallDependencies["execFile"]> = dependencies.execFile ?? (async (file, args, options) => {
          await execFile(file, args, options);
        });
        await runNpm(npmExecutableForPlatform(), [
          "install",
          "--prefix", ".",
          "--ignore-scripts",
          "--no-save",
          "--no-package-lock",
          "--omit=dev",
          "--registry=https://registry.npmjs.org",
          "--", normalized.npmSpec,
        ], { cwd: temp, timeout: 120_000, maxBuffer: 4 * 1024 * 1024, shell: npmShellForPlatform() });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ExtensionInstallError(`failed to download npm extension '${normalized.npmSpec}': ${message}`);
    }

    const packageDir = join(temp, "node_modules", ...normalized.packageName.split("/"));
    try {
      await stat(packageDir);
    } catch {
      throw new ExtensionInstallError(`npm extension '${normalized.npmSpec}' was not installed`);
    }
    return await installExtensionDirectory(home, packageDir, normalized);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export async function installExtension(home: string, spec: string): Promise<InstalledRef> {
  const candidate = resolve(spec);
  let isLocal = false;
  try {
    await stat(join(candidate, "omt.manifest.json"));
    isLocal = true;
  } catch {
    // Not a local extension directory; interpret the argument as an npm spec.
  }
  return isLocal ? installLocalExtension(home, candidate) : installNpmExtension(home, spec);
}
