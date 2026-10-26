import { describe, expect, it } from "vitest";
import { createTestService } from "@/adapters/testing";
import { documentFocus, focusAreas } from "./focus";
import type { Fact, SourceDocument } from "../model";

// Invented documents only.
const doc = (o: Partial<SourceDocument>): SourceDocument => ({
  id: "doc_x",
  profileId: "me",
  kind: "consultation",
  title: "Документ",
  documentDate: "2026-03-01",
  specialist: null,
  area: null,
  original: null,
  sampleKey: null,
  preparedNotice: null,
  isSynthetic: false,
  encounterId: null,
  status: "applied",
  statusMessage: null,
  createdAt: "2026-03-01T10:00:00Z",
  ...o,
});
const areas = focusAreas(undefined);
// Something already taken from doc_x, so the rules have more than the title to judge by.
const taken = [{ type: "complaint", label: "Насморк", verification: "unverified", sources: [{ documentId: "doc_x" }], value: { kind: "text", text: "Насморк" } } as unknown as Fact];
const enc = (s: string) => new TextEncoder().encode(s);

const ROUTINE = "Осмотр терапевта. Жалобы: насморк, кашель. АД 120/80. Тоны сердца ясные, ритмичные. Живот мягкий, печень не увеличена. Диагноз: ОРВИ.";

describe("focus areas", () => {
  it("matches a document by examination, specialty or indicator words, and leaves a cold out", () => {
    expect(documentFocus(doc({ kind: "examination", title: "ЭКГ" }), [], "Ритм синусовый, ЧСС 64.", areas)).toMatchObject({ status: "in", areas: ["cardio"] });
    expect(documentFocus(doc({ specialist: "Врач-уролог" }), [], "", areas).areas).toEqual(["uro"]);
    expect(documentFocus(doc({ title: "Консультация" }), [], "Рекомендована колоноскопия.", areas).areas).toEqual(["gastro"]);
    // Routine words of any visit (blood pressure, heart sounds, a soft abdomen) do not put a cold in focus.
    expect(documentFocus(doc({ specialist: "терапевт" }), taken, ROUTINE, areas)).toMatchObject({ status: "out", areas: [] });
    expect(documentFocus(doc({ status: "transcribing" }), [], "", areas).status).toBe("unknown");
    // A text nothing was taken from yet is not hidden on the strength of its title alone.
    expect(documentFocus(doc({ kind: "other", title: "Протокол" }), [], ROUTINE, areas).status).toBe("unknown");
  });

  it("places lab forms and tests by their title or the indicators they name before they are parsed", () => {
    const lab = (title: string, text = "") => documentFocus(doc({ kind: "lab_report", title, status: "extraction_ready" }), [], text, areas).areas;
    expect(lab("Исследование кала")).toEqual(["gastro"]);
    expect(lab("Клинический анализ крови")).toEqual(["iron"]);
    expect(lab("Клинический анализ мочи")).toEqual(["uro"]);
    expect(lab("Гормональные исследования")).toEqual(["metabolic"]);
    expect(lab("Лаборатория - Результаты исследований", "Холестерин общий 5,9 ммоль/л\nФерритин 120 нг/мл")).toEqual(["cardio", "iron"]);
    // Short names such as «АСТ» or «Fe» do not count: they turn up inside other words.
    expect(lab("Лаборатория", "Пастеризация, FeNO")).toEqual([]);
  });

  it("lets the user's choice win and adds the user's own areas", () => {
    expect(documentFocus(doc({ focusOverride: "in" }), [], ROUTINE, areas)).toMatchObject({ status: "in", manual: true });
    expect(documentFocus(doc({ title: "ЭКГ", focusOverride: "out" }), [], "", areas)).toMatchObject({ status: "out", manual: true });
    const mine = focusAreas({ disabled: ["cardio"], custom: [{ id: "custom_1", title: "Спина", keywords: ["позвоночник", "МРТ поясничного"] }] });
    expect(mine.map((a) => a.id)).not.toContain("cardio");
    expect(documentFocus(doc({ title: "МРТ поясничного отдела" }), [], "", mine).areas).toEqual(["custom_1"]);
  });

  it("builds an area card from lab forms and keeps facts of documents out of focus away from the chat", async () => {
    const { service, repo } = await createTestService({ now: "2026-04-01T10:00:00Z" });
    const form = (date: string, ferritin: string) =>
      [
        "Биохимический анализ крови",
        `№ направления: 1 Дата: ${date} Фамилия: ТЕСТОВ`,
        "Наименование исследования Результат Ед. изм. Нормальные значения",
        `Ферритин ${ferritin} мкг/л 30 - 400`,
      ].join("\n");
    for (const [date, value] of [["10.01.2026", "25"], ["10.03.2026", "48"]]) {
      const { document } = await service.upload("me", { fileName: `ферритин-${date}.txt`, mime: "text/plain", bytes: enc(form(date, value)), kind: "lab_report" });
      await service.applyProposal("me", document.id, { acceptedStateChanges: [], postponedClarifications: [] });
    }
    const cold = await service.upload("me", { fileName: "простуда.txt", mime: "text/plain", bytes: enc(ROUTINE), kind: "note" });
    // Nothing taken from the note yet: it waits, not hidden.
    expect((await service.focus("me")).unsorted.map((o) => o.id)).toEqual([cold.document.id]);
    const any = (await repo.listFacts("me"))[0];
    await repo.saveFact({ ...any, id: "fact_cold", type: "complaint", label: "Кашель", value: { kind: "text", text: "Кашель" }, sources: [{ ...any.sources[0], documentId: cold.document.id }] });

    const focus = await service.focus("me");
    const iron = focus.cards.find((c) => c.id === "iron")!;
    expect(iron.metrics[0]).toMatchObject({ code: "ferritin", last: { raw: "48", flag: null }, previous: { raw: "25" }, trend: "up" });
    expect(iron.nextCheck).toBeNull();
    expect(focus.outOfFocus.map((o) => o.id)).toEqual([cold.document.id]);
    expect((await service.listDocuments("me")).find((r) => r.document.id === cold.document.id)!.focus.status).toBe("out");

    // A fact read from the cold note never reaches the chat context.
    const [, answer] = await service.ask("me", "Был ли кашель?");
    expect(answer.usedContext.map((u) => u.factId)).not.toContain("fact_cold");

    await service.setDocumentFocus("me", cold.document.id, "in");
    const [, again] = await service.ask("me", "Был ли кашель?");
    expect(again.usedContext.map((u) => u.factId)).toContain("fact_cold");
  });

  it("validates the user's own areas", async () => {
    const { service } = await createTestService();
    await expect(service.setFocusSettings("me", { custom: [{ title: "Спина", keywords: "" }] })).rejects.toThrow(/хотя бы одно слово/);
    const saved = await service.setFocusSettings("me", { disabled: ["uro", "nope"], custom: [{ title: "Спина", keywords: "позвоночник, МРТ" }] });
    expect(saved.builtIn.find((a) => a.id === "uro")!.enabled).toBe(false);
    expect(saved.custom).toMatchObject([{ title: "Спина", keywords: ["позвоночник", "МРТ"] }]);
    expect(saved.cards.map((c) => c.title)).toContain("Спина");
  });
});
