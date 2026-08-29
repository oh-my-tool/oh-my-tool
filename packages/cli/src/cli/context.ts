import { createPaths } from "../paths";
import { prepareHome } from "../migration";
import { loadConfig, getConnectionConfig, sanitizeExtensionConnections, validateConfiguredConnections, type McpEnabledServerConfig } from "../config/config";
import { SecretsManager } from "../secrets/secrets";
import { applyLimits, validateConnectionInput } from "../policy/policy";
import { NativeExtensionProvider } from "../runtime/providers/native/provider";
import { McpProvider } from "../runtime/providers/mcp/provider";
import { createToolRuntime } from "../runtime/runtime";
import type { ToolDescriptor } from "../runtime/provider";

export function homeDir(): string {
  return createPaths().home;
}

export interface RuntimeOptions {
  readonly includeMcp?: boolean;
  readonly targetTool?: string;
}

export async function createRuntime(options: RuntimeOptions = {}) {
  const paths = createPaths();
  await prepareHome(paths);
  const config = loadConfig(paths.home);
  const secrets = new SecretsManager();
  const extensionConnections = sanitizeExtensionConnections(config);
  const nativeProvider = new NativeExtensionProvider(paths);
  const nativeTargetExtension = options.targetTool === undefined
    ? undefined
    : nativeProvider.extensionForTool(options.targetTool);
  if (nativeTargetExtension !== undefined) {
    validateConfiguredConnections(config, nativeProvider.installedExtensions(), nativeTargetExtension);
  }
  const nativeTarget = nativeTargetExtension !== undefined;
  const mcpProviders = options.includeMcp === false || nativeTarget ? [] : Object.entries(config.mcp.servers)
    .sort(([a], [b]) => a.localeCompare(b))
    .filter((entry): entry is [string, McpEnabledServerConfig] => entry[1].enabled)
    .map(([serverId, server]) => new McpProvider({ serverId, config: server, secrets }));
  const providers = [nativeProvider, ...mcpProviders];
  return createToolRuntime({
    providers,
    policy: {
      preflight(descriptor, input) {
        if (descriptor.provider.kind !== "native") return;
        const limits = applyLimits(input);
        input.maxRows = limits.maxRows;
        input.timeoutMs = limits.timeoutMs;
        const extensionId = descriptor.source.id;
        const schema = descriptor.inputSchema as { properties?: Record<string, unknown> } | undefined;
        const needsConnection = Boolean(schema?.properties && "connection" in schema.properties) || "connection" in input;
        if (needsConnection) validateConnectionInput(input, config, extensionId);
      },
    },
    createExecutionContext(descriptor: ToolDescriptor, input: Record<string, unknown>) {
      const extensionId = descriptor.source.id;
      const connection = typeof input.connection === "string"
        ? getConnectionConfig(config, extensionId, input.connection)
        : undefined;
      return {
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        config: (connection ?? { connections: extensionConnections[extensionId] ?? {} }) as Record<string, unknown>,
        secrets,
      };
    },
  });
}

export async function withRuntime<T>(operation: (runtime: Awaited<ReturnType<typeof createRuntime>>) => Promise<T>, options: RuntimeOptions = {}): Promise<T> {
  const runtime = await createRuntime(options);
  let operationFailed = false;
  try {
    return await operation(runtime);
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    try {
      await runtime.close();
    } catch (closeError) {
      if (!operationFailed) throw closeError;
    }
  }
}
