import type { ExtractionInput, ExtractionResult, FactExtractor, LiveModel, LlmAdapter, LlmAnswer, LlmRequest } from "@/core/ports";
import { proposalFromExtraction } from "@/core/rules/extraction";
import { ANSWER_FORMAT, buildExtractionPrompt, validateAnswer } from "@/core/rules/llm-request";
import { AnswerSchema, ExtractionSchema } from "./schemas";
import { LlmError, type StructuredModel } from "./structured";

/** Extracts facts with a connected model. Called only after the user agreed to send this document. */
export class ModelFactExtractor implements FactExtractor {
  constructor(private m: StructuredModel) {}

  async extract({ document, versions, original }: ExtractionInput): Promise<ExtractionResult> {
    const hasText = versions.some((v) => v.method !== "prepared" && (v.segments.length || v.pages.some((p) => p.trim())));
    const pdf = !hasText && original?.mime === "application/pdf" ? original.bytes : null;
    if (!hasText && !pdf) return { ok: false, reason: "failed", message: "В документе нет текста, который можно отправить модели." };
    const prompt = buildExtractionPrompt(document, hasText ? versions : []);
    try {
      const out = await this.m.generate({ system: prompt.system, user: prompt.user, pdf, effort: "high" }, ExtractionSchema, "health_facts");
      return { ok: true, proposal: proposalFromExtraction(document, hasText ? versions : [], out, this.m.model), method: "llm" };
    } catch (e) {
      return { ok: false, reason: "failed", message: e instanceof LlmError ? e.message : "Не удалось получить ответ модели." };
    }
  }
}

/** Answers chat questions with a connected model; every claim is checked against the facts that were sent. */
export class ModelChat implements LlmAdapter {
  constructor(private m: StructuredModel) {}

  async answer(req: LlmRequest): Promise<LlmAnswer> {
    const user = [req.untrustedContext, "", `Вопрос: ${req.question}`].join("\n");
    let raw;
    try {
      raw = await this.m.generate({ system: `${req.system}\n\n${ANSWER_FORMAT}`, user, effort: "medium" }, AnswerSchema, "health_answer");
    } catch (e) {
      throw e instanceof LlmError ? e : new LlmError("unavailable", "Не удалось получить ответ модели.");
    }
    const { segments, usedFactIds } = validateAnswer(raw, req.contextFacts);
    return { mode: "llm", segments, usedFactIds };
  }
}

export function liveModel(m: StructuredModel): LiveModel {
  return { provider: m.provider, model: m.model, extractor: new ModelFactExtractor(m), chat: new ModelChat(m) };
}
