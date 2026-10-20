import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { LlmError, parseOutput, type StructuredModel, type StructuredRequest } from "./structured";

export const DEFAULT_OPENAI_MODEL = "gpt-5.5";

/** OpenAI Responses API. The key comes from OPENAI_API_KEY (e.g. in .env.local). */
export class OpenAiModel implements StructuredModel {
  provider = "OpenAI";

  constructor(
    public model: string = DEFAULT_OPENAI_MODEL,
    private client: OpenAI = new OpenAI(),
  ) {}

  async generate<S extends z.ZodType>(req: StructuredRequest, schema: S, schemaName: string): Promise<z.infer<S>> {
    const content: OpenAI.Responses.ResponseInputContent[] = [];
    if (req.pdf) content.push({ type: "input_file", filename: "document.pdf", file_data: `data:application/pdf;base64,${Buffer.from(req.pdf).toString("base64")}` });
    content.push({ type: "input_text", text: req.user });
    let response: OpenAI.Responses.Response;
    try {
      response = await this.client.responses.create({
        model: this.model,
        instructions: req.system,
        input: [{ role: "user", content }],
        reasoning: { effort: req.effort },
        text: { format: zodTextFormat(schema, schemaName) },
        max_output_tokens: 64000,
        // Personal health data is not kept on the provider side for later retrieval.
        store: false,
      });
    } catch (e) {
      if (e instanceof OpenAI.AuthenticationError || e instanceof OpenAI.PermissionDeniedError) throw new LlmError("auth", "Ключ OpenAI не принят. Проверьте OPENAI_API_KEY.");
      if (e instanceof OpenAI.RateLimitError) throw new LlmError("rate_limit", "Слишком много запросов к OpenAI или закончился баланс. Попробуйте позже.");
      throw new LlmError("unavailable", "Сервис OpenAI недоступен. Попробуйте позже.");
    }
    const parts = response.output.flatMap((o) => (o.type === "message" ? o.content : []));
    if (parts.some((p) => p.type === "refusal")) throw new LlmError("refusal", "Модель отказалась обработать этот запрос.");
    if (response.status === "incomplete") throw new LlmError("truncated", "Ответ модели оказался слишком длинным и был обрезан.");
    return parseOutput(response.output_text, schema);
  }
}
