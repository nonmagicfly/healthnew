import { describe, expect, it } from "vitest";
import { createTestService } from "@/adapters/testing";
import { FIXTURE_SAMPLES } from "@/adapters/samples/fixtures";
import { SYNTHETIC_SAMPLES } from "@/adapters/samples/synthetic";
import { ValidationError } from "./service";

// Invented examples shaped like the user's documents; personal ones never enter tests.
const VISIT = "fixture-visit-2025-09-22";
const CBC = "fixture-cbc-2025-09-10";
const none = { acceptedStateChanges: [], postponedClarifications: [] };

async function openAndApply(service: Awaited<ReturnType<typeof createTestService>>["service"], profile: string, key: string, accept: (k: string) => boolean = () => false, postpone = false) {
  const { document } = await service.openSample(profile, key);
  const detail = await service.getDocument(profile, document.id);
  const items = detail.proposal!.items;
  await service.applyProposal(profile, document.id, {
    acceptedStateChanges: items.filter((i) => i.group === "state_change" && accept(i.key)).map((i) => i.key),
    postponedClarifications: postpone ? items.filter((i) => i.group === "clarify").map((i) => i.key) : [],
  });
  return document.id;
}

describe("key scenario on prepared documents of the user's profile", () => {
  it("opens an example, shows prepared data next to its source, applies a confirmed change and answers with sources", async () => {
    const { service } = await createTestService();

    // 1–2. Open the example and see extracted data next to the source.
    const { document } = await service.openSample("me", VISIT);
    const detail = await service.getDocument("me", document.id);
    expect(detail.document.status).toBe("review_pending");
    expect(detail.document.preparedNotice).toMatch(/не сверялся/);
    expect(detail.versions[0].method).toBe("prepared");
    const groups = new Set(detail.proposal!.items.map((i) => i.group));
    expect(groups).toEqual(new Set(["history", "state_change", "clarify"]));

    // 3. Confirm one proposed change (atorvastatin taken now), postpone clarifications.
    await service.applyProposal("me", document.id, {
      acceptedStateChanges: ["fx-visit:med:atorvastatin"],
      postponedClarifications: ["fx-visit:clarify:meds"],
    });

    // 4. State and history updated.
    const state = await service.state("me");
    expect(state.takingMedications.map((i) => i.label)).toEqual(["Аторвастатин"]);
    expect(state.otherMedications.map((i) => i.label).sort()).toEqual(["Витамин D", "Омепразол"]);
    expect(state.currentComplaints).toHaveLength(0);
    expect(state.documentComplaints).toHaveLength(4);
    expect(state.allergiesUnknown).toBe(true);
    expect(state.openQuestions.some((q) => q.label.includes("06.10.2025"))).toBe(true);
    expect(state.openQuestions.find((q) => q.label.startsWith("Начинали"))?.detail).toBe("Отложено");
    expect(state.conditions).toHaveLength(0); // no diagnoses invented

    const timeline = await service.timeline("me", "date");
    expect(timeline.map((g) => g.title)).toContain("2023 год");
    const exam = timeline.find((g) => g.title === "2023 год")!.entries[0];
    expect(exam.note).toBe("Из документа от 22.09.2025");
    expect(timeline.find((g) => g.key === "unknown")!.entries.some((e) => e.title.includes("гемоэксфузии"))).toBe(true);

    // 5. Indicator and its source: ferritin is only mentioned, not plotted.
    const ferritin = await service.indicator("me", "ferritin", { from: null, to: null });
    expect(ferritin.series).toHaveLength(0);
    expect(ferritin.rows.map((r) => [r.raw, r.origin, r.unit, r.collected])).toEqual([
      ["около 400", "mention", null, "дата неизвестна, до 22.09.2025"],
      ["120", "mention", null, "дата неизвестна, до 22.09.2025"],
    ]);
    expect(ferritin.rows.every((r) => r.documentId === document.id)).toBe(true);
    const alt = await service.indicator("me", "alt", { from: null, to: null });
    expect(alt.series).toHaveLength(0);
    expect(alt.qualitative[0].text).toBe("АЛТ немного выше нормы");

    // 6–7. Ask a question; the demo answer cites sources and lists used context.
    const [, answer] = await service.ask("me", "Какие препараты мне назначал терапевт?");
    expect(answer.mode).toBe("demo");
    const omep = answer.segments.find((s) => s.text.startsWith("Омепразол"))!;
    expect(omep.text).toMatch(/назначен врачом, приём не подтверждён/);
    expect(omep.sources[0].documentId).toBe(document.id);
    expect(answer.segments.some((s) => s.kind === "caution" && /не означают, что препарат нужно принимать сейчас/.test(s.text))).toBe(true);
    expect(answer.usedContext.length).toBeGreaterThan(0);
  });

  it("keeps the collection date unknown for the blood test", async () => {
    const { service } = await createTestService();
    await openAndApply(service, "me", CBC);
    const esr = await service.indicator("me", "esr", { from: null, to: null });
    expect(esr.rows).toHaveLength(1);
    expect(esr.rows[0]).toMatchObject({ raw: "7", unit: "мм/час", reference: "2–20", method: "по Вестергрену", collected: "дата неизвестна", documentDate: "2025-09-10" });
    expect(esr.series[0].points[0].dateBasis).toBe("document");
    const facts = await service.listFacts("me");
    expect(facts.filter((f) => f.type === "lab_result")).toHaveLength(1); // no invented CBC values
  });

  it("does not create duplicates when an example is opened and applied twice", async () => {
    const { service } = await createTestService();
    const id = await openAndApply(service, "me", VISIT);
    const count = (await service.listFacts("me")).length;
    const again = await service.openSample("me", VISIT);
    expect(again).toMatchObject({ duplicate: true, document: { id } });
    await service.applyProposal("me", id, none);
    expect((await service.listFacts("me")).length).toBe(count);
    expect((await service.listDocuments("me")).length).toBe(1);
  });

  it("does not duplicate an uploaded file", async () => {
    const { service } = await createTestService();
    const bytes = new TextEncoder().encode("Пациент: изжога по утрам");
    const a = await service.upload("me", { fileName: "заметка.txt", mime: "text/plain", bytes });
    const b = await service.upload("me", { fileName: "копия.txt", mime: "text/plain", bytes });
    expect(b).toMatchObject({ duplicate: true, document: { id: a.document.id } });
  });

  it("does not show a prepared parse for an arbitrary file", async () => {
    const { service } = await createTestService();
    const { document } = await service.upload("me", {
      fileName: "Консультация терапевта_1792324836952.txt",
      mime: "text/plain",
      bytes: new TextEncoder().encode("Произвольный текст"),
      kind: "consultation",
    });
    expect(document.status).toBe("extraction_unavailable");
    expect(document.statusMessage).toMatch(/Извлечение фактов не подключено/);
    expect((await service.getDocument("me", document.id)).proposal).toBeNull();
    expect(await service.listFacts("me")).toHaveLength(0);
  });

  it("rejects empty and unsupported files without changing data", async () => {
    const { service } = await createTestService();
    await expect(service.upload("me", { fileName: "a.txt", mime: "text/plain", bytes: new Uint8Array() })).rejects.toThrow(ValidationError);
    await expect(service.upload("me", { fileName: "a.docx", mime: "application/msword", bytes: new Uint8Array([1]) })).rejects.toThrow(/Поддерживаются/);
    expect(await service.listDocuments("me")).toHaveLength(0);
  });

  it("a correction updates state, history and later answers", async () => {
    const { service } = await createTestService();
    await openAndApply(service, "me", VISIT);
    const omep = (await service.listFacts("me")).find((f) => f.label === "Омепразол")!;

    await service.factAction("me", omep.id, { type: "medication_status", status: "taking_now", startDate: "2025-09-24" });
    expect((await service.state("me")).takingMedications.map((i) => i.label)).toContain("Омепразол");
    const [, answer] = await service.ask("me", "Принимаю ли я омепразол?");
    expect(answer.segments.find((s) => s.text.startsWith("Омепразол"))!.text).toMatch(/принимаете сейчас/);

    const complaint = (await service.listFacts("me")).find((f) => f.label === "Изжога")!;
    await service.factAction("me", complaint.id, { type: "correct", patch: { label: "Изжога после еды" }, reason: "Уточнение" });
    await service.factAction("me", complaint.id, { type: "confirm_current" });
    const state = await service.state("me");
    expect(state.currentComplaints.map((i) => i.label)).toEqual(["Изжога после еды"]);
    const stored = (await service.listFacts("me")).find((f) => f.id === complaint.id)!;
    expect(stored.revisions.map((r) => r.action)).toEqual(["created", "corrected", "confirmed_current"]);
    const timeline = await service.timeline("me", "date");
    expect(JSON.stringify(timeline)).toContain("Изжога после еды");

    await service.factAction("me", omep.id, { type: "end", endDate: "2025-10-01" });
    expect((await service.state("me")).takingMedications.map((i) => i.label)).not.toContain("Омепразол");
  });

  it("answers about allergies honestly when nothing is known", async () => {
    const { service } = await createTestService();
    const [, answer] = await service.ask("me", "Есть ли у меня аллергии?");
    expect(answer.segments[0]).toMatchObject({ kind: "missing" });
    expect(answer.segments[0].text).toMatch(/не означает, что аллергий нет/);
  });
});

describe("profiles and synthetic data", () => {
  it("synthetic examples open only in the demo profile and real ones only outside it", async () => {
    const { service } = await createTestService();
    await expect(service.openSample("me", "demo-lab-2026-01-15")).rejects.toThrow(/только в демо-профиле/);
    await expect(service.openSample("demo", VISIT)).rejects.toThrow(/нельзя открыть в демо-профиле/);
  });

  it("demo data never appears in the user's profile", async () => {
    const { service } = await createTestService();
    for (const s of SYNTHETIC_SAMPLES) await openAndApply(service, "demo", s.key, () => true);
    expect(await service.listFacts("me")).toHaveLength(0);
    expect(await service.listDocuments("me")).toHaveLength(0);
    expect((await service.state("me")).factCount).toBe(0);
    expect((await service.indicator("me", "ferritin", { from: null, to: null })).rows).toHaveLength(0);
    expect(await service.timeline("me", "date")).toHaveLength(0);
    const [, answer] = await service.ask("me", "Как менялся ферритин?");
    expect(answer.usedContext).toHaveLength(0);
    const demoDoc = (await service.listDocuments("demo"))[0].document;
    await expect(service.getDocument("me", demoDoc.id)).rejects.toThrow(/не найден/);
  });
});

describe("transcripts and lab dynamics in the demo profile", () => {
  async function demo() {
    const ctx = await createTestService();
    for (const s of SYNTHETIC_SAMPLES) await openAndApply(ctx.service, "demo", s.key, () => true, true);
    return ctx;
  }

  it("links mentions to lab forms so one measurement is one point", async () => {
    const { service } = await demo();
    const v = await service.indicator("demo", "ferritin", { from: null, to: null });
    expect(v.series).toHaveLength(1);
    expect(v.series[0].points.map((p) => p.value)).toEqual([310, 180]);
    const mentions = v.rows.filter((r) => r.origin === "mention");
    expect(mentions.length).toBe(4);
    expect(mentions.every((r) => r.linkedResultId)).toBe(true);
    expect(v.marks.filter((m) => m.kind === "treatment").map((m) => m.date)).toEqual(expect.arrayContaining(["2026-02-05", "2026-03-05"]));
  });

  it("keeps ALT in different units on separate lines", async () => {
    const { service } = await demo();
    const v = await service.indicator("demo", "alt", { from: null, to: null });
    expect(v.series.map((s) => s.unit).sort()).toEqual(["Ед/л", "мккат/л"]);
    const ggt = await service.indicator("demo", "ggt", { from: null, to: null });
    expect(ggt.rows[0]).toMatchObject({ raw: "<10", valueType: "less_than" });
  });

  it("distinguishes speakers, options, illegible names, repeats and conflicts", async () => {
    const { service } = await demo();
    const facts = await service.listFacts("demo");
    const atorva = facts.filter((f) => f.value.kind === "medication" && f.value.name === "Аторвастатин");
    expect(atorva).toHaveLength(2); // 10 mg (transcript, cited twice) and 20 mg (consultation), not three
    const tenMg = atorva.find((f) => f.value.kind === "medication" && f.value.dose === "10 мг")!;
    expect(tenMg.sources.map((s) => s.timecode)).toEqual(["00:01:02", "00:02:45"]);
    expect(tenMg.sources[0].speaker).toBe("doctor");
    expect(atorva[0].conflictGroupId).toBeTruthy();
    expect(atorva[0].conflictGroupId).toBe(atorva[1].conflictGroupId);
    expect(atorva.every((f) => f.value.kind === "medication" && f.value.status === "prescribed")).toBe(true);

    const udca = facts.find((f) => f.value.kind === "medication" && f.value.status === "option_discussed")!;
    expect(udca.label).toMatch(/Урсодезоксихолевая/);

    const illegible = facts.find((f) => f.value.kind === "medication" && f.value.name === null)!;
    expect(illegible.sources[0].speaker).toBe("unclear");
    const state = await service.state("demo");
    expect(state.openQuestions.some((q) => q.label.includes("неразборчиво"))).toBe(true);
    expect(state.openQuestions.some((q) => q.label.includes("Дозировка аторвастатина"))).toBe(true);
    expect(state.conditions.map((c) => c.label).sort()).toEqual(["Гиперферритинемия", "Дислипидемия"]);

    // Same complaint from the transcript and the consultation of the same visit is one fact with two sources.
    const heartburn = facts.filter((f) => f.label === "Изжога по вечерам");
    expect(heartburn).toHaveLength(1);
    expect(new Set(heartburn[0].sources.map((s) => s.documentId)).size).toBe(2);

    // Both documents are linked to one visit.
    const timeline = await service.timeline("demo", "specialist");
    const visit = timeline.find((g) => g.title === "Терапевт")!.entries.find((e) => e.kind === "visit")!;
    expect(visit.documentIds).toHaveLength(2);
  });
});

describe("prepared data integrity", () => {
  it("every exact quote in synthetic samples exists in the sample text", async () => {
    const { service } = await createTestService();
    for (const s of SYNTHETIC_SAMPLES) {
      const id = await openAndApply(service, "demo", s.key);
      const d = await service.getDocument("demo", id);
      for (const f of d.facts) for (const src of f.sources.filter((x) => x.documentId === id)) {
        expect(src.quoteIsExact).toBe(true);
        expect(s.text).toContain(src.quote);
      }
    }
  });

  it("every fact from prepared examples is marked as a paraphrase without a page", async () => {
    const { service } = await createTestService();
    for (const s of FIXTURE_SAMPLES) await openAndApply(service, "me", s.key);
    const facts = await service.listFacts("me");
    expect(facts.length).toBeGreaterThan(10);
    for (const f of facts) {
      expect(f.verification).toBe("unverified");
      expect(f.extraction.method).toBe("prepared");
      expect(f.sources.every((s) => !s.quoteIsExact && s.page === null)).toBe(true);
      expect(f.documentDate).not.toBeNull();
    }
  });
});

describe("corrections of lab results", () => {
  it("setting the collection date moves the point from document date to the real date; history keeps the old value", async () => {
    const { service } = await createTestService();
    await openAndApply(service, "me", CBC);
    const esr = (await service.listFacts("me")).find((f) => f.type === "lab_result")!;
    await service.factAction("me", esr.id, { type: "correct", patch: { eventDate: "2025-09-09" }, reason: "Дата из бланка" });
    const v = await service.indicator("me", "esr", { from: null, to: null });
    expect(v.series[0].points[0]).toMatchObject({ date: "2025-09-09", dateBasis: "collected" });
    const stored = (await service.listFacts("me")).find((f) => f.id === esr.id)!;
    expect(stored.revisions.at(-1)!.before!.eventDate).toEqual({ kind: "unknown" });
    await expect(service.factAction("me", esr.id, { type: "correct", patch: {}, reason: null })).rejects.toThrow(/Нечего исправлять/);
  });
});
