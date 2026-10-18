import type { DocumentRecognizer, RecognitionInput, RecognitionResult } from "@/core/ports";
import { parseTranscript } from "@/core/rules/transcript";

/**
 * Real, local recognition: PDF text layer via pdf.js (unpdf), plain text, and
 * transcript parsing. No OCR: scanned PDFs without a text layer report "no_text".
 * Nothing is sent to external services.
 */
export class LocalRecognizer implements DocumentRecognizer {
  async recognize({ document, bytes }: RecognitionInput): Promise<RecognitionResult> {
    if (!bytes || !document.original) return { ok: false, reason: "not_connected", message: "Оригинала нет." };
    const mime = document.original.mime;

    if (mime === "application/pdf") {
      try {
        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(new Uint8Array(bytes));
        const { text } = await extractText(pdf, { mergePages: false });
        const pages = (Array.isArray(text) ? text : [text]).map((p) => p.trim());
        if (!pages.some((p) => p.length > 0))
          return { ok: false, reason: "no_text", message: "В PDF нет текстового слоя, а распознавание сканов (OCR) не подключено." };
        return { ok: true, version: { method: "pdf_text_layer", pages, segments: [], note: "Текстовый слой PDF, извлечён локально" } };
      } catch {
        return { ok: false, reason: "failed", message: "Не удалось прочитать PDF." };
      }
    }

    const text = new TextDecoder("utf-8").decode(bytes);
    if (document.kind === "transcript") {
      return {
        ok: true,
        version: { method: "transcript_parser", pages: [text], segments: parseTranscript(text), note: "Реплики разобраны по меткам говорящих и таймкодам" },
      };
    }
    return { ok: true, version: { method: "plain_text", pages: [text], segments: [], note: null } };
  }
}
