import type { Fact, ISODate, LabResultValue, Reference } from "../model";
import { indicatorByCode, indicatorOf, INDICATORS, qualitativeIndicatorOf, type IndicatorDef } from "../indicators";
import { formatDateValue, inPeriod, sortableDate } from "./dates";
import { plottableNumber, referenceFlag, seriesKey } from "./lab-values";
import { unescapeModelText } from "./llm-request";

export interface SeriesPoint {
  factId: string;
  date: ISODate;
  /** "document" means the collection date is unknown and the point is placed by the document date, shown with a marker. */
  dateBasis: "collected" | "document";
  value: number;
  raw: string;
  valueType: string;
  reference: Reference | null;
  flag: ReturnType<typeof referenceFlag>;
  documentId: string;
}

export interface Series {
  key: string;
  unit: string | null;
  method: string | null;
  points: SeriesPoint[];
}

export interface IndicatorRow {
  factId: string;
  rawName: string;
  raw: string;
  valueType: string;
  unit: string | null;
  reference: string | null;
  method: string | null;
  collected: string;
  documentDate: string | null;
  origin: "lab_report" | "mention";
  linkedResultId: string | null;
  documentId: string;
  plotted: boolean;
  notPlottedReason: string | null;
  /** Compared with the lab's own reference only; no medical interpretation. */
  flag: ReturnType<typeof referenceFlag>;
}

export interface TimelineMark {
  factId: string;
  date: ISODate;
  label: string;
  kind: "treatment" | "symptom";
}

export interface IndicatorView {
  indicator: IndicatorDef;
  series: Series[];
  rows: IndicatorRow[];
  qualitative: { factId: string; text: string; documentDate: string | null; documentId: string }[];
  marks: TimelineMark[];
}

const isLab = (f: Fact): f is Fact & { value: LabResultValue } => f.type === "lab_result" && f.value.kind === "lab_result";

function notPlottedReason(f: Fact & { value: LabResultValue }): string | null {
  if (f.value.origin === "mention")
    return f.value.linkedResultId ? "Упоминание совпадает с результатом бланка" : "Упоминание в консультации, не результат бланка";
  if (plottableNumber(f.value.value) === null) return "Значение не числовое";
  if (sortableDate(f.eventDate) === null && !f.documentDate) return "Неизвестны дата забора и дата документа";
  return null;
}

export function buildIndicatorView(
  allFacts: Fact[],
  code: string,
  period: { from: ISODate | null; to: ISODate | null } = { from: null, to: null },
): IndicatorView | null {
  const indicator = indicatorByCode(code);
  if (!indicator) return null;
  const facts = allFacts.filter((f) => f.verification !== "rejected");
  const labs = facts.filter(isLab).filter((f) => indicatorOf(f.value) === code);

  const seriesMap = new Map<string, Series>();
  const rows: IndicatorRow[] = [];

  for (const f of labs) {
    const reason = notPlottedReason(f);
    const collected = sortableDate(f.eventDate);
    const x = collected ?? f.documentDate;
    const basis = collected ? "collected" : "document";
    const inRange =
      x !== null &&
      (collected ? inPeriod(f.eventDate, period.from, period.to) : inPeriod({ kind: "exact", date: x }, period.from, period.to));
    const plotted = reason === null && inRange;

    rows.push({
      factId: f.id,
      rawName: f.value.rawName,
      raw: f.value.value.raw,
      valueType: f.value.value.type,
      unit: f.value.unit,
      reference: f.value.reference ? unescapeModelText(f.value.reference.raw) : null,
      method: f.value.method,
      collected: formatDateValue(f.eventDate),
      documentDate: f.documentDate,
      origin: f.value.origin,
      linkedResultId: f.value.linkedResultId,
      documentId: f.sources[0].documentId,
      plotted,
      notPlottedReason: reason ?? (inRange ? null : "Вне выбранного периода"),
      flag: referenceFlag(f.value.value, f.value.reference),
    });

    if (!plotted || x === null) continue;
    const key = seriesKey(code, f.value.unit, f.value.method);
    const s = seriesMap.get(key) ?? { key, unit: f.value.unit, method: f.value.method, points: [] };
    s.points.push({
      factId: f.id,
      date: x,
      dateBasis: basis,
      value: plottableNumber(f.value.value)!,
      raw: f.value.value.raw,
      valueType: f.value.value.type,
      reference: f.value.reference,
      flag: referenceFlag(f.value.value, f.value.reference),
      documentId: f.sources[0].documentId,
    });
    seriesMap.set(key, s);
  }

  for (const s of seriesMap.values()) s.points.sort((a, b) => a.date.localeCompare(b.date));

  const qualitative = facts
    .filter((f) => f.type === "qualitative_finding" && f.value.kind === "qualitative" && qualitativeIndicatorOf(f.value.indicator) === code)
    .map((f) => ({
      factId: f.id,
      text: f.value.kind === "qualitative" ? f.value.text : f.label,
      documentDate: f.documentDate,
      documentId: f.sources[0].documentId,
    }));

  const marks: TimelineMark[] = [];
  for (const f of facts) {
    if (f.type === "procedure" || f.type === "medication") {
      const d = sortableDate(f.validity.from ?? f.eventDate);
      if (!d) continue;
      if (f.value.kind === "medication" && f.value.status === "option_discussed") continue;
      marks.push({ factId: f.id, date: d, label: f.label, kind: "treatment" });
    } else if (f.type === "complaint") {
      const d = sortableDate(f.eventDate);
      if (d) marks.push({ factId: f.id, date: d, label: f.label, kind: "symptom" });
    }
  }

  return {
    indicator,
    series: [...seriesMap.values()],
    rows: rows.sort((a, b) => (a.documentDate ?? "").localeCompare(b.documentDate ?? "")),
    qualitative,
    marks: marks.filter((m) => inPeriod({ kind: "exact", date: m.date }, period.from, period.to)),
  };
}

export interface IndicatorSummary {
  code: string;
  name: string;
  group: string;
  priority: boolean;
  results: number;
  mentions: number;
  qualitative: number;
}

/** Indicators that have any data in the profile, priority indicators always listed first. */
export function listIndicators(allFacts: Fact[]): IndicatorSummary[] {
  const facts = allFacts.filter((f) => f.verification !== "rejected");
  // Lab names outside the catalog are listed too, under their own name.
  const extra = [...new Set(facts.filter(isLab).map((f) => indicatorOf(f.value)))]
    .filter((c) => !INDICATORS.some((i) => i.code === c))
    .map((c) => indicatorByCode(c)!)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return [...INDICATORS, ...extra].map((i) => {
    const labs = facts.filter(isLab).filter((f) => indicatorOf(f.value) === i.code);
    return {
      code: i.code,
      name: i.name,
      group: i.group,
      priority: i.priority,
      results: labs.filter((f) => f.value.origin === "lab_report").length,
      mentions: labs.filter((f) => f.value.origin === "mention").length,
      qualitative: facts.filter((f) => f.value.kind === "qualitative" && qualitativeIndicatorOf(f.value.indicator) === i.code).length,
    };
  }).filter((s) => s.priority || s.results + s.mentions + s.qualitative > 0);
}

/**
 * Finds the lab-form result a mention refers to: same indicator and same number,
 * compatible unit (unknown unit is compatible), collected no later than the mentioning document.
 */
export function findMatchingResult(mention: Fact, candidates: Fact[]): Fact | null {
  if (!isLab(mention) || mention.value.origin !== "mention") return null;
  const mv = mention.value;
  const n = plottableNumber(mv.value);
  if (n === null) return null;
  for (const c of candidates) {
    if (!isLab(c) || c.value.origin !== "lab_report" || indicatorOf(c.value) !== indicatorOf(mv)) continue;
    if (plottableNumber(c.value.value) !== n) continue;
    if (mv.unit && c.value.unit && seriesKey("x", mv.unit, null) !== seriesKey("x", c.value.unit, null)) continue;
    const cd = sortableDate(c.eventDate) ?? c.documentDate;
    if (cd && mention.documentDate && cd > mention.documentDate) continue;
    return c;
  }
  return null;
}
