import { OmtError } from "./errors";

export type Schema = {
  type?: string;
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  default?: unknown;
  maximum?: number;
  minimum?: number;
};

function checkType(value: unknown, schema: Schema, path: string): void {
  const type = schema.type;
  if (!type || value === undefined) return;
  let ok = false;
  switch (type) {
    case "string": ok = typeof value === "string"; break;
    case "integer": ok = typeof value === "number" && Number.isInteger(value); break;
    case "number": ok = typeof value === "number"; break;
    case "boolean": ok = typeof value === "boolean"; break;
    case "array":
      ok = Array.isArray(value);
      if (ok && schema.items) (value as unknown[]).forEach((item, i) => checkType(item, schema.items!, `${path}[${i}]`));
      break;
    case "object": ok = value !== null && typeof value === "object" && !Array.isArray(value); break;
    default: ok = true;
  }
  if (!ok) throw new OmtError("INVALID_INPUT", `'${path}' must be of type ${type}`);
  if (typeof value === "number") {
    if (schema.maximum !== undefined && value > schema.maximum) throw new OmtError("INVALID_INPUT", `'${path}' must be <= ${schema.maximum}`);
    if (schema.minimum !== undefined && value < schema.minimum) throw new OmtError("INVALID_INPUT", `'${path}' must be >= ${schema.minimum}`);
  }
}

export interface ValidateInputOptions {
  readonly applyDefaults?: boolean;
}

export function validateInput(
  schema: Schema | undefined,
  input: Record<string, unknown>,
  options: ValidateInputOptions = {},
): Record<string, unknown> {
  if (!schema) return { ...input };
  const out: Record<string, unknown> = { ...input };
  const props = schema.properties ?? {};
  if (options.applyDefaults !== false) {
    for (const key of Object.keys(props)) {
      const prop = props[key];
      if (out[key] === undefined && prop.default !== undefined) out[key] = prop.default;
    }
  }
  for (const key of schema.required ?? []) {
    if (out[key] === undefined || out[key] === null) throw new OmtError("INVALID_INPUT", `missing required field '${key}'`);
  }
  for (const key of Object.keys(out)) if (props[key]) checkType(out[key], props[key], key);
  return out;
}
