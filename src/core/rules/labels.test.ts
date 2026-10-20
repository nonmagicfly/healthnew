import { describe, expect, it } from "vitest";
import type { SourceDocument } from "../model";
import { applyLabels, buildFolders, deriveLabels, folderOf, specialtyOf } from "./labels";
import { createTestService } from "@/adapters/testing";

const doc = (o: Partial<SourceDocument>): SourceDocument => ({
  id: "d",
  profileId: "me",
  kind: "other",
  title: "Документ",
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

describe("document labels", () => {
  it("derives type and section from what parsing found", () => {
    expect(deriveLabels({ encounter: { kind: "lab", title: "Анализы", specialist: null }, labNames: ["Ферритин", "АЛТ", "Гемоглобин"], title: "скан" })).toMatchObject({ kind: "lab_report", area: "Биохимия" });
    expect(deriveLabels({ encounter: null, labNames: ["Гемоглобин", "Эритроциты"], title: "x" })).toMatchObject({ kind: "lab_report", area: "Общий анализ крови" });
    expect(deriveLabels({ encounter: { kind: "visit", title: "Приём", specialist: "кардиолог", institution: "Клиника Тест" }, labNames: [], title: "x" })).toEqual({
      kind: "consultation",
      area: "Кардиология",
      specialist: "кардиолог",
      institution: "Клиника Тест",
    });
    expect(deriveLabels({ encounter: { kind: "examination", title: "УЗИ брюшной полости", specialist: null }, labNames: [], title: "x" })).toMatchObject({ kind: "examination", area: "УЗИ" });
    expect(specialtyOf("Гастроэнтеролог Иванова")).toBe("Гастроэнтерология");
    expect(specialtyOf("терапевт")).toBe("Терапия");
  });

  it("fills only empty labels and never after the user edited them", () => {
    const labels = { kind: "consultation" as const, area: "Кардиология", specialist: "кардиолог", institution: null };
    expect(applyLabels(doc({}), labels)).toMatchObject({ kind: "consultation", area: "Кардиология", specialist: "кардиолог" });
    expect(applyLabels(doc({ kind: "note", specialist: "терапевт" }), labels)).toMatchObject({ kind: "note", area: null, specialist: "терапевт" });
    expect(applyLabels(doc({ kind: "transcript" }), { ...labels, kind: "lab_report", area: "Биохимия" })).toMatchObject({ kind: "lab_report", area: "Биохимия" });
    const edited = doc({ labelsEditedAt: "2026-01-02T00:00:00Z" });
    expect(applyLabels(edited, labels)).toBe(edited);
  });

  it("groups documents into virtual folders with counts", () => {
    const docs = [
      doc({ id: "1", kind: "lab_report", area: "Биохимия", documentDate: "2026-03-01" }),
      doc({ id: "2", kind: "lab_report", area: "Биохимия", documentDate: "2025-05-01" }),
      doc({ id: "3", kind: "consultation", specialist: "кардиолог", institution: "Клиника Тест" }),
      doc({ id: "4", kind: "other" }),
    ];
    expect(buildFolders(docs, "type")).toEqual([
      { key: "Анализы", label: "Анализы", count: 2, children: [{ key: "Анализы/Биохимия", label: "Биохимия", count: 2 }] },
      { key: "Врачи", label: "Врачи", count: 1, children: [{ key: "Врачи/Кардиолог", label: "Кардиолог", count: 1 }] },
      { key: "Заметки и прочее", label: "Заметки и прочее", count: 1, children: [{ key: "Заметки и прочее/Другое", label: "Другое", count: 1 }] },
    ]);
    expect(buildFolders(docs, "year").map((f) => [f.label, f.count])).toEqual([["2026", 1], ["2025", 1], ["Без даты", 2]]);
    expect(folderOf(docs[2], "clinic")).toEqual(["Клиника Тест", "Врачи"]);
  });

  it("labels an uploaded lab form and keeps the user's own labels", async () => {
    const { service } = await createTestService();
    const text = [
      "Комплексные исследования",
      "ТЕСТОВФамилия:№ направления: 100000001 Дата: 01.03.2026",
      "Наименование исследования Результат Ед. изм. Нормальные значенияФлаг",
      "Железо мкмоль/л 9.0-21.5↑ 24.1",
      "Аланинаминотрансфераза (АЛТ) Ед/л↑ 48.2",
      "Креатинин мкмоль/л 59-10488",
    ].join("\n");
    const { document } = await service.upload("me", { fileName: "бланк.pdf.txt", mime: "text/plain", bytes: new TextEncoder().encode(text), kind: "lab_report" });
    const loaded = (await service.getDocument("me", document.id)).document;
    expect(loaded).toMatchObject({ kind: "lab_report", area: "Биохимия" });

    await service.setDocumentLabels("me", document.id, { area: "Мои анализы", specialist: "" });
    await service.fillAllFormDates();
    expect((await service.getDocument("me", document.id)).document).toMatchObject({ area: "Мои анализы", specialist: null });
  });
});
