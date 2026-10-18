import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FsFileStore, JsonFileRepository } from "./storage/json-file";
import { createTestService } from "./testing";
import { LocalRecognizer } from "./recognition/local";
import type { SourceDocument } from "@/core/model";

/** Builds a one-page PDF with a Latin text layer, with a valid xref table. */
function tinyPdf(text: string): Uint8Array {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

describe("json file storage", () => {
  it("keeps data and originals across restarts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "health-"));
    try {
      const repo = await JsonFileRepository.open(dir);
      const { service } = await createTestService({ repo });
      await service.openSample("me", "fixture-visit-2025-09-22");
      const up = await service.upload("me", { fileName: "t.txt", mime: "text/plain", bytes: new TextEncoder().encode("Врач: тест") });
      const files = new FsFileStore(path.join(dir, "files"));
      await files.put(up.document.original!.sha256, new TextEncoder().encode("Врач: тест"));

      const reopened = await JsonFileRepository.open(dir);
      const docs = await reopened.listDocuments("me");
      expect(docs.map((d) => d.title).sort()).toEqual(["t", "Консультация терапевта"]);
      expect(await reopened.getProposal("me", docs.find((d) => d.sampleKey)!.id)).not.toBeNull();
      expect(new TextDecoder().decode((await files.get(up.document.original!.sha256))!)).toBe("Врач: тест");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("local recognition", () => {
  const doc = (mime: string, kind: SourceDocument["kind"] = "other") =>
    ({ original: { mime, fileName: "x", size: 1, sha256: "0".repeat(64) }, kind }) as SourceDocument;

  it("extracts the PDF text layer locally", async () => {
    const r = await new LocalRecognizer().recognize({ document: doc("application/pdf"), bytes: tinyPdf("Ferritin 180 ng/mL") });
    expect(r.ok && r.version.method).toBe("pdf_text_layer");
    expect(r.ok && r.version.pages[0]).toContain("Ferritin 180");
  });

  it("reports a broken PDF instead of inventing content", async () => {
    const r = await new LocalRecognizer().recognize({ document: doc("application/pdf"), bytes: new TextEncoder().encode("not a pdf") });
    expect(r).toMatchObject({ ok: false });
  });

  it("parses an uploaded transcript into speaker segments", async () => {
    const r = await new LocalRecognizer().recognize({ document: doc("text/plain", "transcript"), bytes: new TextEncoder().encode("[00:00:01] Врач: Добрый день\nНеясно кто") });
    expect(r.ok && r.version.segments.map((s) => s.speaker)).toEqual(["doctor", "unclear"]);
  });
});
