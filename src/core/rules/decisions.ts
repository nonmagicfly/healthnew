import type { Fact, SourceDocument } from "../model";
import { buildState, type StateItem } from "./state";

export interface DocumentDecision {
  documentId: string;
  title: string;
  reason: string;
}

/** Everything that waits for the user's word, across all documents: one list instead of a card per document. */
export interface Decisions {
  medications: StateItem[];
  complaints: StateItem[];
  conditions: StateItem[];
  questions: StateItem[];
  conflicts: { groupId: string; items: StateItem[] }[];
  documents: DocumentDecision[];
  total: number;
}

const undecided = (f: Fact | undefined) => !!f && (f.validity.status === "unconfirmed" || f.validity.status === "unknown");

export function buildDecisions(allFacts: Fact[], documents: { document: SourceDocument; otherPatient: boolean }[], today: string): Decisions {
  const facts = allFacts.filter((f) => f.verification !== "rejected");
  const byId = new Map(facts.map((f) => [f.id, f]));
  const s = buildState(facts, today);
  const conflictGroups = new Map<string, Fact[]>();
  for (const f of facts) if (f.conflictGroupId) conflictGroups.set(f.conflictGroupId, [...(conflictGroups.get(f.conflictGroupId) ?? []), f]);
  const asItem = (f: Fact): StateItem => ({
    factId: f.id,
    label: f.label,
    detail: null,
    date: f.documentDate ? `документ от ${f.documentDate.split("-").reverse().join(".")}` : "дата документа неизвестна",
    currentness: "",
    documentIds: [...new Set(f.sources.map((x) => x.documentId))],
  });
  const d: Decisions = {
    medications: s.otherMedications.filter((i) => undecided(byId.get(i.factId))),
    complaints: s.documentComplaints.filter((i) => undecided(byId.get(i.factId))),
    conditions: s.conditions.filter((i) => undecided(byId.get(i.factId))),
    // A visit planned for the future is not a question yet.
    questions: s.openQuestions.filter((i) => i.detail !== "Запланировано"),
    conflicts: [...conflictGroups.entries()].filter(([, fs]) => fs.length > 1).map(([groupId, fs]) => ({ groupId, items: fs.map(asItem) })),
    documents: documents
      .filter(({ document }) => document.status === "review_pending" && !document.sampleKey)
      .map(({ document, otherPatient }) => ({
        documentId: document.id,
        title: document.title,
        reason: otherPatient ? "Бланк выписан на другого человека: относится ли он к этому профилю?" : "Предложенные факты ещё не добавлены в историю.",
      })),
    total: 0,
  };
  d.total = d.medications.length + d.complaints.length + d.conditions.length + d.questions.length + d.conflicts.length + d.documents.length;
  return d;
}
