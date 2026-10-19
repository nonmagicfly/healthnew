import { describe, expect, it } from "vitest";
import { parseLabForm, splitReferenceAndValue } from "./lab-form";
import { createTestService } from "@/adapters/testing";

// Invented form in the layout of a real lab: columns of the text layer are glued together.
const FORM = (surname: string, date: string) => [
  [
    "Комплексные исследования",
    `${surname}Фамилия:№ направления: 100000001 Дата: ${date}`,
    "ИванИмя:ЛПУ: Карта: 0000001",
    "ПетровичОтчество:Отделение:",
    "Номер заказа: 1000000001",
    "Наименование исследования Результат Ед. изм. Нормальные значенияФлаг",
    "Исследование - (L00.00.00.0.001) Гематологический (Кл. анализ крови), биоматериал - Кровь",
    "(HGB) Гемоглобин г/л 132-173141",
    "(MCH) Среднее содержание",
    "гемоглобина в эритроците пг 27.0-34.029.5",
    "Железо мкмоль/л 9.0-21.5↑ 24.1",
    "Железо мкмоль/л 9.0-21.5↑ 24.1",
    "Аланинаминотрансфераза (АЛТ) Ед/л↑ 48.2",
    "Пороговые значения для здоровых людей: менее 5 ммоль/л (190 мг/дл);",
    "Холестерин общий ммоль/л см. комментарий5.6",
  ].join("\n"),
  [
    "Креатинин мкмоль/л 59-10488",
    "Холестерин-неЛПВП (холестерин, не",
    "связанный с липопротеинами высокой",
    "плотности)",
    "ммоль/л3.1",
    "Иванова Мария Сергеевна01.03.2026 12:00:00 Врач КДЛ:",
  ].join("\n"),
];

describe("lab form parser", () => {
  it("splits glued reference and result by the decimals of the lower bound", () => {
    expect(splitReferenceAndValue("4.50-11.006.09")).toEqual({ reference: "4.50-11.00", value: "6.09", flag: null });
    expect(splitReferenceAndValue("132-173155")).toEqual({ reference: "132-173", value: "155", flag: null });
    expect(splitReferenceAndValue("59-10491")).toEqual({ reference: "59-104", value: "91", flag: null });
    expect(splitReferenceAndValue("0.0-0.50")).toEqual({ reference: "0.0-0.5", value: "0", flag: null });
    expect(splitReferenceAndValue("187 - 883412")).toEqual({ reference: "187-883", value: "412", flag: null });
    expect(splitReferenceAndValue("0.510-2.0501.65")).toEqual({ reference: "0.510-2.050", value: "1.65", flag: null });
    expect(splitReferenceAndValue("31.61-36.38↓ 30.9")).toEqual({ reference: "31.61-36.38", value: "30.9", flag: "low" });
    expect(splitReferenceAndValue("см. комментарий1.25")).toEqual({ reference: "см. комментарий", value: "1.25", flag: null });
    expect(splitReferenceAndValue("↑ 57.5")).toEqual({ reference: null, value: "57.5", flag: "high" });
    expect(splitReferenceAndValue("(40 мг/дл);")).toBeNull();
  });

  it("reads every result row, joins wrapped names and skips comments and repeats", () => {
    const r = parseLabForm(FORM("ТЕСТОВ", "01.03.2026"))!;
    expect(r.patientName).toBe("ТЕСТОВ Иван Петрович");
    expect(r.documentDate).toMatchObject({ kind: "exact", date: "2026-03-01" });
    expect(r.encounter).toMatchObject({ kind: "lab", title: "Комплексные исследования" });
    expect(r.items.map((i) => [i.lab!.name, i.lab!.value, i.lab!.unit, i.lab!.reference, i.page])).toEqual([
      ["(HGB) Гемоглобин", "141", "г/л", "132-173", 1],
      ["(MCH) Среднее содержание гемоглобина в эритроците", "29.5", "пг", "27.0-34.0", 1],
      ["Железо", "24.1", "мкмоль/л", "9.0-21.5", 1],
      ["Аланинаминотрансфераза (АЛТ)", "48.2", "Ед/л", null, 1],
      ["Холестерин общий", "5.6", "ммоль/л", "см. комментарий", 1],
      ["Креатинин", "88", "мкмоль/л", "59-104", 2],
      ["Холестерин-неЛПВП (холестерин, не связанный с липопротеинами высокой плотности)", "3.1", "ммоль/л", null, 2],
    ]);
  });

  it("does not claim a layout it does not know", () => {
    expect(parseLabForm(["Консультация терапевта\nЖалобы: слабость."])).toBeNull();
  });

  it("parses an uploaded form locally, without a model, and points out another patient's form", async () => {
    const { service } = await createTestService();
    const upload = (name: string, text: string[]) =>
      service.upload("me", { fileName: name, mime: "text/plain", bytes: new TextEncoder().encode(text.join("\n")), kind: "lab_report" });
    const { document } = await upload("бланк-1.txt", FORM("ТЕСТОВ", "01.03.2026"));
    expect(document.status).toBe("review_pending");
    const { proposal } = await service.getDocument("me", document.id);
    expect(proposal!.items.every((i) => i.draft.extraction.method === "parser")).toBe(true);
    expect(proposal!.items.find((i) => i.draft.label.startsWith("(HGB)"))!.draft.value).toMatchObject({ indicator: "hgb", reference: { low: 132, high: 173 } });
    await service.applyProposal("me", document.id, { acceptedStateChanges: [], postponedClarifications: [] });

    const other = await upload("бланк-2.txt", FORM("ДРУГОВА", "02.03.2026"));
    const p2 = (await service.getDocument("me", other.document.id)).proposal!;
    expect(p2.items[0]).toMatchObject({ group: "clarify", draft: { label: expect.stringContaining("ДРУГОВА") } });
  });
});
