import { createInterface } from "node:readline";

const tool = {
  name: "echo",
  title: "Echo",
  description: "Echo input through MCP",
  inputSchema: { type: "object", required: ["value"], properties: { value: { type: "string" } } },
  annotations: { readOnlyHint: true },
};

function reply(id: unknown, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  let request: { id?: unknown; method?: string; params?: { arguments?: { value?: string } } };
  try { request = JSON.parse(line); } catch { return; }
  if (request.method === "notifications/initialized") return;
  if (request.method === "initialize") {
    reply(request.id, { protocolVersion: request.params ? "2025-11-25" : "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0.0" } });
    return;
  }
  if (request.method === "tools/list") {
    reply(request.id, { tools: [tool] });
    return;
  }
  if (request.method === "tools/call") {
    const value = request.params?.arguments?.value ?? "";
    reply(request.id, { content: [{ type: "text", text: `echoed:${value}` }], structuredContent: { echoed: value, tokenPresent: Boolean(process.env.FIXTURE_TOKEN) } });
  }
});
