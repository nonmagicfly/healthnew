import type { LabValue, Reference } from "../model";

const NUM = String.raw`[-+]?\d+(?:[.,]\d+)?`;

export function parseNumber(s: string): number | null {
  const m = s.trim().match(new RegExp(`^${NUM}$`));
  return m ? Number(m[0].replace(",", ".")) : null;
}

/**
 * Parses a lab value as written. Keeps the raw text; never turns qualitative
 * wording into a number.
 */
export function parseLabValue(raw: string): LabValue {
  const base: LabValue = { raw, type: "qualitative", number: null, low: null, high: null, text: null };
  const s = raw.trim().replace(/\s+/g, " ");

  let m = s.match(new RegExp(`^(<|≤|<=|менее|меньше)\\s*(${NUM})$`, "i"));
  if (m) return { ...base, type: "less_than", number: parseNumber(m[2]) };

  m = s.match(new RegExp(`^(>|≥|>=|более|больше)\\s*(${NUM})$`, "i"));
  if (m) return { ...base, type: "greater_than", number: parseNumber(m[2]) };

  m = s.match(new RegExp(`^(около|примерно|~|≈)\\s*(${NUM})$`, "i"));
  if (m) return { ...base, type: "approximate", number: parseNumber(m[2]) };

  m = s.match(new RegExp(`^(${NUM})\\s*(?:-|–|—|\\.\\.\\.?)\\s*(${NUM})$`));
  if (m) return { ...base, type: "range", low: parseNumber(m[1]), high: parseNumber(m[2]) };

  const n = parseNumber(s);
  if (n !== null) return { ...base, type: "numeric", number: n };

  return { ...base, type: "qualitative", text: s };
}

export function parseReference(raw: string | null): Reference | null {
  if (!raw) return null;
  const v = parseLabValue(raw);
  switch (v.type) {
    case "range":
      return { raw, low: v.low, high: v.high };
    case "less_than":
      return { raw, low: null, high: v.number };
    case "greater_than":
      return { raw, low: v.number, high: null };
    default:
      return { raw, low: null, high: null };
  }
}

/** Value that can be placed on a numeric axis, or null. Approximate and qualitative values are never plotted. */
export function plottableNumber(v: LabValue): number | null {
  switch (v.type) {
    case "numeric":
    case "less_than":
    case "greater_than":
      return v.number;
    case "range":
      return null;
    default:
      return null;
  }
}

export function formatLabValue(v: LabValue): string {
  return v.raw;
}

/** Simple comparison against the lab's own reference. Returns null when it cannot be decided. */
export function referenceFlag(v: LabValue, ref: Reference | null): "low" | "high" | "normal" | null {
  if (!ref || v.type !== "numeric" || v.number === null) return null;
  if (ref.low !== null && v.number < ref.low) return "low";
  if (ref.high !== null && v.number > ref.high) return "high";
  if (ref.low === null && ref.high === null) return null;
  return "normal";
}

/** Normalizes a unit string for comparability checks only; the original unit is kept. */
export function normalizeUnit(unit: string | null): string {
  if (!unit) return "?";
  return unit
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace("ед/л", "u/l")
    .replace("мкмоль", "umol")
    .replace("ммоль", "mmol")
    .replace("нг/мл", "ng/ml")
    .replace("мкг/л", "ug/l")
    .replace("мм/час", "mm/h")
    .replace("мм/ч", "mm/h");
}

/** Results are on the same line only when indicator, unit and method match. No implicit conversion. */
export function seriesKey(indicator: string, unit: string | null, method: string | null): string {
  return `${indicator}|${normalizeUnit(unit)}|${(method ?? "").toLowerCase().trim()}`;
}
