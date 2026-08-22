import { createPaths } from "../paths";
import { prepareHome } from "../migration";
import { loadConfig, getConnectionConfig } from "../config/config";
import { SecretsManager } from "../secrets/secrets";
import { applyLimits, validateConnectionInput } from "../policy/policy";
import { NativeExtensionProvider } from "../runtime/providers/native/provider";
import { createToolRuntime } from "../runtime/runtime";
import type { ToolDescriptor } from "../runtime/provider";

export function homeDir(): string {
  return createPaths().home;
}

export async function createRuntime() {
  const paths = createPaths();
  await prepareHome(paths);
  const config = loadConfig(paths.home);
  const secrets = new SecretsManager();
  return createToolRuntime({
    providers: [new NativeExtensionProvider(paths)],
    policy: {
      preflight(descriptor, input) {
        const limits = applyLimits(input);
        input.maxRows = limits.maxRows;
        input.timeoutMs = limits.timeoutMs;
        const extensionId = descriptor.id.split(".", 1)[0];
        const schema = descriptor.inputSchema as { properties?: Record<string, unknown> } | undefined;
        const needsConnection = Boolean(schema?.properties && "connection" in schema.properties) || "connection" in input;
        if (needsConnection) validateConnectionInput(input, config, extensionId);
      },
    },
    createExecutionContext(descriptor: ToolDescriptor, input: Record<string, unknown>) {
      const extensionId = descriptor.id.split(".", 1)[0];
      const connection = typeof input.connection === "string"
        ? getConnectionConfig(config, extensionId, input.connection)
        : undefined;
      return {
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        config: (connection ?? {}) as Record<string, unknown>,
        secrets,
      };
    },
  });
}
