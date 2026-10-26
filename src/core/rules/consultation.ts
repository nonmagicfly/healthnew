// Local parser for a doctor's consultation laid out in labelled sections
// («Жалобы:», «Основное заболевание:», «Медикаментозная терапия:», «Назначена повторная явка на …»).
// Free and offline: nothing is sent to a model. What rules cannot read reliably (the narrative
// history of the illness) is left out; it can still be read by the model on the user's request.
import type { ExtractedDate, ExtractedItem, ExtractionOutput } from "./extraction";
import { normalizeIsoDate } from "./extraction";

export interface ConsultationResult extends ExtractionOutput {
  patientName: string | null;
}

const UNKNOWN: ExtractedDate = { kind: "unknown", date: null, label: null, before: null, after: null };
const exact = (ru: string | undefined): ExtractedDate => {
  const iso = normalizeIsoDate(ru);
  return iso ? { kind: "exact", date: iso, label: null, before: null, after: null } : UNKNOWN;
};

const HEADINGS = [
  "Повод обращения",
  "Место обслуживания",
  "Жалобы",
  "История настоящего заболевания",
  "Анамнез заболевания",
  "Анамнез жизни",
  "Анамнез",
  "Объективно",
  "Объективный статус",
  "Заключение по диагнозу",
  "Диагноз",
  "Основное заболевание",
  "Конкурирующее заболевание",
  "Сопутствующие заболевания",
  "Сопутствующее заболевание",
  "Осложнения основного заболевания",
  "Осложнения",
  "Общие рекомендации",
  "Рекомендации",
  "Медикаментозная терапия",
  "Немедикаментозная терапия",
  "Назначения",
];
const HEADING = new RegExp(String.raw`^(${HEADINGS.join("|")})\s*:`, "gm");
const VISIT = /^(?:ОСМОТР|КОНСУЛЬТАЦИЯ|ПР[ИЕЁ]М)\s+(?:ВРАЧА[-\s]+)?([А-ЯЁ-]{4,})\s*$/m;
const DIAGNOSIS_SECTIONS = ["Диагноз", "Основное заболевание", "Конкурирующее заболевание", "Сопутствующие заболевания", "Сопутствующее заболевание", "Осложнения основного заболевания", "Осложнения"];
const ICD = /\(\s*([A-Z]\d{2}(?:\.\d{1,2})?)\s*\)/g;
const NEXT_VISIT = /(?:Назначена\s+)?повторная\s+явка(?:\s+на)?\s*:?\s*(\d{2}\.\d{2}\.\d{4})/i;
const EXAM_LINE = /^(\d{2}\.\d{2}\.\d{4})\s+([^.\n]{3,80})\.\s*Заключение:\s*/gm;

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** «ГАСТРОЭНТЕРОЛОГА» → «гастроэнтеролог», «ТЕРАПЕВТА» → «терапевт». */
function nominative(word: string) {
  const w = word.toLowerCase();
  return /[^аеёиоуыэюя]а$/.test(w) ? w.slice(0, -1) : w;
}

function sections(text: string): Map<string, string> {
  const found = [...text.matchAll(HEADING)];
  const out = new Map<string, string>();
  found.forEach((m, i) => {
    const start = m.index! + m[0].length;
    const end = i + 1 < found.length ? found[i + 1].index! : text.length;
    if (!out.has(m[1])) out.set(m[1], text.slice(start, end).trim());
  });
  return out;
}

const item = (o: Partial<ExtractedItem> & Pick<ExtractedItem, "type" | "label" | "quote">): ExtractedItem => ({
  group: "history",
  page: null,
  eventDate: UNKNOWN,
  problem: null,
  explanation: "Разобрано по шаблону консультации; проверьте по источнику.",
  lab: null,
  medication: null,
  qualitative: null,
  proposeCurrent: false,
  aboutItems: [],
  ...o,
});

/** Splits running text into sentences; brackets (gene variants, codes) never end a sentence. */
function sentences(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === "." && depth === 0 && /^\s+[А-ЯЁA-Z]/.test(text.slice(i + 1, i + 3))) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((s) => s.replace(/\.\s*$/, "").trim()).filter((s) => s.length >= 3);
}

/** The text up to the bracket that closes the one opening at `open`. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

function medications(section: string, date: ExtractedDate): ExtractedItem[] {
  // Each prescription starts with the drug name followed by its product in brackets: «Рифаксимин (…), по 1 таб.…».
  const starts = [...section.matchAll(/(?:^|(?<=\.)\s+)([А-ЯЁ][а-яё-]+(?:\s[а-яё-]+){0,3})\s\(/g)].map((m) => m.index! + (m[0].length - m[0].trimStart().length));
  return starts.flatMap((s, i) => {
    // The last prescription ends where the next visit or the signature begins.
    const raw = section.slice(s, starts[i + 1] ?? section.length);
    const entry = raw.slice(0, raw.search(/\n\s*(?:Назначена|Повторная явка|Врач[\s-])|$/)).trim();
    const open = entry.indexOf("(");
    const close = closing(entry, open);
    if (open < 0 || close < 0) return [];
    const name = one(entry.slice(0, open));
    const product = one(entry.slice(open + 1, close));
    const strength = product.match(/(\d+(?:[.,]\d+)?\s*(?:мг|мкг|г|мл|ме|ед|%))(?![а-яё])/i)?.[1].toLowerCase().replace(/\s+/g, " ") ?? null;
    const scheme = one(entry.slice(close + 1))
      .replace(/^,\s*/, "")
      .split(/,\s+/)
      .filter((p) => /^(по |длительность|\d+ раз|ежедневно|утром|вечером|на ночь)/i.test(p))
      .slice(0, 2)
      .join(", ");
    const dose = [strength, scheme].filter(Boolean).join(", ") || null;
    return [
      item({
        type: "medication",
        label: [name, strength].filter(Boolean).join(" "),
        quote: one(entry).slice(0, 160),
        eventDate: date,
        explanation: "Назначение врача, разобрано по шаблону консультации. Приём отмечаете вы сами.",
        medication: { name, dose, status: "prescribed" },
      }),
    ];
  });
}

/** Parses a consultation with labelled sections, or returns null when the layout is not recognized. */
export function parseConsultation(pages: string[]): ConsultationResult | null {
  const text = pages.join("\n");
  const visit = text.match(VISIT);
  const parts = sections(text);
  const hasContent = parts.has("Жалобы") || DIAGNOSIS_SECTIONS.some((s) => parts.has(s)) || parts.has("Медикаментозная терапия");
  if (!visit || !hasContent) return null;

  const date = exact(text.match(/^\s*Дата(?: приема| приёма| осмотра)?:\s*(\d{2}\.\d{2}\.\d{4})/m)?.[1]);
  // The signature names the specialty in the nominative («Врач гастроэнтеролог, …»); the heading has it in the genitive.
  const signed = text.match(/^\s*Врач[\s-]+([а-яё-]{4,})(?=[,\s])/m)?.[1];
  const specialist = signed && signed !== "клинической" ? signed : nominative(visit[1]);
  const header = text.slice(0, text.search(/^\s*Дата/m)).split("\n").map((l) => l.trim()).filter(Boolean);
  const institution = header.find((l) => !/^(г\.?\s|ул\.?\s|\+?\d|тел|пн|вт|ср|чт|пт|сб|вс)/i.test(l)) ?? null;
  const patientName = one(text.match(/^\s*Пациент:\s*([^\n]+)/m)?.[1] ?? "") || null;
  const items: ExtractedItem[] = [];

  const complaints = parts.get("Жалобы");
  if (complaints) {
    const first = complaints.split(/\.\s|\n/)[0].replace(/^на\s+/i, "").replace(/\.$/, "");
    for (const c of first.split(/,\s*/).map((c) => c.trim()).filter((c) => c.length >= 3)) {
      items.push(item({ type: "complaint", label: cap(c), quote: c, eventDate: date, proposeCurrent: true, explanation: "Жалоба на приёме, разобрано по шаблону консультации." }));
    }
  }

  for (const name of DIAGNOSIS_SECTIONS) {
    // A section ends where the next visit or the signature begins, even without a heading of its own.
    const body = parts.get(name)?.split(/\n\s*(?:Назначена|Повторная явка|Врач[\s-])/)[0];
    if (!body) continue;
    const codes = [...body.matchAll(ICD)].map((m) => m[1]);
    const clean = body.replace(ICD, "").replace(/^\s*\((?:заключительный|предварительный|основной)\)\s*/i, "");
    sentences(one(clean)).forEach((s, i) => {
      const code = i === 0 && codes.length ? ` (${codes.join(", ")})` : "";
      items.push(item({ type: "diagnosis", label: `${s}${code}`, quote: s, eventDate: date, explanation: `${name} по заключению врача, разобрано по шаблону консультации.` }));
    });
  }

  const therapy = parts.get("Медикаментозная терапия") ?? parts.get("Назначения");
  if (therapy) items.push(...medications(therapy, date));

  // Examinations the doctor cites with their date and conclusion: «24.03.2024 ЭГДС. Заключение: …».
  const history = parts.get("История настоящего заболевания") ?? parts.get("Анамнез заболевания") ?? "";
  const exams = [...history.matchAll(EXAM_LINE)];
  exams.forEach((m, i) => {
    const end = i + 1 < exams.length ? exams[i + 1].index! : history.length;
    const conclusion = sentences(one(history.slice(m.index! + m[0].length, end))).filter((s) => !/^(Кардиолог|Также|Провел|Продолжает)/.test(s)).slice(0, 3).join(". ");
    if (!conclusion) return;
    items.push(item({ type: "examination", label: `${one(m[2])}: ${conclusion}`, quote: one(m[0]) + " " + conclusion.slice(0, 80), eventDate: exact(m[1]), explanation: "Обследование, на которое ссылается врач; разобрано по шаблону консультации." }));
  });

  const next = text.match(NEXT_VISIT);
  if (next) items.push(item({ type: "appointment", label: `Повторная явка к врачу: ${specialist}`, quote: one(next[0]), eventDate: exact(next[1]), explanation: "Дата повторной явки из консультации." }));

  if (!items.length) return null;
  const title = cap(one(visit[0]).toLowerCase());
  return { documentDate: date, encounter: { kind: "visit", title, date, specialist, institution }, items, patientName };
}
