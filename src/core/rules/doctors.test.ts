import { describe, expect, it } from "vitest";
import type { Fact, SourceDocument } from "../model";
import { buildDoctors, specialtyKey } from "./doctors";
import { createTestService } from "@/adapters/testing";

const doc = (o: Partial<SourceDocument>): SourceDocument => ({
  id: "d",
  profileId: "me",
  kind: "consultation",
  title: "Приём",
  documentDate: null,
  specialist: null,
  area: null,
  original: null,
  sampleKey: null,
  preparedNotice: null,
  isSynthetic: false,
  encounterId: null,
  status: "applied",
  statusMessage: null,
  createdAt: "2026-01-01T00:00:00Z",
  ...o,
});

const fact = (id: string, docId: string, o: Partial<Fact>): Fact =>
  ({
    id,
    profileId: "me",
    type: "diagnosis",
    label: id,
    value: { kind: "text", text: id },
    originalText: id,
    sources: [{ documentId: docId, versionId: null, page: null, quote: id, quoteIsExact: true, timecode: null, segmentId: null, speaker: null, sourceType: "personal" }],
    eventDate: { kind: "unknown" },
    documentDate: null,
    verification: "unverified",
    validity: { status: "unconfirmed", from: null, to: null, confirmedAt: null },
    extraction: { method: "parser", confidence: null },
    specialist: null,
    problem: null,
    encounterId: null,
    dedupKey: id,
    conflictGroupId: null,
    revisions: [],
    createdAt: "2026-01-01T00:00:00Z",
    ...o,
  }) as Fact;

describe("doctors", () => {
  it("groups visits by specialty and sums each up from its facts", () => {
    const docs = [
      doc({ id: "c1", specialist: "кардиолог", documentDate: "2026-01-10", institution: "Клиника Тест" }),
      doc({ id: "c2", specialist: "Кардиолог Петрова", documentDate: "2026-03-10" }),
      doc({ id: "t1", kind: "transcript", title: "Разговор", documentDate: "2026-03-10" }),
      doc({ id: "l1", kind: "lab_report", specialist: "кардиолог" }),
    ];
    const facts = [
      fact("Экстрасистолия", "c1", {}),
      fact("Гиперхолестеринемия", "c2", {}),
      fact("Бисопролол 2.5 мг", "c2", { type: "medication", value: { kind: "medication", name: "Бисопролол", dose: "2.5 мг", status: "prescribed" } }),
      fact("Аспирин", "c2", { type: "medication", value: { kind: "medication", name: "Аспирин", dose: null, status: "mentioned_taking" } }),
      fact("Явка", "c2", { type: "appointment", value: { kind: "appointment", attended: "unknown" }, eventDate: { kind: "exact", date: "2026-04-10" } }),
      fact("Отклонено", "c2", { verification: "rejected" }),
    ];
    const [f] = buildDoctors(docs, facts, [], "2026-03-20");
    expect(f.label).toBe("Кардиолог");
    expect(f.visits.map((v) => v.document.id)).toEqual(["c2", "t1", "c1"]);
    expect(f.latestDiagnoses.map((l) => l.label)).toEqual(["Гиперхолестеринемия"]);
    expect(f.latestPrescriptions.map((l) => l.label)).toEqual(["Бисопролол 2.5 мг"]);
    expect(f.nextVisit).toBe("2026-04-10");
    expect(f.institutions).toEqual(["Клиника Тест"]);
    expect(specialtyKey("Врач-гастроэнтеролог")).toBe("Гастроэнтеролог");
  });

  it("answers a question about selected documents from their facts only, locally", async () => {
    const { service } = await createTestService();
    const text = [
      "Клиника Тестовая",
      "Дата: 05.05.2026",
      "ОСМОТР КАРДИОЛОГА",
      "Жалобы: на сердцебиение.",
      "Медикаментозная терапия: Бисопролол (БИСОПРОЛОЛ ТАБ. 2.5 МГ), по 1 таб. 1 раз/дн., длительность 1 мес., внутрь (per os).",
    ].join("\n");
    const { document } = await service.upload("me", { fileName: "приём.txt", mime: "text/plain", bytes: new TextEncoder().encode(text) });
    await service.autoApply("me", document.id);
    const [question, answer] = await service.askAboutDocuments("me", [document.id], "Какие препараты назначены?");
    expect(question.text).toContain("по документам");
    expect(answer.mode).toBe("demo");
    expect(answer.usedContext.every((c) => c.label)).toBe(true);
    expect(answer.usedContext.map((c) => c.label)).toContain("Бисопролол 2.5 мг");
    await expect(service.askAboutDocuments("me", [], "Вопрос")).rejects.toThrow("Выберите");
    expect((await service.doctors("me"))[0]).toMatchObject({ label: "Кардиолог", latestPrescriptions: [{ label: "Бисопролол 2.5 мг" }] });
  });
});
