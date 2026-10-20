import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { parseConsultation } from "./consultation";
import { createTestService } from "@/adapters/testing";
import { liveModel } from "@/adapters/llm/live";
import type { StructuredModel, StructuredRequest } from "@/adapters/llm/structured";

// Invented consultation in the layout of a real clinic's visit report; no real person or values.
const VISIT = [
  [
    "Клиника Тестовая на Садовой",
    "г Москва ул Садовая д. 1",
    "+7 (495) 000-00-00",
    "Дата: 05.05.2026",
    "Пациент: ТЕСТОВ Иван Петрович",
    "Пол: мужской",
    "ОСМОТР КАРДИОЛОГА",
    "Повод обращения: Лечебно-диагностический",
    "Жалобы: на одышку при нагрузке, сердцебиение.",
    "История настоящего заболевания: жалобы около месяца. Ранее принимал препараты нерегулярно.",
    "10.01.2026 Эхокардиография. Заключение: Камеры сердца не расширены. Фракция выброса сохранена.",
    "Заключение по диагнозу:",
    "Основное заболевание: (заключительный) Наджелудочковая экстрасистолия. Гиперхолестеринемия. (I49.1)",
    "Общие рекомендации:",
    "Медикаментозная терапия: Бисопролол (БИСОПРОЛОЛ ТАБ. 2.5 МГ), по 1 таб. 1 раз/дн., длительность 1 мес., внутрь (per os).",
    "Аторвастатин (АТОРВАСТАТИН ТАБ., ПОКР. ОБОЛОЧКОЙ, 20 МГ), по 1 таб. 1 раз/дн., длительность 3 мес., внутрь (per os), вечером.",
    "Назначена повторная явка на 05.06.2026.",
  ].join("\n"),
  ["Врач кардиолог: Докторова Анна Сергеевна", "__________"].join("\n"),
];

describe("consultation parser", () => {
  it("reads the visit, complaints, diagnoses, prescriptions and the next visit", () => {
    const r = parseConsultation(VISIT)!;
    expect(r.patientName).toBe("ТЕСТОВ Иван Петрович");
    expect(r.documentDate).toMatchObject({ kind: "exact", date: "2026-05-05" });
    expect(r.encounter).toMatchObject({ kind: "visit", title: "Осмотр кардиолога", specialist: "кардиолог", institution: "Клиника Тестовая на Садовой" });
    const by = (t: string) => r.items.filter((i) => i.type === t);
    expect(by("complaint").map((i) => i.label)).toEqual(["Одышку при нагрузке", "Сердцебиение"]);
    expect(by("diagnosis").map((i) => i.label)).toEqual(["Наджелудочковая экстрасистолия (I49.1)", "Гиперхолестеринемия"]);
    expect(by("medication").map((i) => [i.label, i.medication])).toEqual([
      ["Бисопролол 2.5 мг", { name: "Бисопролол", dose: "2.5 мг, по 1 таб. 1 раз/дн., длительность 1 мес.", status: "prescribed" }],
      ["Аторвастатин 20 мг", { name: "Аторвастатин", dose: "20 мг, по 1 таб. 1 раз/дн., длительность 3 мес.", status: "prescribed" }],
    ]);
    expect(by("examination")[0]).toMatchObject({ label: "Эхокардиография: Камеры сердца не расширены. Фракция выброса сохранена", eventDate: { date: "2026-01-10" } });
    expect(by("appointment")[0]).toMatchObject({ eventDate: { date: "2026-06-05" } });
  });

  it("does not take a conversation or a lab form for a consultation", () => {
    expect(parseConsultation(["Врач: Как самочувствие?\nПациент: Хорошо."])).toBeNull();
    expect(parseConsultation(["Клинический анализ крови\nНаименование исследования Результат Ед. изм.\nСОЭ мм/час 1-152"])).toBeNull();
  });

  it("parses a consultation locally and never sends it to the model", async () => {
    const calls: StructuredRequest[] = [];
    const fake: StructuredModel = {
      provider: "Тест",
      model: "fake-1",
      async generate<S extends z.ZodType>(req: StructuredRequest): Promise<z.infer<S>> {
        calls.push(req);
        throw new Error("must not be called");
      },
    };
    const { service } = await createTestService({ live: liveModel(fake) });
    const { document } = await service.upload("me", { fileName: "приём.txt", mime: "text/plain", bytes: new TextEncoder().encode(VISIT.join("\n")) });
    expect(document.status).toBe("review_pending");
    await service.extractWithModel("me", document.id, true);
    expect(calls).toHaveLength(0);
    const loaded = (await service.getDocument("me", document.id)).document;
    expect(loaded).toMatchObject({ kind: "consultation", specialist: "кардиолог", area: "Кардиология", institution: "Клиника Тестовая на Садовой", documentDate: "2026-05-05" });
  });
});
