import type { ExtractionResult, FactExtractor } from "@/core/ports";
import type { ContentVersion, SourceDocument } from "@/core/model";
import type { BuiltInSamples } from "../samples/catalog";

/**
 * DEMO adapter. Returns a prepared parse only for a document opened from the matching
 * built-in example (by sampleKey). Any other document gets "not connected": a prepared
 * parse of one document is never shown for another file.
 */
export class PreparedExtractor implements FactExtractor {
  constructor(private samples: BuiltInSamples) {}

  async extract({ document, versions }: { document: SourceDocument; versions: ContentVersion[] }): Promise<ExtractionResult> {
    const b = document.sampleKey ? this.samples.builder(document.sampleKey) : null;
    if (!b) {
      return {
        ok: false,
        reason: "not_connected",
        message: "Извлечение фактов не подключено: в прототипе разбор подготовлен только для встроенных примеров.",
      };
    }
    // Prepared version first (for real samples), then recognized text (synthetic samples).
    const ordered = [...versions].sort((a, c) => Number(c.method === "prepared") - Number(a.method === "prepared"));
    const proposal = b.build({
      documentId: document.id,
      documentDate: document.documentDate,
      specialist: document.specialist,
      versions: ordered,
      paraphrase: b.paraphrase,
    });
    return { ok: true, proposal, method: "prepared" };
  }
}
