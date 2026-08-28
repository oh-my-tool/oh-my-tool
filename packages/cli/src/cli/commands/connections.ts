import { loadConfig } from "../../config/config";
import { createPaths } from "../../paths";
import { prepareHome } from "../../migration";
import { withRuntime } from "../context";

export interface ConnectionSummary {
  extension: string;
  name: string;
  environment: string;
  host: string;
  port: number;
  database: string;
  username: string;
  tls: boolean;
  secretConfigured: boolean;
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
  const connections = Object.entries(config.extensions)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([extension, value]) => Object.entries(value.connections)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, connection]) => ({
        extension,
        name,
        environment: connection.environment,
        host: connection.host,
        port: connection.port,
        database: connection.database,
        username: connection.username,
        tls: connection.tls,
        secretConfigured: connection.secret.length > 0,
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
  return {
    valid: true,
    connectionCount: Object.values(config.extensions).reduce((count, extension) => count + Object.keys(extension.connections).length, 0),
    extensionCount: Object.keys(config.extensions).length,
  };
}

export async function runConnectionCheck(): Promise<ConnectionCheckResult> {
  const list = await configuredConnections();
  return withRuntime(async (runtime) => {
    const checks: ConnectionCheck[] = [];
    for (const connection of list.connections) {
      const started = Date.now();
      const result = await runtime.run(`${connection.extension}.ping`, { connection: connection.name });
      checks.push(result.ok
        ? { extension: connection.extension, name: connection.name, status: "ok", durationMs: Date.now() - started }
        : result.error?.code === "TOOL_NOT_FOUND"
          ? { extension: connection.extension, name: connection.name, status: "unsupported", code: "CHECK_UNSUPPORTED" }
          : { extension: connection.extension, name: connection.name, status: "error", code: result.error?.code ?? "CHECK_FAILED", durationMs: Date.now() - started });
    }
    return { checks, count: checks.length };
  }, { includeMcp: false });
}
