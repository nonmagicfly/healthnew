// Synthetic demo documents. Invented data for the demo profile only; not related to any real person.
import type { Proposal } from "@/core/model";
import type { SampleInfo } from "@/core/ports";
import { exactDate, unknownDate } from "@/core/rules/dates";
import { clarify, draft, item, lab, med, ref, segRef, text, type DraftCtx } from "./builders";

const NOTICE = "Синтетический пример для демонстрации. Разбор подготовлен заранее.";

const LAB_JAN = `# Синтетический документ для демонстрации. Не реальные данные.
Лаборатория «Демо-Лаб». Биохимический анализ крови.
Дата взятия материала: 15.01.2026. Дата выдачи: 16.01.2026.
Ферритин | 310 | нг/мл | 20–250 | хемилюминесцентный
АЛТ | 52 | Ед/л | <41 | кинетический
ХС-ЛПНП | 3,9 | ммоль/л | <3,0 | прямой
Общий холестерин | 5,9 | ммоль/л | <5,2 | ферментативный`;

const LAB_APR = `# Синтетический документ для демонстрации. Не реальные данные.
Лаборатория «Демо-Лаб 2». Биохимический анализ крови.
Дата взятия материала: 10.04.2026. Дата выдачи: 11.04.2026.
Ферритин | 180 | нг/мл | 20–250 | хемилюминесцентный
АЛТ | 0,75 | мккат/л | <0,68 | кинетический
ГГТ | <10 | Ед/л | <55 | кинетический
ХС-ЛПНП | 2,4 | ммоль/л | <3,0 | прямой
HBsAg | не обнаружен | — | не обнаружен | ИХЛА`;

const TRANSCRIPT = `# Синтетическая расшифровка для демонстрации. Не реальные данные.
[00:00:05] Врач: Здравствуйте. Посмотрел ваши анализы от десятого апреля.
[00:00:20] Врач: Ферритин сейчас 180, в январе был 310.
[00:00:41] Пациент: Иногда бывает изжога по вечерам.
[00:01:02] Врач: По холестерину назначаю аторвастатин 10 мг вечером.
[00:01:30] Врач: Можно рассмотреть урсодезоксихолевую кислоту, если АЛТ не снизится, но пока не назначаю.
[00:02:10] Ещё [неразборчиво] по одной таблетке утром.
[00:02:40] Пациент: Аторвастатин вечером, правильно?
[00:02:45] Врач: Да, аторвастатин вечером, как договорились.
[00:03:15] Врач: Повторно сдадим липидный профиль и АЛТ через три месяца.`;

const CONSULT = `# Синтетический документ для демонстрации. Не реальные данные.
Консультация терапевта, 20.04.2026.
Жалобы: изжога по вечерам.
Анамнез: гемоэксфузия 05.02.2026, 400 мл; гемоэксфузия 05.03.2026, 400 мл.
Лабораторно: ферритин 310 нг/мл (15.01.2026), 180 нг/мл (10.04.2026); АЛТ 52 Ед/л (15.01.2026).
Заключение: Гиперферритинемия. Дислипидемия.
Назначения: аторвастатин 20 мг вечером.
Рекомендовано: контроль липидного профиля и АЛТ через 3 месяца.`;

type SyntheticSample = SampleInfo & { text: string; build: (ctx: DraftCtx) => Proposal };

function labForm(prefix: string, collected: string, rows: [string, string, string | null, string | null, string | null, string][]) {
  return (ctx: DraftCtx): Proposal => ({
    documentId: ctx.documentId,
    encounter: { key: `lab-${collected}`, kind: "lab", title: "Анализ крови (синтетический)", date: exactDate(collected), specialist: null },
    items: rows.map(([name, value, unit, refRange, method, line]) =>
      item(
        "history",
        draft(ctx, {
          key: `${prefix}:${name}`,
          type: "lab_result",
          label: `${name} ${value}${unit ? ` ${unit}` : ""}`,
          value: lab(name, value, unit, refRange, method, "lab_report"),
          sources: [ref(ctx, line)],
          eventDate: exactDate(collected),
          validity: "historical",
          problem: name === "Ферритин" ? "Обмен железа" : name === "HBsAg" ? null : "Липиды и печень",
        }),
        "Результат лабораторного бланка.",
      ),
    ),
  });
}

const rowsFrom = (t: string) =>
  t
    .split("\n")
    .filter((l) => l.includes("|"))
    .map((l) => {
      const [name, value, unit, refRange, method] = l.split("|").map((s) => s.trim());
      return [name, value, unit === "—" ? null : unit, refRange, method, l] as [string, string, string | null, string | null, string | null, string];
    });

const VISIT = { key: "visit-ther-2026-04-20", kind: "visit" as const, title: "Приём терапевта (синтетический)", date: exactDate("2026-04-20"), specialist: "Терапевт" };
const ATORVA = "demo-visit:med:atorvastatin";
const PLAN = "demo-visit:exam:control";
const HEARTBURN = "demo-visit:complaint:heartburn";

export const SYNTHETIC_SAMPLES: SyntheticSample[] = [
  {
    key: "demo-lab-2026-01-15",
    title: "Биохимия, январь (синтетический бланк)",
    kind: "lab_report",
    documentDate: "2026-01-16",
    specialist: null,
    area: "Анализы крови",
    synthetic: true,
    description: "Ферритин, АЛТ, ЛПНП, холестерин.",
    preparedNotice: NOTICE,
    text: LAB_JAN,
    build: labForm("demo-lab-jan", "2026-01-15", rowsFrom(LAB_JAN)),
  },
  {
    key: "demo-lab-2026-04-10",
    title: "Биохимия, апрель (синтетический бланк)",
    kind: "lab_report",
    documentDate: "2026-04-11",
    specialist: null,
    area: "Анализы крови",
    synthetic: true,
    description: "АЛТ в других единицах, значение «<10», качественный результат.",
    preparedNotice: NOTICE,
    text: LAB_APR,
    build: labForm("demo-lab-apr", "2026-04-10", rowsFrom(LAB_APR)),
  },
  {
    key: "demo-transcript-2026-04-20",
    title: "Расшифровка приёма терапевта (синтетическая)",
    kind: "transcript",
    documentDate: "2026-04-20",
    specialist: "Терапевт",
    area: "Терапия",
    synthetic: true,
    description: "Реплики врача и пациента, вариант лечения, неразборчивое название, повтор назначения.",
    preparedNotice: NOTICE,
    text: TRANSCRIPT,
    build(ctx) {
      const visit = exactDate("2026-04-20");
      const mention = (key: string, raw: string) =>
        item("history", draft(ctx, { key, type: "lab_result", label: `Ферритин ${raw} (со слов врача)`, value: lab("Ферритин", raw, null, null, null, "mention"), sources: [segRef(ctx, "Ферритин сейчас 180")], eventDate: unknownDate({ before: "2026-04-20" }), validity: "historical", problem: "Обмен железа" }), "Число из разговора; будет связано с бланком, если он есть.");
      return {
        documentId: ctx.documentId,
        encounter: VISIT,
        items: [
          mention("demo-visit:ferritin:180", "180"),
          mention("demo-visit:ferritin:310", "310"),
          item("state_change", draft(ctx, { key: HEARTBURN, type: "complaint", label: "Изжога по вечерам", value: text("Изжога по вечерам"), sources: [segRef(ctx, "изжога по вечерам")], eventDate: visit, validity: "unconfirmed", problem: "ЖКТ" }), "Слова пациента на приёме. Отметьте, если беспокоит сейчас.", { validity: { status: "current", from: null, to: null, confirmedAt: null } }),
          item("history", draft(ctx, { key: ATORVA, type: "medication", label: "Аторвастатин 10 мг вечером", value: med("Аторвастатин", "10 мг", "prescribed"), sources: [segRef(ctx, "назначаю аторвастатин 10 мг"), segRef(ctx, "аторвастатин вечером, как договорились")], eventDate: visit, validity: "unconfirmed", problem: "Липиды и печень" }), "Назначение. Повторное упоминание в разговоре добавлено как вторая цитата, а не как новое назначение."),
          item("history", draft(ctx, { key: "demo-visit:med:udca", type: "medication", label: "Урсодезоксихолевая кислота (обсуждалась как вариант)", value: med("Урсодезоксихолевая кислота", null, "option_discussed"), sources: [segRef(ctx, "Можно рассмотреть урсодезоксихолевую")], eventDate: visit, validity: "historical", problem: "Липиды и печень" }), "Врач обсуждал вариант, но не назначил."),
          item("history", draft(ctx, { key: "demo-visit:med:illegible", type: "medication", label: "Препарат с неразборчивым названием", value: med(null, null, "unknown"), sources: [segRef(ctx, "[неразборчиво]")], eventDate: visit, validity: "unknown" }), "Название неразборчиво, говорящий неясен. Ничего не угадываем."),
          clarify(ctx, "demo-visit:clarify:illegible", "В расшифровке неразборчиво название препарата «по одной таблетке утром», говорящий неясен. Уточните название и дозировку.", ["demo-visit:med:illegible"], "Ещё [неразборчиво] по одной таблетке утром."),
          item("history", draft(ctx, { key: PLAN, type: "examination", label: "Контроль липидного профиля и АЛТ", value: text("Повторно сдать липидный профиль и АЛТ"), sources: [segRef(ctx, "Повторно сдадим липидный профиль")], eventDate: { kind: "approx", label: "июль 2026", from: "2026-07-01", to: "2026-07-31" }, validity: "current", problem: "Липиды и печень" }), "Запланированное обследование, дата приблизительная."),
        ],
      };
    },
  },
  {
    key: "demo-consult-2026-04-20",
    title: "Консультация терапевта (синтетическая)",
    kind: "consultation",
    documentDate: "2026-04-20",
    specialist: "Терапевт",
    area: "Терапия",
    synthetic: true,
    description: "Тот же приём, что и расшифровка; дозировка расходится с разговором.",
    preparedNotice: NOTICE,
    text: CONSULT,
    build(ctx) {
      const visit = exactDate("2026-04-20");
      const hemo = (n: number, date: string) =>
        item("history", draft(ctx, { key: `demo:proc:hemoexfusion-${date}`, type: "procedure", label: "Гемоэксфузия 400 мл", value: text("Гемоэксфузия 400 мл"), sources: [ref(ctx, "Анамнез: гемоэксфузия 05.02.2026, 400 мл; гемоэксфузия 05.03.2026, 400 мл.")], eventDate: exactDate(date), validity: "historical", problem: "Обмен железа" }), `Процедура ${n} из анамнеза.`);
      const mention = (key: string, label: string, name: string, raw: string, unit: string, date: string) =>
        item("history", draft(ctx, { key, type: "lab_result", label, value: lab(name, raw, unit, null, null, "mention"), sources: [ref(ctx, "Лабораторно: ферритин 310 нг/мл (15.01.2026), 180 нг/мл (10.04.2026); АЛТ 52 Ед/л (15.01.2026).")], eventDate: exactDate(date), validity: "historical", problem: name === "Ферритин" ? "Обмен железа" : "Липиды и печень" }), "Число из консультации; связывается с бланком.");
      return {
        documentId: ctx.documentId,
        encounter: VISIT,
        items: [
          item("history", draft(ctx, { key: HEARTBURN, type: "complaint", label: "Изжога по вечерам", value: text("Изжога по вечерам"), sources: [ref(ctx, "Жалобы: изжога по вечерам.")], eventDate: visit, validity: "unconfirmed", problem: "ЖКТ" }), "Та же жалоба, что в расшифровке: добавится как второй источник."),
          hemo(1, "2026-02-05"),
          hemo(2, "2026-03-05"),
          mention("demo-consult:ferritin:310", "Ферритин 310 нг/мл (в консультации)", "Ферритин", "310", "нг/мл", "2026-01-15"),
          mention("demo-consult:ferritin:180", "Ферритин 180 нг/мл (в консультации)", "Ферритин", "180", "нг/мл", "2026-04-10"),
          mention("demo-consult:alt:52", "АЛТ 52 Ед/л (в консультации)", "АЛТ", "52", "Ед/л", "2026-01-15"),
          item("history", draft(ctx, { key: "demo-consult:dx:hyperferritinemia", type: "diagnosis", label: "Гиперферритинемия", value: text("Гиперферритинемия"), sources: [ref(ctx, "Заключение: Гиперферритинемия. Дислипидемия.")], eventDate: visit, validity: "unknown", problem: "Обмен железа" }), "Формулировка врача из заключения."),
          item("history", draft(ctx, { key: "demo-consult:dx:dyslipidemia", type: "diagnosis", label: "Дислипидемия", value: text("Дислипидемия"), sources: [ref(ctx, "Заключение: Гиперферритинемия. Дислипидемия.")], eventDate: visit, validity: "unknown", problem: "Липиды и печень" }), "Формулировка врача из заключения."),
          item("history", draft(ctx, { key: `${ATORVA}:20mg`, type: "medication", label: "Аторвастатин 20 мг вечером", value: med("Аторвастатин", "20 мг", "prescribed"), sources: [ref(ctx, "Назначения: аторвастатин 20 мг вечером.")], eventDate: visit, validity: "unconfirmed", problem: "Липиды и печень", conflictsWith: [ATORVA] }), "Дозировка расходится с расшифровкой (10 мг). Сохраняются обе версии."),
          clarify(ctx, "demo-consult:clarify:atorva-dose", "Дозировка аторвастатина расходится: 10 мг в расшифровке и 20 мг в консультации. Какая верна?", [ATORVA, `${ATORVA}:20mg`], "Назначения: аторвастатин 20 мг вечером.", "Липиды и печень"),
          item("history", draft(ctx, { key: PLAN, type: "examination", label: "Контроль липидного профиля и АЛТ", value: text("Контроль липидного профиля и АЛТ через 3 месяца"), sources: [ref(ctx, "Рекомендовано: контроль липидного профиля и АЛТ через 3 месяца.")], eventDate: { kind: "approx", label: "июль 2026", from: "2026-07-01", to: "2026-07-31" }, validity: "current", problem: "Липиды и печень" }), "То же обследование, что в расшифровке: добавится как второй источник."),
        ],
      };
    },
  },
];
