import { OMT_API_VERSION, type ExtensionManifest } from "@oh-my-tool/sdk";

export class ManifestError extends Error {}

export function parseManifest(raw: string): ExtensionManifest {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ManifestError("manifest is not valid JSON");
  }
  const obj = data as Partial<ExtensionManifest>;
  if (!obj.id || typeof obj.id !== "string") {
    throw new ManifestError("manifest must contain a string 'id'");
  }
  if (!Array.isArray(obj.tools)) {
    throw new ManifestError("manifest must contain a 'tools' array");
  }
  return obj as ExtensionManifest;
}

export function validateManifest(manifest: ExtensionManifest): void {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(manifest.id)) {
    throw new ManifestError("manifest 'id' must contain only lowercase letters, numbers, underscores, and hyphens");
  }
  if (!manifest.name || typeof manifest.name !== "string") {
    throw new ManifestError("manifest must contain a string 'name'");
  }
  if (!manifest.version || typeof manifest.version !== "string") {
    throw new ManifestError("manifest must contain a string 'version'");
  }
  if (!FULL_VERSION_RE.test(manifest.version)) {
    throw new ManifestError(`invalid manifest version '${manifest.version}'`);
  }
  if (!manifest.sdkVersion || typeof manifest.sdkVersion !== "string") {
    throw new ManifestError("manifest must contain a string 'sdkVersion'");
  }

  const seen = new Set<string>();
  for (const tool of manifest.tools) {
    if (!tool.name || typeof tool.name !== "string") {
      throw new ManifestError("each tool must have a string 'name'");
    }
    if (seen.has(tool.name)) {
      throw new ManifestError(`duplicate tool name '${tool.name}'`);
    }
    seen.add(tool.name);

    const prefix = `${manifest.id}.`;
    if (!tool.name.startsWith(prefix)) {
      throw new ManifestError(
        `tool '${tool.name}' must be prefixed by extension id '${manifest.id}.'`,
      );
    }
  }
}

const FULL_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PARTIAL_VERSION_RE = /^(\d+|x|X|\*)(\.(\d+|x|X|\*))?(\.(\d+|x|X|\*))?$/;

function isValidVersionToken(token: string): boolean {
  return FULL_VERSION_RE.test(token) || PARTIAL_VERSION_RE.test(token);
}

function isValidSemverRange(range: string): boolean {
  const trimmed = range.trim();
  if (!trimmed) return false;
  for (const orPart of trimmed.split("||")) {
    const pieces = orPart.trim().split(/\s+/).filter(Boolean);
    if (pieces.length === 0) return false;
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      if (piece === "-") {
        if (i === 0 || i === pieces.length - 1) return false;
        continue;
      }
      const m = piece.match(/^(>=|<=|>|<|=|\^|~)?(.*)$/);
      if (!m || m[2] === "" || !isValidVersionToken(m[2])) return false;
    }
  }
  return true;
}

export function checkSdkCompatibility(requiredRange: string): void {
  if (typeof requiredRange !== "string" || requiredRange.trim() === "") {
    throw new ManifestError("extension must declare a non-empty 'sdkVersion'");
  }
  if (!isValidSemverRange(requiredRange)) {
    throw new ManifestError(
      `invalid sdkVersion '${requiredRange}': not a valid semver range`,
    );
  }
  if (!Bun.semver.satisfies(OMT_API_VERSION, requiredRange)) {
    throw new ManifestError(
      `extension requires sdk '${requiredRange}' but core provides '${OMT_API_VERSION}'`,
    );
  }
}

export function validateHandlers(
  manifest: ExtensionManifest,
  handlerNames: string[],
): void {
  const handlerSet = new Set(handlerNames);
  const manifestSet = new Set(manifest.tools.map((t) => t.name));

  for (const name of manifest.tools.map((t) => t.name)) {
    if (!handlerSet.has(name)) {
      throw new ManifestError(
        `manifest declares tool '${name}' but runtime has no handler`,
      );
    }
  }
  for (const name of handlerNames) {
    if (!manifestSet.has(name)) {
      throw new ManifestError(
        `runtime registers tool '${name}' not declared in manifest`,
      );
    }
  }
}
