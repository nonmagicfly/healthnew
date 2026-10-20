import type { Fact, SourceDocument } from "../model";
import { indicatorByCode, indicatorOf } from "../indicators";
import { buildState, type StateItem } from "./state";
import { normalizeUnit, plottableNumber, referenceFlag } from "./lab-values";
import { sortableDate } from "./dates";

export interface SummaryLab {
  code: string;
  name: string;
  group: string;
  priority: boolean;
  raw: string;
  unit: string | null;
  reference: string | null;
  date: string;
  /** Compared with the lab's own reference only. */
  flag: "low" | "high" | "normal" | null;
  previous: { raw: string; date: string } | null;
  /** Direction since the previous result in the same unit; no judgement whether it is good. */
  change: "up" | "down" | "same" | null;
  factId: string;
  documentId: string;
}

export interface SummaryVisit {
  label: string;
  date: string;
  documentId: string;
}

/** A short overview for a doctor, built only from stored facts: nothing is sent anywhere and nothing is inferred. */
export interface DoctorSummary {
  takingMedications: StateItem[];
  allergies: StateItem[];
  allergiesUnknown: boolean;
  currentComplaints: StateItem[];
  conditions: (StateItem & { confirmed: boolean })[];
  labs: SummaryLab[];
  recentVisits: SummaryVisit[];
  upcoming: SummaryVisit[];
  documentCount: number;
}

const resultDate = (f: Fact) => sortableDate(f.eventDate) ?? f.documentDate;

export function buildDoctorSummary(allFacts: Fact[], documents: SourceDocument[], today: string): DoctorSummary {
  const facts = allFacts.filter((f) => f.verification !== "rejected");
  const s = buildState(facts, today);
  const byId = new Map(facts.map((f) => [f.id, f]));

  const byIndicator = new Map<string, Fact[]>();
  for (const f of facts) {
    if (f.value.kind !== "lab_result" || f.value.origin !== "lab_report" || !resultDate(f)) continue;
    const code = indicatorOf(f.value);
    byIndicator.set(code, [...(byIndicator.get(code) ?? []), f]);
  }
  const labs: SummaryLab[] = [];
  for (const [code, fs] of byIndicator) {
    const sorted = [...fs].sort((a, b) => resultDate(a)!.localeCompare(resultDate(b)!));
    const last = sorted.at(-1)!;
    if (last.value.kind !== "lab_result") continue;
    const v = last.value;
    const prev = sorted
      .slice(0, -1)
      .reverse()
      .find((f) => f.value.kind === "lab_result" && normalizeUnit(f.value.unit) === normalizeUnit(v.unit) && resultDate(f) !== resultDate(last));
    const a = prev && prev.value.kind === "lab_result" ? plottableNumber(prev.value.value) : null;
    const b = plottableNumber(v.value);
    const def = indicatorByCode(code);
    const flag = referenceFlag(v.value, v.reference);
    labs.push({
      code,
      name: def?.name ?? v.rawName,
      group: def?.group ?? "Прочее",
      priority: def?.priority ?? false,
      raw: v.value.raw,
      unit: v.unit,
      reference: v.reference?.raw ?? null,
      date: resultDate(last)!,
      flag,
      previous: prev && prev.value.kind === "lab_result" ? { raw: prev.value.value.raw, date: resultDate(prev)! } : null,
      change: a === null || b === null ? null : b > a ? "up" : b < a ? "down" : "same",
      factId: last.id,
      documentId: last.sources[0]?.documentId ?? "",
    });
  }
  // Out-of-range results first, then the priority indicators, then by group and name.
  const rank = (l: SummaryLab) => (l.flag === "high" || l.flag === "low" ? 0 : l.priority ? 1 : 2);
  labs.sort((x, y) => rank(x) - rank(y) || x.group.localeCompare(y.group) || x.name.localeCompare(y.name));

  const visits = documents
    .filter((d) => d.status === "applied" && d.documentDate && (d.kind === "consultation" || d.kind === "transcript" || d.kind === "examination"))
    .sort((a, b) => b.documentDate!.localeCompare(a.documentDate!))
    .slice(0, 5)
    .map((d) => ({ label: [d.title, d.specialist].filter(Boolean).join(", "), date: d.documentDate!, documentId: d.id }));
  const upcoming = facts
    .filter((f) => f.value.kind === "appointment" && f.value.attended === "unknown" && (sortableDate(f.eventDate) ?? "") > today)
    .sort((a, b) => sortableDate(a.eventDate)!.localeCompare(sortableDate(b.eventDate)!))
    .map((f) => ({ label: f.label, date: sortableDate(f.eventDate)!, documentId: f.sources[0]?.documentId ?? "" }));

  return {
    takingMedications: s.takingMedications,
    allergies: s.allergies,
    allergiesUnknown: s.allergiesUnknown,
    currentComplaints: s.currentComplaints,
    conditions: s.conditions.map((i) => ({ ...i, confirmed: byId.get(i.factId)?.validity.status === "current" })),
    labs,
    recentVisits: visits,
    upcoming,
    documentCount: documents.filter((d) => d.status === "applied").length,
  };
}
