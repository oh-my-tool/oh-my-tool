import { loadConfig, sanitizeExtensionConnections, validateConfiguredConnections } from "../../config/config";
import { createPaths } from "../../paths";
import { prepareHome } from "../../migration";
import { withRuntime } from "../context";
import { discoverExtensions } from "../../extension/discovery";

export interface ConnectionSummary {
  extension: string;
  name: string;
  environment?: string;
  settings: Record<string, unknown>;
  secretsConfigured: Record<string, boolean>;
}

export interface ConnectionListResult {
  connections: ConnectionSummary[];
  count: number;
}

export interface ConnectionCheck {
  extension: string;
  name: string;
  status: "ok" | "error" | "unsupported";
  code?: string;
  durationMs?: number;
}

export interface ConnectionCheckResult {
  checks: ConnectionCheck[];
  count: number;
}

export interface ConfigCheckResult {
  valid: true;
  connectionCount: number;
  extensionCount: number;
}

async function configuredConnections(): Promise<ConnectionListResult> {
  const paths = createPaths();
  await prepareHome(paths);
  const config = loadConfig(paths.home);
  const sanitized = sanitizeExtensionConnections(config);
  const connections = Object.entries(sanitized)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([extension, value]) => Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, connection]) => ({
        extension,
        name,
        ...connection,
      })));
  return { connections, count: connections.length };
}

export async function runConnectionList(): Promise<ConnectionListResult> {
  return configuredConnections();
}

export async function runConfigCheck(): Promise<ConfigCheckResult> {
  const paths = createPaths();
  await prepareHome(paths);
  const config = loadConfig(paths.home);
  validateConfiguredConnections(config, discoverExtensions(paths.home));
  return {
    valid: true,
    connectionCount: Object.values(config.extensions).reduce((count, extension) => count + Object.keys(extension.connections).length, 0),
    extensionCount: Object.keys(config.extensions).length,
  };
}

export async function runConnectionCheck(): Promise<ConnectionCheckResult> {
  const list = await configuredConnections();
  const paths = createPaths();
  const checkTools = new Map(discoverExtensions(paths.home).map((extension) => [extension.id, extension.manifest.connectionCheckTool]));
  return withRuntime(async (runtime) => {
    const checks: ConnectionCheck[] = await boundedMap(list.connections, 4, async (connection) => {
      const toolId = checkTools.get(connection.extension);
      if (!toolId) return { extension: connection.extension, name: connection.name, status: "unsupported", code: "CHECK_UNSUPPORTED" };
      const started = Date.now();
      const result = await runtime.run(toolId, { connection: connection.name });
      return result.ok
        ? { extension: connection.extension, name: connection.name, status: "ok", durationMs: Date.now() - started }
        : { extension: connection.extension, name: connection.name, status: "error", code: result.error.code ?? "CHECK_FAILED", durationMs: Date.now() - started };
    });
    return { checks, count: checks.length };
  }, { includeMcp: false });
}

async function boundedMap<T, R>(values: readonly T[], concurrency: number, worker: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  async function consume(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await worker(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => consume()));
  return results;
}
