import type { DateValue, Encounter, Fact, ISODate, SourceDocument } from "../model";
import { formatDateValue, formatIsoRu, sortableDate } from "./dates";

export interface TimelineEntry {
  id: string;
  kind: "visit" | "lab" | "examination" | "symptom" | "treatment" | "procedure" | "note" | "result";
  title: string;
  date: string;
  certainty: DateValue["kind"];
  sortKey: ISODate | null;
  specialist: string | null;
  problem: string | null;
  documentIds: string[];
  factIds: string[];
  /** Short list of what happened, for display. */
  items: { factId: string; label: string; type: Fact["type"] }[];
  /** e.g. "Из документа от 22.09.2025" when the event date differs from the source date. */
  note: string | null;
}

export interface TimelineGroup {
  key: string;
  title: string;
  entries: TimelineEntry[];
}

const OWN_ENTRY_TYPES = new Set<Fact["type"]>(["examination", "procedure", "lab_result", "note", "complaint", "appointment"]);

const FACT_KIND: Partial<Record<Fact["type"], TimelineEntry["kind"]>> = {
  examination: "examination",
  procedure: "procedure",
  lab_result: "result",
  note: "note",
  complaint: "symptom",
  medication: "treatment",
  appointment: "visit",
};

function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [k, c] of counts) if (c > n) [best, n] = [k, c];
  return best;
}

export function buildTimeline(
  allFacts: Fact[],
  documents: SourceDocument[],
  encounters: Encounter[],
): TimelineEntry[] {
  const facts = allFacts.filter((f) => f.verification !== "rejected" && f.type !== "clarification");
  const entries: TimelineEntry[] = [];
  const byEncounter = new Map<string, Fact[]>();

  for (const f of facts) {
    const enc = encounters.find((e) => e.id === f.encounterId);
    const sameDate = enc && sortableDate(f.eventDate) === sortableDate(enc.date);
    const ownEntry = !enc || (OWN_ENTRY_TYPES.has(f.type) && !sameDate && f.type !== "complaint");
    if (!ownEntry && enc) {
      byEncounter.set(enc.id, [...(byEncounter.get(enc.id) ?? []), f]);
      continue;
    }
    const kind = FACT_KIND[f.type];
    if (!kind) continue;
    const docDate = f.documentDate;
    const evDate = sortableDate(f.eventDate);
    entries.push({
      id: `fact:${f.id}`,
      kind,
      title: f.label,
      date: formatDateValue(f.eventDate),
      certainty: f.eventDate.kind,
      sortKey: evDate,
      specialist: f.specialist,
      problem: f.problem,
      documentIds: [...new Set(f.sources.map((s) => s.documentId))],
      factIds: [f.id],
      items: [{ factId: f.id, label: f.label, type: f.type }],
      note: docDate && docDate !== evDate ? `Из документа от ${formatIsoRu(docDate)}` : null,
    });
  }

  for (const e of encounters) {
    const ef = byEncounter.get(e.id) ?? [];
    const docs = documents.filter((d) => e.documentIds.includes(d.id));
    entries.push({
      id: `enc:${e.id}`,
      kind: e.kind === "visit" ? "visit" : e.kind === "lab" ? "lab" : "examination",
      title: e.title,
      date: formatDateValue(e.date),
      certainty: e.date.kind,
      sortKey: sortableDate(e.date),
      specialist: e.specialist,
      problem: mostCommon(ef.map((f) => f.problem)),
      documentIds: docs.map((d) => d.id),
      factIds: ef.map((f) => f.id),
      items: ef.map((f) => ({ factId: f.id, label: f.label, type: f.type })),
      note: docs.length > 1 ? `Связано документов: ${docs.length}` : null,
    });
  }

  // Newest first; unknown dates at the end, never placed by the document date.
  return entries.sort((a, b) => {
    if (a.sortKey && b.sortKey) return b.sortKey.localeCompare(a.sortKey);
    if (a.sortKey) return -1;
    if (b.sortKey) return 1;
    return a.title.localeCompare(b.title);
  });
}

export function groupTimeline(entries: TimelineEntry[], by: "date" | "problem" | "specialist"): TimelineGroup[] {
  if (by === "date") {
    const groups = new Map<string, TimelineEntry[]>();
    for (const e of entries) {
      const k = e.sortKey ? e.sortKey.slice(0, 4) : "unknown";
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    return [...groups].map(([key, es]) => ({ key, title: key === "unknown" ? "Дата неизвестна" : `${key} год`, entries: es }));
  }
  const field = by === "problem" ? "problem" : "specialist";
  const empty = by === "problem" ? "Без привязки к проблеме" : "Без специалиста";
  const groups = new Map<string, TimelineEntry[]>();
  for (const e of entries) {
    const k = e[field] ?? empty;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return [...groups].map(([key, es]) => ({ key, title: key, entries: es }));
}
