import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { LlmError, parseOutput, type StructuredModel, type StructuredRequest } from "./structured";

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";

/** Anthropic Messages API. The key comes from ANTHROPIC_API_KEY (e.g. in .env.local). */
export class ClaudeModel implements StructuredModel {
  provider = "Anthropic";

  constructor(
    public model: string = DEFAULT_CLAUDE_MODEL,
    private client: Anthropic = new Anthropic(),
  ) {}

  async generate<S extends z.ZodType>(req: StructuredRequest, schema: S): Promise<z.infer<S>> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (req.pdf) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(req.pdf).toString("base64") } });
    content.push({ type: "text", text: req.user });
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await this.client.beta.messages
        .stream({
          model: this.model,
          max_tokens: 64000,
          system: req.system,
          messages: [{ role: "user", content }],
          output_config: { effort: req.effort, format: betaZodOutputFormat(schema) },
          // A policy decline is retried on the server's default fallback model.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        })
        .finalMessage();
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new LlmError("auth", "Ключ Anthropic не принят. Проверьте ANTHROPIC_API_KEY.");
      if (e instanceof Anthropic.RateLimitError) throw new LlmError("rate_limit", "Слишком много запросов к Anthropic. Попробуйте позже.");
      throw new LlmError("unavailable", "Сервис Anthropic недоступен. Попробуйте позже.");
    }
    if (message.stop_reason === "refusal") throw new LlmError("refusal", "Модель отказалась обработать этот запрос.");
    if (message.stop_reason === "max_tokens") throw new LlmError("truncated", "Ответ модели оказался слишком длинным и был обрезан.");
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return parseOutput(text, schema);
  }
}
