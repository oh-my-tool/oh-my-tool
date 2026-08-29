import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RuntimeError } from "../runtime/errors";
import { validateInput, type Schema } from "../runtime/schema";
import type { InstalledExtension } from "../extension/discovery";

export interface ConnectionConfig {
  environment?: string;
  settings: Record<string, unknown>;
  secrets: Record<string, string>;
}

export interface SanitizedConnectionConfig {
  environment?: string;
  settings: Record<string, unknown>;
  secretsConfigured: Record<string, boolean>;
}

export interface McpCommonServerConfig { readonly enabled: true; readonly namespace: string; }
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
export type McpEnabledServerConfig = McpStdioServerConfig | McpHttpServerConfig;
export interface McpDisabledServerConfig {
  readonly enabled: false;
  readonly namespace: string;
  readonly transport: "disabled";
}
export type McpServerConfig = McpEnabledServerConfig | McpDisabledServerConfig;
export interface Config {
  extensions: Record<string, { connections: Record<string, ConnectionConfig> }>;
  mcp: { servers: Record<string, McpServerConfig> };
}

function invalid(path: string, reason: string): never { throw new RuntimeError("MCP_INVALID_CONFIG", `${path}: ${reason}`); }
function invalidConnection(path: string, reason: string): never { throw new RuntimeError("CONFIG_INVALID", `${path}: ${reason}`); }

function parseConnection(extensionId: string, name: string, value: unknown): ConnectionConfig {
  const path = `extensions.${extensionId}.connections.${name}`;
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalidConnection(path, "must be a table");
  const raw = value as Record<string, unknown>;
  const allowed = new Set(["environment", "settings", "secrets"]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) invalidConnection(`${path}.${key}`, "unknown connection field");
  const environment = raw.environment;
  if (environment !== undefined && typeof environment !== "string") invalidConnection(`${path}.environment`, "must be a string");
  const settings = parseSettingsMap(raw.settings, `${path}.settings`);
  const secrets = parseSecretMap(raw.secrets, `${path}.secrets`);
  return {
    ...(environment === undefined ? {} : { environment }),
    settings,
    secrets,
  };
}

function parseSettingsMap(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalidConnection(path, "must be a table");
  return { ...(value as Record<string, unknown>) };
}

function parseSecretMap(value: unknown, path: string): Record<string, string> {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalidConnection(path, "must be a table");
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "string" || entry.length === 0) invalidConnection(`${path}.${key}`, "must be a non-empty string");
    result[key] = entry;
  }
  return result;
}

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
  const enabled = raw.enabled === undefined ? true : raw.enabled;
  if (typeof enabled !== "boolean") invalid(`${path}.enabled`, "must be a boolean");
  if (!enabled) return { enabled: false, namespace: id, transport: "disabled" };
  const namespace = raw.namespace === undefined ? id : requiredString(raw.namespace, `${path}.namespace`);
  assertMcpName(namespace, `${path}.namespace`);
  if (namespace === "native" || namespace === "mcp") invalid(`${path}.namespace`, "is reserved");

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
  if (hasAuthorizationHeader && (authMode === "bearer" || authMode === "oauth")) {
    invalid(`${path}.headers`, "must not configure Authorization when bearer or oauth auth is enabled");
  }
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
  if (extSection !== undefined && (extSection === null || typeof extSection !== "object" || Array.isArray(extSection))) {
    invalidConnection("extensions", "must be a table");
  }
  if (extSection && typeof extSection === "object") for (const [extId, extVal] of Object.entries(extSection)) {
    if (extVal === null || typeof extVal !== "object" || Array.isArray(extVal)) invalidConnection(`extensions.${extId}`, "must be a table");
    const connections: Record<string, ConnectionConfig> = {};
    const connSection = (extVal as Record<string, unknown>).connections;
    if (connSection !== undefined && (connSection === null || typeof connSection !== "object" || Array.isArray(connSection))) {
      invalidConnection(`extensions.${extId}.connections`, "must be a table");
    }
    if (connSection && typeof connSection === "object") for (const [name, rawConn] of Object.entries(connSection)) {
      connections[name] = parseConnection(extId, name, rawConn);
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

export function sanitizeExtensionConnections(cfg: Config): Record<string, Record<string, SanitizedConnectionConfig>> {
  return Object.fromEntries(Object.entries(cfg.extensions).map(([extensionId, extension]) => [
    extensionId,
    Object.fromEntries(Object.entries(extension.connections).map(([name, connection]) => [name, {
      ...(connection.environment === undefined ? {} : { environment: connection.environment }),
      settings: { ...connection.settings },
      secretsConfigured: Object.fromEntries(Object.keys(connection.secrets).map((key) => [key, true])),
    }])),
  ]));
}

export function validateConfiguredConnections(
  cfg: Config,
  installedExtensions: readonly InstalledExtension[],
  targetExtensionId?: string,
): void {
  const manifests = new Map(installedExtensions.map((extension) => [extension.id, extension.manifest]));
  for (const [extensionId, extension] of Object.entries(cfg.extensions)) {
    if (targetExtensionId !== undefined && targetExtensionId !== extensionId) continue;
    const schema = manifests.get(extensionId)?.connectionSchema;
    if (schema === undefined) continue;
    for (const [name, connection] of Object.entries(extension.connections)) {
      try {
        validateInput(schema as Schema, connection.settings, { applyDefaults: false });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        invalidConnection(`extensions.${extensionId}.connections.${name}.settings`, message);
      }
    }
  }
}
