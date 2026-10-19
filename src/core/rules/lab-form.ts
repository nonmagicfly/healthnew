// Local parser for lab forms laid out as «Наименование исследования | Результат | Ед. изм. |
// Нормальные значения | Флаг». The text layer of such PDFs glues the columns together
// ("Гемоглобин г/л 132-173155"), so the reference and the result are split by rule:
// the upper bound has as many decimals as the lower one and is not below it.
// Runs entirely on this computer; nothing is sent anywhere.
import type { ExtractedDate, ExtractedItem, ExtractionOutput } from "./extraction";
import { normalizeIsoDate } from "./extraction";

export interface LabFormResult extends ExtractionOutput {
  /** Patient name as printed on the form, to warn when a form belongs to someone else. */
  patientName: string | null;
}

const HEADER = /Наименование исследования\s*Результат\s*Ед\.\s*изм\.\s*Нормальные значения/;
const UNIT = String.raw`(?:10\*\d+\/[а-яa-z]+|%|[А-Яа-яЁёA-Za-zμµ]+\/[А-Яа-яЁёA-Za-z]+|фл|пг|г\/л)`;
const NUM = String.raw`\d+(?:[.,]\d+)?`;
const RESULT_LINE = new RegExp(String.raw`^(.+?)\s+(${UNIT})\s*(.*)$`);
/** A unit at the start of a line: the name took the lines above it. */
const UNIT_LINE = new RegExp(String.raw`^(${UNIT})\s*(.*)$`);
const VALUE = new RegExp(String.raw`^(?:[<>≤≥]\s*)?${NUM}$`);

const decimals = (s: string) => (s.includes(".") || s.includes(",") ? s.split(/[.,]/)[1].length : 0);
const num = (s: string) => Number(s.replace(",", "."));

/** Splits "4.50-11.006.09" into reference "4.50-11.00" and value "6.09". */
export function splitReferenceAndValue(rest: string): { reference: string | null; value: string; flag: "high" | "low" | null } | null {
  // An arrow is the lab's own flag; it also separates the columns: "↑ 57.5", "9.0-21.5↑ 26.4".
  const arrowed = rest.trim().match(/^(.*?)\s*([↑↓])\s*([^↑↓]+)$/);
  const arrowFlag = arrowed ? (arrowed[2] === "↑" ? "high" : "low") : null;
  if (arrowed && VALUE.test(arrowed[3].trim())) {
    const before = arrowed[1].trim();
    if (!before) return { reference: null, value: arrowed[3].trim(), flag: arrowFlag };
    if (/^см\. комментарий$/.test(before) || new RegExp(String.raw`^${NUM}\s*-\s*${NUM}$`).test(before))
      return { reference: before.startsWith("см.") ? before : before.replace(/\s+/g, ""), value: arrowed[3].trim(), flag: arrowFlag };
  }
  const s = rest.trim();
  if (VALUE.test(s)) return { reference: null, value: s, flag: null };

  const comment = s.match(new RegExp(String.raw`^(см\. комментарий)\s*(${NUM})$`));
  if (comment) return { reference: comment[1], value: comment[2], flag: null };

  const m = s.match(new RegExp(String.raw`^(${NUM})\s*-\s*(\d[\d.,]*?)\s*(?:([↑↓])\s*)?(${NUM})?$`));
  if (!m) return null;
  const [, low, tail, arrow] = m;
  const flag = arrow === "↑" ? "high" : arrow === "↓" ? "low" : null;
  // With a flag arrow the columns are separated: "9.0-21.5↑ 26.4".
  if (m[4] !== undefined && arrow) return { reference: `${low}-${tail}`, value: m[4], flag };
  const glued = tail + (m[4] ?? "");
  const d = decimals(low);
  for (let i = 1; i < glued.length; i++) {
    const high = glued.slice(0, i);
    const value = glued.slice(i);
    if (!new RegExp(String.raw`^\d+${d ? String.raw`[.,]\d{${d}}` : ""}$`).test(high)) continue;
    if (num(high) < num(low)) continue;
    if (!new RegExp(String.raw`^(?:0|[1-9]\d*)(?:[.,]\d+)?$`).test(value)) continue;
    return { reference: `${low}-${high}`, value, flag };
  }
  return null;
}

function dateOf(text: string, re: RegExp): ExtractedDate {
  const m = text.match(re);
  const iso = normalizeIsoDate(m?.[1]);
  return iso ? { kind: "exact", date: iso, label: null, before: null, after: null } : { kind: "unknown", date: null, label: null, before: null, after: null };
}

const item = (o: Partial<ExtractedItem> & Pick<ExtractedItem, "label" | "quote">): ExtractedItem => ({
  group: "history",
  type: "lab_result",
  page: null,
  eventDate: { kind: "unknown", date: null, label: null, before: null, after: null },
  problem: null,
  explanation: "",
  lab: null,
  medication: null,
  qualitative: null,
  proposeCurrent: false,
  aboutItems: [],
  ...o,
});

/** Parses a lab form of the known layout, or returns null when the layout is not recognized. */
export function parseLabForm(pages: string[]): LabFormResult | null {
  if (!pages.length || !HEADER.test(pages[0])) return null;
  const first = pages[0];
  const title = first.split("\n")[0].trim() || "Анализ";
  const date = dateOf(first, /Дата:\s*(\d{2}\.\d{2}\.\d{4})/);
  const name = ["Фамилия", "Имя", "Отчество"].map((k) => first.match(new RegExp(String.raw`^\s*([А-ЯЁA-Z][^\n]*?)${k}:`, "m"))?.[1].trim()).filter(Boolean);

  const items: ExtractedItem[] = [];
  const seen = new Set<string>();
  pages.forEach((page, p) => {
    const lines = page.split("\n").map((l) => l.trim()).filter(Boolean);
    const start = p === 0 ? lines.findIndex((l) => HEADER.test(l)) + 1 : 0;
    for (let i = start; i < lines.length; i++) {
      const line = lines[i];
      if (/^Исследование\s*-/.test(line)) continue;
      const unitFirst = line.match(UNIT_LINE);
      const m = unitFirst ? ["", "", unitFirst[1], unitFirst[2]] : line.match(RESULT_LINE);
      if (!m) continue;
      const parsed = splitReferenceAndValue(m[3]);
      if (!parsed) continue;
      // A wrapped name continues with lowercase words; with the unit on its own line the whole name is above.
      const parts = [m[1]].filter(Boolean);
      let j = i - 1;
      let needMore = unitFirst !== null || /^[а-яё]/.test(line);
      while (needMore && j >= start) {
        const prev = lines[j];
        if (RESULT_LINE.test(prev) && splitReferenceAndValue(prev.match(RESULT_LINE)![3])) break;
        parts.unshift(prev);
        needMore = /^[а-яё]/.test(prev);
        j--;
      }
      if (!parts.length) continue;
      const rawName = parts.join(" ").replace(/\s+/g, " ").trim();
      const unit = m[2];
      const key = `${rawName}|${parsed.value}|${unit}`;
      if (seen.has(key)) continue; // the same result repeated in several panels
      seen.add(key);
      const flagNote = parsed.flag === "high" ? " Лаборатория отметила значение выше нормы." : parsed.flag === "low" ? " Лаборатория отметила значение ниже нормы." : "";
      items.push(
        item({
          label: `${rawName} ${parsed.value} ${unit}`,
          quote: line,
          page: p + 1,
          eventDate: date,
          explanation: `Разобрано по шаблону бланка; дата забора принята по дате в бланке.${flagNote}`,
          lab: { name: rawName, value: parsed.value, unit, reference: parsed.reference, method: null, origin: "lab_report" },
        }),
      );
    }
  });
  if (!items.length) return null;
  return {
    documentDate: date,
    encounter: { kind: "lab", title, date, specialist: null },
    items,
    patientName: name.length ? name.join(" ") : null,
  };
}
