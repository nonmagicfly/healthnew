import type { DateValue, ISODate } from "../model";

export const unknownDate = (bounds: { before?: ISODate; after?: ISODate } = {}): DateValue => ({
  kind: "unknown",
  ...bounds,
});

export const exactDate = (date: ISODate): DateValue => ({ kind: "exact", date });

export function formatIsoRu(date: ISODate): string {
  const [y, m, d] = date.split("-");
  return `${d}.${m}.${y}`;
}

export function formatDateValue(v: DateValue): string {
  switch (v.kind) {
    case "exact":
      return formatIsoRu(v.date);
    case "approx":
      return `${v.label} (приблизительно)`;
    case "unknown": {
      const parts = ["дата неизвестна"];
      if (v.after) parts.push(`после ${formatIsoRu(v.after)}`);
      if (v.before) parts.push(`до ${formatIsoRu(v.before)}`);
      return parts.join(", ");
    }
  }
}

export function dateCertainty(v: DateValue): "exact" | "approx" | "unknown" {
  return v.kind;
}

/**
 * Date used for ordering on a timeline. Unknown dates return null so callers
 * show them separately; the document date is never used as a stand-in.
 */
export function sortableDate(v: DateValue): ISODate | null {
  if (v.kind === "exact") return v.date;
  if (v.kind === "approx") return v.from ?? v.to ?? null;
  return null;
}

/** Inclusive period check for indicator filters. Unknown dates are outside every period. */
export function inPeriod(v: DateValue, from: ISODate | null, to: ISODate | null): boolean {
  const d = sortableDate(v);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}
