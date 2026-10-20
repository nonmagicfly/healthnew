// Output schemas shared by every model provider. Every field is required (nullable where
// optional) so the same schema works with strict structured outputs of OpenAI and Anthropic.
import { z } from "zod";
import { DOCUMENT_MEDICATION_STATUSES, EXTRACTED_FACT_TYPES } from "@/core/rules/extraction";

const DateSchema = z.object({
  kind: z.enum(["exact", "approx", "unknown"]),
  date: z.string().nullable().describe("YYYY-MM-DD, только для exact"),
  label: z.string().nullable().describe("Для approx: как написано, например «весной 2024»"),
  before: z.string().nullable().describe("YYYY-MM-DD: событие было до этой даты"),
  after: z.string().nullable().describe("YYYY-MM-DD: событие было после этой даты"),
});

export const ExtractionSchema = z.object({
  documentDate: DateSchema.nullable().describe("Дата, напечатанная в самом документе: дата выдачи, приёма или исследования"),
  encounter: z
    .object({ kind: z.enum(["visit", "lab", "examination"]), title: z.string(), date: DateSchema, specialist: z.string().nullable(), institution: z.string().nullable().describe("Клиника или лаборатория, как напечатано в документе") })
    .nullable(),
  items: z.array(
    z.object({
      group: z.enum(["history", "state_change", "clarify"]),
      type: z.enum(EXTRACTED_FACT_TYPES),
      label: z.string(),
      quote: z.string(),
      page: z.number().int().nullable(),
      eventDate: DateSchema,
      problem: z.string().nullable(),
      explanation: z.string(),
      lab: z
        .object({
          name: z.string(),
          value: z.string(),
          unit: z.string().nullable(),
          reference: z.string().nullable(),
          method: z.string().nullable(),
          origin: z.enum(["lab_report", "mention"]),
        })
        .nullable(),
      medication: z.object({ name: z.string().nullable(), dose: z.string().nullable(), status: z.enum(DOCUMENT_MEDICATION_STATUSES) }).nullable(),
      qualitative: z.object({ indicator: z.string().nullable(), text: z.string() }).nullable(),
      proposeCurrent: z.boolean(),
      aboutItems: z.array(z.number().int()),
    }),
  ),
});

export const AnswerSchema = z.object({
  segments: z.array(
    z.object({
      kind: z.enum(["document_fact", "patient_words", "summary", "missing", "caution"]),
      text: z.string(),
      factIds: z.array(z.string()),
    }),
  ),
});
