import type { z } from "zod";

export interface StructuredRequest {
  system: string;
  user: string;
  /** A PDF without a text layer, sent as a file so the model can read it. */
  pdf?: Uint8Array | null;
  effort: "low" | "medium" | "high";
}

/** Why a model call gave no usable result. Messages are shown to the user and never contain document text. */
export class LlmError extends Error {
  constructor(
    public kind: "refusal" | "truncated" | "invalid_output" | "auth" | "rate_limit" | "unavailable",
    message: string,
  ) {
    super(message);
  }
}

/** One provider (OpenAI, Anthropic, ...) returning JSON that matches a schema. */
export interface StructuredModel {
  provider: string;
  model: string;
  generate<S extends z.ZodType>(req: StructuredRequest, schema: S, schemaName: string): Promise<z.infer<S>>;
}

/** Parses and validates model text against the schema. */
export function parseOutput<S extends z.ZodType>(text: string, schema: S): z.infer<S> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new LlmError("invalid_output", "Модель вернула ответ не в ожидаемом формате.");
  }
  const r = schema.safeParse(json);
  if (!r.success) throw new LlmError("invalid_output", "Модель вернула ответ не в ожидаемом формате.");
  return r.data;
}
