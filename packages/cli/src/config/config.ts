import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ConnectionConfig {
  environment: string;
  host: string;
  port: number;
  database: string;
  username: string;
  secret: string;
  tls: boolean;
}

export interface Config {
  extensions: Record<string, { connections: Record<string, ConnectionConfig> }>;
}

export function loadConfig(homeDir: string): Config {
  const path = join(homeDir, "config.toml");
  if (!existsSync(path)) {
    return { extensions: {} };
  }
  const raw = readFileSync(path, "utf8");
  const parsed = Bun.TOML.parse(raw) as Record<string, unknown>;

  const extensions: Config["extensions"] = {};
  const extSection = (parsed as Record<string, any>)["extensions"];
  if (extSection && typeof extSection === "object") {
    for (const [extId, extVal] of Object.entries(extSection)) {
      const connections: Record<string, ConnectionConfig> = {};
      const connSection = (extVal as any)?.["connections"];
      if (connSection && typeof connSection === "object") {
        for (const [name, rawConn] of Object.entries(connSection)) {
          const rc = rawConn as Record<string, any>;
          connections[name] = {
            environment: String(rc.environment ?? ""),
            host: String(rc.host ?? ""),
            port: Number(rc.port ?? 3306),
            database: String(rc.database ?? ""),
            username: String(rc.username ?? ""),
            secret: String(rc.secret ?? ""),
            tls: Boolean(rc.tls ?? false),
          };
        }
      }
      extensions[extId] = { connections };
    }
  }
  return { extensions };
}

export function getConnectionConfig(
  cfg: Config,
  extensionId: string,
  connection: string,
): ConnectionConfig | undefined {
  return cfg.extensions[extensionId]?.connections[connection];
}

export function listConnections(cfg: Config, extensionId: string): string[] {
  const conns = cfg.extensions[extensionId]?.connections ?? {};
  return Object.keys(conns);
}
