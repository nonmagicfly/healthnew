// «Врачи»: consultations and recorded conversations grouped by specialty, each visit summed up
// from the facts already extracted from it. Nothing is generated: every line is a stored fact.
import type { Encounter, Fact, SourceDocument } from "../model";

export interface VisitLine {
  factId: string;
  label: string;
}

export interface Visit {
  document: Pick<SourceDocument, "id" | "title" | "kind" | "documentDate" | "institution" | "specialist">;
  complaints: VisitLine[];
  diagnoses: VisitLine[];
  prescriptions: VisitLine[];
  examinations: VisitLine[];
  nextVisit: string | null;
  factCount: number;
}

export interface DoctorFolder {
  key: string;
  label: string;
  visits: Visit[];
  /** The latest visit's diagnoses and prescriptions: what this doctor concluded last. */
  latestDiagnoses: VisitLine[];
  latestPrescriptions: VisitLine[];
  nextVisit: string | null;
  institutions: string[];
}

const UNKNOWN = "Врач не указан";
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** «гастроэнтеролог», «Врач-гастроэнтеролог» and «Гастроэнтеролог Иванова» are one folder. */
export function specialtyKey(specialist: string | null | undefined): string {
  const word = specialist?.trim().toLowerCase().replace(/^врач[\s-]+/, "").split(/[\s,(]+/)[0];
  return word ? cap(word) : UNKNOWN;
}

export function buildDoctors(documents: SourceDocument[], facts: Fact[], encounters: Encounter[], today: string): DoctorFolder[] {
  const live = facts.filter((f) => f.verification !== "rejected");
  const byDoc = new Map<string, Fact[]>();
  for (const f of live) for (const s of f.sources) byDoc.set(s.documentId, [...(byDoc.get(s.documentId) ?? []), f]);
  const encounterOf = new Map(encounters.flatMap((e) => e.documentIds.map((id) => [id, e] as const)));

  const folders = new Map<string, Visit[]>();
  for (const d of documents) {
    if (d.kind !== "consultation" && d.kind !== "transcript") continue;
    // A recorded conversation goes to the doctor of the visit it belongs to, or of a consultation on the same day.
    const sameDay = d.kind === "transcript" && d.documentDate ? documents.find((c) => c.kind === "consultation" && c.documentDate === d.documentDate && c.specialist) : undefined;
    const specialist = d.specialist ?? encounterOf.get(d.id)?.specialist ?? sameDay?.specialist ?? null;
    const fs = byDoc.get(d.id) ?? [];
    const lines = (types: Fact["type"][], keep: (f: Fact) => boolean = () => true) => fs.filter((f) => types.includes(f.type) && keep(f)).map((f) => ({ factId: f.id, label: f.label }));
    const upcoming = fs
      .filter((f) => f.type === "appointment" && f.eventDate.kind === "exact")
      .map((f) => (f.eventDate.kind === "exact" ? f.eventDate.date : ""))
      .sort();
    const visit: Visit = {
      document: { id: d.id, title: d.title, kind: d.kind, documentDate: d.documentDate, institution: d.institution ?? null, specialist },
      complaints: lines(["complaint"]),
      diagnoses: lines(["diagnosis", "condition"]),
      // Only what the doctor prescribed or proposed; a mention of past intake is not a conclusion.
      prescriptions: lines(["medication"], (f) => f.value.kind === "medication" && (f.value.status === "prescribed" || f.value.status === "option_discussed")),
      examinations: lines(["examination", "procedure"]),
      nextVisit: upcoming.find((d) => d >= today) ?? upcoming.at(-1) ?? null,
      factCount: fs.length,
    };
    const key = specialtyKey(specialist);
    folders.set(key, [...(folders.get(key) ?? []), visit]);
  }

  return [...folders]
    .map(([label, visits]) => {
      visits.sort((a, b) => (b.document.documentDate ?? "").localeCompare(a.document.documentDate ?? ""));
      const latest = visits.find((v) => v.diagnoses.length || v.prescriptions.length);
      const next = visits.map((v) => v.nextVisit).filter((d): d is string => !!d && d >= today).sort()[0] ?? null;
      return {
        key: label,
        label,
        visits,
        latestDiagnoses: latest?.diagnoses ?? [],
        latestPrescriptions: latest?.prescriptions ?? [],
        nextVisit: next,
        institutions: [...new Set(visits.map((v) => v.document.institution).filter((i): i is string => !!i))],
      };
    })
    .sort((a, b) => Number(a.label === UNKNOWN) - Number(b.label === UNKNOWN) || a.label.localeCompare(b.label, "ru"));
}
