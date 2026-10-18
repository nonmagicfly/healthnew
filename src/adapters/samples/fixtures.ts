// Invented prepared samples shaped like a user's documents, for tests and e2e only
// (HEALTH_SAMPLES=fixtures). They contain no real personal data.
import { exactDate, unknownDate } from "@/core/rules/dates";
import { clarify, draft, item, lab, med, qual, ref, text } from "./builders";
import { PREPARED_NOTICE, type PreparedSample } from "./prepared";

export const FIXTURE_SAMPLES: PreparedSample[] = [
  {
    key: "fixture-cbc-2025-09-10",
    title: "Клинический анализ крови",
    kind: "lab_report",
    documentDate: "2025-09-10",
    specialist: null,
    area: "Анализы крови",
    synthetic: false,
    description: "Документ от 10.09.2025 с одним показателем (СОЭ).",
    preparedNotice: PREPARED_NOTICE,
    pages: [
      [
        "Подготовленное описание, не текст оригинала.",
        "Документ: «Клинический анализ крови». Дата документа: 10.09.2025.",
        "Содержит только СОЭ: 7 мм/час, референс 2–20, метод Вестергрена.",
        "Дата забора материала в описании не указана.",
      ].join("\n"),
    ],
    build(ctx) {
      const esr = draft(ctx, {
        key: "fx-cbc:esr",
        type: "lab_result",
        label: "СОЭ 7 мм/час",
        value: lab("СОЭ", "7", "мм/час", "2–20", "по Вестергрену", "lab_report"),
        sources: [ref(ctx, "СОЭ: 7 мм/час, референс 2–20, метод Вестергрена")],
        // Collection date is not known; the document date is kept separately.
        eventDate: unknownDate(),
        validity: "historical",
        problem: "Общий анализ крови",
      });
      return {
        documentId: ctx.documentId,
        encounter: null,
        items: [
          item("history", esr, "Результат анализа. Других показателей общего анализа крови в документе нет."),
          clarify(ctx, "fx-cbc:clarify:collected", "Дата забора крови для СОЭ не указана. Если знаете её, укажите в результате.", ["fx-cbc:esr"], "Дата забора материала в описании не указана."),
        ],
      };
    },
  },
  {
    key: "fixture-visit-2025-09-22",
    title: "Консультация терапевта",
    kind: "consultation",
    documentDate: "2025-09-22",
    specialist: "Терапевт",
    area: "Терапия",
    synthetic: false,
    description: "Консультация от 22.09.2025: жалобы, ферритин, статин, назначения, повторная явка.",
    preparedNotice: PREPARED_NOTICE,
    pages: [
      [
        "Подготовленное описание, не текст оригинала.",
        "Документ: «Консультация терапевта». Дата: 22.09.2025.",
        "Жалобы: изжога, отрыжка, слабость и сухость во рту.",
        "Ферритин ранее около 400, затем 120 после трёх гемоэксфузий по 300 мл. Даты анализов и единицы не указаны.",
        "Указан приём аторвастатина, дозировка не указана.",
        "ЛПНП в пределах целевых значений (без чисел). АЛТ немного выше нормы (без чисел).",
        "Назначены омепразол и витамин D.",
        "Повторная явка: 06.10.2025.",
        "Упоминаются обследования от 15.11.2023.",
        "Формулировки диагнозов из заключения в описание не перенесены.",
      ].join("\n"),
    ],
    build(ctx) {
      const visit = exactDate("2025-09-22");
      const beforeVisit = unknownDate({ before: "2025-09-22" });
      const complaint = (key: string, label: string) =>
        item(
          "state_change",
          draft(ctx, { key: `fx-visit:complaint:${key}`, type: "complaint", label, value: text(label), sources: [ref(ctx, "Жалобы: изжога, отрыжка, слабость и сухость во рту.")], eventDate: visit, validity: "unconfirmed", problem: "Общее самочувствие" }),
          "Жалоба зафиксирована 22.09.2025. Отметьте, только если она есть сейчас.",
          { validity: { status: "current", from: null, to: null, confirmedAt: null } },
        );
      const ferr = (key: string, raw: string, quote: string) =>
        item(
          "history",
          draft(ctx, { key: `fx-visit:ferritin:${key}`, type: "lab_result", label: `Ферритин ${raw} (упоминание в консультации)`, value: lab("Ферритин", raw, null, null, null, "mention"), sources: [ref(ctx, quote)], eventDate: beforeVisit, validity: "historical", problem: "Обмен железа" }),
          "Число из консультации, а не результат бланка. Дата анализа и единицы не указаны.",
        );
      return {
        documentId: ctx.documentId,
        encounter: { key: "visit-therapist-2025-09-22", kind: "visit", title: "Консультация терапевта", date: visit, specialist: "Терапевт" },
        items: [
          complaint("heartburn", "Изжога"),
          complaint("belching", "Отрыжка"),
          complaint("weakness", "Слабость"),
          complaint("dry-mouth", "Сухость во рту"),
          ferr("400", "около 400", "Ферритин ранее около 400"),
          item(
            "history",
            draft(ctx, { key: "fx-visit:procedure:hemoexfusion", type: "procedure", label: "Три гемоэксфузии по 300 мл", value: text("Три гемоэксфузии по 300 мл"), sources: [ref(ctx, "после трёх гемоэксфузий по 300 мл")], eventDate: beforeVisit, validity: "historical", problem: "Обмен железа" }),
            "Процедуры упомянуты в консультации, даты не указаны.",
          ),
          ferr("120", "120", "затем 120 после трёх гемоэксфузий по 300 мл"),
          clarify(ctx, "fx-visit:clarify:ferritin", "Ферритин «около 400» и 120: даты анализов и единицы в консультации не указаны. Загрузите исходные бланки или укажите сведения.", ["fx-visit:ferritin:400", "fx-visit:ferritin:120"], "Даты анализов и единицы не указаны.", "Обмен железа"),
          item(
            "state_change",
            draft(ctx, { key: "fx-visit:med:atorvastatin", type: "medication", label: "Аторвастатин", value: med("Аторвастатин", null, "mentioned_taking"), sources: [ref(ctx, "Указан приём аторвастатина, дозировка не указана.")], eventDate: visit, validity: "unconfirmed", problem: "Липидный профиль" }),
            "В консультации указан приём аторвастатина без дозировки. Отметьте, если принимаете сейчас.",
            { medicationStatus: "taking_now" },
          ),
          item("history", draft(ctx, { key: "fx-visit:qual:ldl", type: "qualitative_finding", label: "ЛПНП в пределах целевых значений", value: qual("ldl", "ЛПНП в пределах целевых значений"), sources: [ref(ctx, "ЛПНП в пределах целевых значений (без чисел).")], eventDate: beforeVisit, validity: "historical", problem: "Липидный профиль" }), "Качественная формулировка без числа: на график не попадёт."),
          item("history", draft(ctx, { key: "fx-visit:qual:alt", type: "qualitative_finding", label: "АЛТ немного выше нормы", value: qual("alt", "АЛТ немного выше нормы"), sources: [ref(ctx, "АЛТ немного выше нормы (без чисел).")], eventDate: beforeVisit, validity: "historical", problem: "Печень" }), "Качественная формулировка без числа: на график не попадёт."),
          item("history", draft(ctx, { key: "fx-visit:med:omeprazole", type: "medication", label: "Омепразол", value: med("Омепразол", null, "prescribed"), sources: [ref(ctx, "Назначены омепразол и витамин D.")], eventDate: visit, validity: "unconfirmed", problem: "Общее самочувствие" }), "Назначение врача. Фактический приём не подтверждён."),
          item("history", draft(ctx, { key: "fx-visit:med:vitamin-d", type: "medication", label: "Витамин D", value: med("Витамин D", null, "prescribed"), sources: [ref(ctx, "Назначены омепразол и витамин D.")], eventDate: visit, validity: "unconfirmed", problem: "Общее самочувствие" }), "Назначение врача. Фактический приём не подтверждён."),
          clarify(ctx, "fx-visit:clarify:meds", "Начинали ли вы приём омепразола и витамина D? Назначение не подтверждает приём.", ["fx-visit:med:omeprazole", "fx-visit:med:vitamin-d"], "Назначены омепразол и витамин D.", "Общее самочувствие"),
          item("history", draft(ctx, { key: "fx-visit:appointment:2025-10-06", type: "appointment", label: "Повторная явка к терапевту 06.10.2025", value: { kind: "appointment", attended: "unknown" }, sources: [ref(ctx, "Повторная явка: 06.10.2025.")], eventDate: exactDate("2025-10-06"), validity: "unknown", problem: "Общее самочувствие" }), "Факт посещения неизвестен."),
          item("history", draft(ctx, { key: "fx-visit:exam:2023-11-15", type: "examination", label: "Обследования от 15.11.2023 (вид в описании не указан)", value: text("Обследования от 15.11.2023"), sources: [ref(ctx, "Упоминаются обследования от 15.11.2023.")], eventDate: exactDate("2023-11-15"), validity: "historical", problem: "Общее самочувствие" }), "Историческое событие 2023 года, а не сентября 2025."),
          clarify(ctx, "fx-visit:clarify:diagnoses", "Формулировки диагнозов из заключения в подготовленный разбор не перенесены. Сверьте с оригиналом и добавьте их при необходимости.", [], "Формулировки диагнозов из заключения в описание не перенесены."),
        ],
      };
    },
  },
];
