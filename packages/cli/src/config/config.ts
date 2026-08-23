import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RuntimeError } from "../runtime/errors";

export interface ConnectionConfig {
  environment: string;
  host: string;
  port: number;
  database: string;
  username: string;
  secret: string;
  tls: boolean;
}

export interface McpCommonServerConfig { readonly enabled: boolean; readonly namespace: string; }
export interface McpStdioServerConfig extends McpCommonServerConfig {
  readonly transport: "stdio"; readonly command: string; readonly args: readonly string[]; readonly cwd?: string;
  readonly env: Readonly<Record<string, string>>; readonly secretEnv: Readonly<Record<string, string>>;
}
export interface McpHttpServerConfig extends McpCommonServerConfig {
  readonly transport: "streamable-http"; readonly url: string; readonly headers: Readonly<Record<string, string>>;
  readonly secretHeaders: Readonly<Record<string, string>>; readonly auth: McpHttpAuthConfig;
}
export type McpHttpAuthConfig =
  | { readonly type: "none" }
  | { readonly type: "bearer"; readonly tokenSecret: string }
  | { readonly type: "oauth"; readonly scopes: readonly string[]; readonly callbackPort: number; readonly clientId?: string; readonly clientSecretSecret?: string; readonly tokenEndpointAuthMethod: "none" | "client_secret_basic" | "client_secret_post" };
export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;
export interface Config {
  extensions: Record<string, { connections: Record<string, ConnectionConfig> }>;
  mcp: { servers: Record<string, McpServerConfig> };
}

function invalid(path: string, reason: string): never { throw new RuntimeError("MCP_INVALID_CONFIG", `${path}: ${reason}`); }

function parseStringMap(value: unknown, path: string): Record<string, string> {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(path, "must be a table");
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "string") invalid(`${path}.${key}`, "must be a string");
    result[key] = entry;
  }
  return result;
}

function parseStringArray(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) invalid(path, "must be an array of strings");
  return [...value];
}

function assertMcpName(value: string, path: string): void {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(value)) {
    invalid(path, "must contain only lowercase letters, numbers, underscores, and hyphens");
  }
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) invalid(path, "must be a non-empty string");
  return value;
}

function parseMcpServer(id: string, value: unknown): McpServerConfig {
  const path = `mcp.servers.${id}`;
  assertMcpName(id, path);
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(path, "must be a table");
  const raw = value as Record<string, unknown>;
  const namespace = raw.namespace === undefined ? id : requiredString(raw.namespace, `${path}.namespace`);
  assertMcpName(namespace, `${path}.namespace`);
  if (namespace === "native" || namespace === "mcp") invalid(`${path}.namespace`, "is reserved");
  const enabled = raw.enabled === undefined ? true : raw.enabled;
  if (typeof enabled !== "boolean") invalid(`${path}.enabled`, "must be a boolean");

  if (raw.transport === "stdio") {
    if (raw.auth !== undefined) invalid(`${path}.auth`, "is only supported for HTTP servers");
    const command = requiredString(raw.command, `${path}.command`);
    const args = parseStringArray(raw.args, `${path}.args`);
    const cwd = raw.cwd === undefined ? undefined : requiredString(raw.cwd, `${path}.cwd`);
    return { enabled, transport: "stdio", command, args, ...(cwd === undefined ? {} : { cwd }), namespace, env: parseStringMap(raw.env, `${path}.env`), secretEnv: parseStringMap(raw.secretEnv, `${path}.secretEnv`) };
  }
  if (raw.transport !== "streamable-http") invalid(`${path}.transport`, "must be stdio or streamable-http");
  const url = requiredString(raw.url, `${path}.url`);
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") invalid(`${path}.url`, "must use http or https");
  } catch { invalid(`${path}.url`, "must be a valid HTTP(S) URL"); }
  const headers = parseStringMap(raw.headers, `${path}.headers`);
  const secretHeaders = parseStringMap(raw.secretHeaders, `${path}.secretHeaders`);
  const secretHeaderNames = new Set(Object.keys(secretHeaders).map((key) => key.toLowerCase()));
  for (const key of Object.keys(headers)) {
    if (secretHeaderNames.has(key.toLowerCase())) invalid(`${path}.headers`, "must not overlap secretHeaders");
  }
  const hasAuthorizationHeader = [...Object.keys(headers), ...Object.keys(secretHeaders)]
    .some((key) => key.toLowerCase() === "authorization");
  if (hasAuthorizationHeader && raw.bearerTokenSecret !== undefined) {
    invalid(`${path}.bearerTokenSecret`, "must not be combined with Authorization");
  }
  const authMode = raw.auth === undefined ? "none" : raw.auth;
  if (authMode === "none") return { enabled, transport: "streamable-http", url, namespace, headers, secretHeaders, auth: { type: "none" } };
  if (authMode === "bearer") return { enabled, transport: "streamable-http", url, namespace, headers, secretHeaders, auth: { type: "bearer", tokenSecret: requiredString(raw.bearerTokenSecret, `${path}.bearerTokenSecret`) } };
  if (authMode !== "oauth") invalid(`${path}.auth`, "must be none, bearer, or oauth");
  const scopes = parseStringArray(raw.oauthScopes, `${path}.oauthScopes`);
  const callbackPort = raw.oauthCallbackPort === undefined ? 0 : raw.oauthCallbackPort;
  if (typeof callbackPort !== "number" || !Number.isInteger(callbackPort) || (callbackPort !== 0 && (callbackPort < 1024 || callbackPort > 65535))) invalid(`${path}.oauthCallbackPort`, "must be 0 or an integer from 1024 through 65535");
  const clientId = raw.oauthClientId === undefined ? undefined : requiredString(raw.oauthClientId, `${path}.oauthClientId`);
  const clientSecretSecret = raw.oauthClientSecretSecret === undefined ? undefined : requiredString(raw.oauthClientSecretSecret, `${path}.oauthClientSecretSecret`);
  if (clientSecretSecret !== undefined && clientId === undefined) invalid(`${path}.oauthClientSecretSecret`, "requires oauthClientId");
  const tokenEndpointAuthMethod = raw.oauthTokenEndpointAuthMethod === undefined ? "none" : raw.oauthTokenEndpointAuthMethod;
  if (tokenEndpointAuthMethod !== "none" && tokenEndpointAuthMethod !== "client_secret_basic" && tokenEndpointAuthMethod !== "client_secret_post") invalid(`${path}.oauthTokenEndpointAuthMethod`, "must be none, client_secret_basic, or client_secret_post");
  if (tokenEndpointAuthMethod !== "none" && clientSecretSecret === undefined) invalid(`${path}.oauthTokenEndpointAuthMethod`, "requires oauthClientSecretSecret");
  if (tokenEndpointAuthMethod === "none" && clientSecretSecret !== undefined) invalid(`${path}.oauthTokenEndpointAuthMethod`, "cannot be none with a client secret");
  return { enabled, transport: "streamable-http", url, namespace, headers, secretHeaders, auth: { type: "oauth", scopes, callbackPort, ...(clientId === undefined ? {} : { clientId }), ...(clientSecretSecret === undefined ? {} : { clientSecretSecret }), tokenEndpointAuthMethod } };
}

export function loadConfig(homeDir: string): Config {
  const path = join(homeDir, "config.toml");
  if (!existsSync(path)) return { extensions: {}, mcp: { servers: {} } };
  const parsed = Bun.TOML.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const extensions: Config["extensions"] = {};
  const extSection = parsed.extensions;
  if (extSection && typeof extSection === "object") for (const [extId, extVal] of Object.entries(extSection)) {
    const connections: Record<string, ConnectionConfig> = {};
    const connSection = (extVal as Record<string, any>)?.connections;
    if (connSection && typeof connSection === "object") for (const [name, rawConn] of Object.entries(connSection)) {
      const rc = rawConn as Record<string, any>;
      connections[name] = { environment: String(rc.environment ?? ""), host: String(rc.host ?? ""), port: Number(rc.port ?? 3306), database: String(rc.database ?? ""), username: String(rc.username ?? ""), secret: String(rc.secret ?? ""), tls: Boolean(rc.tls ?? false) };
    }
    extensions[extId] = { connections };
  }
  const servers: Record<string, McpServerConfig> = {};
  const serverSection = (parsed.mcp as Record<string, unknown> | undefined)?.servers;
  if (serverSection !== undefined) {
    if (serverSection === null || typeof serverSection !== "object" || Array.isArray(serverSection)) {
      invalid("mcp.servers", "must be a table");
    }
    for (const [id, value] of Object.entries(serverSection)) {
      servers[id] = parseMcpServer(id, value);
    }
  }
  return { extensions, mcp: { servers } };
}

export function getConnectionConfig(cfg: Config, extensionId: string, connection: string): ConnectionConfig | undefined { return cfg.extensions[extensionId]?.connections[connection]; }
export function listConnections(cfg: Config, extensionId: string): string[] { return Object.keys(cfg.extensions[extensionId]?.connections ?? {}); }
