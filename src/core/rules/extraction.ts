// Turns a language model's extraction output into a proposal. The model only proposes;
// these rules decide what may be stored and how: quotes are checked against the text,
// a document never confirms that a medication is taken now, unknown dates stay unknown.
import type {
  ContentVersion,
  DateValue,
  FactDraft,
  FactType,
  FactValue,
  MedicationStatus,
  Proposal,
  ProposalItem,
  SourceDocument,
  SourceRef,
  Validity,
} from "../model";
import { normalizeIndicator } from "../indicators";
import { parseLabValue, parseReference } from "./lab-values";
import { escapeUntrusted } from "./llm-request";

/** Statuses a document can support. "taking_now" and "started_confirmed" come only from the user. */
export const DOCUMENT_MEDICATION_STATUSES = ["prescribed", "mentioned_taking", "option_discussed", "stopped", "unknown"] as const;
export const EXTRACTED_FACT_TYPES = [
  "complaint",
  "condition",
  "diagnosis",
  "medication",
  "allergy",
  "lab_result",
  "qualitative_finding",
  "procedure",
  "examination",
  "appointment",
  "clarification",
  "note",
] as const satisfies readonly FactType[];

export interface ExtractedDate {
  kind: "exact" | "approx" | "unknown";
  date: string | null;
  label: string | null;
  before: string | null;
  after: string | null;
}

/** Flat item shape the model fills in; one of lab / medication / qualitative is set for those types. */
export interface ExtractedItem {
  group: "history" | "state_change" | "clarify";
  type: (typeof EXTRACTED_FACT_TYPES)[number];
  label: string;
  quote: string;
  page: number | null;
  eventDate: ExtractedDate;
  problem: string | null;
  explanation: string;
  lab: { name: string; value: string; unit: string | null; reference: string | null; method: string | null; origin: "lab_report" | "mention" } | null;
  medication: { name: string | null; dose: string | null; status: (typeof DOCUMENT_MEDICATION_STATUSES)[number] } | null;
  qualitative: { indicator: string | null; text: string } | null;
  /** The document suggests this is true now (a current complaint, a medication being taken). The user decides. */
  proposeCurrent: boolean;
  /** For clarifications: indexes of the items the question is about. */
  aboutItems: number[];
}

export interface ExtractionOutput {
  encounter: { kind: "visit" | "lab" | "examination"; title: string; date: ExtractedDate; specialist: string | null } | null;
  items: ExtractedItem[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const iso = (s: string | null) => (s && ISO.test(s) && !Number.isNaN(Date.parse(s)) ? s : undefined);

export function toDateValue(d: ExtractedDate): DateValue {
  if (d.kind === "exact" && iso(d.date)) return { kind: "exact", date: d.date! };
  if (d.kind === "approx" && d.label?.trim()) return { kind: "approx", label: d.label.trim() };
  const v: DateValue = { kind: "unknown" };
  if (iso(d.before)) v.before = d.before!;
  if (iso(d.after)) v.after = d.after!;
  return v;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Finds the quote in the recognized text: page for PDFs, segment for transcripts. Null when it is not there verbatim. */
export function locateQuote(quote: string, version: ContentVersion | undefined): Partial<SourceRef> | null {
  if (!version) return null;
  const q = squash(escapeUntrusted(quote));
  if (q.length < 3) return null;
  for (const s of version.segments) {
    if (squash(escapeUntrusted(s.text)).includes(q)) return { versionId: version.id, page: null, segmentId: s.id, timecode: s.timecode, speaker: s.speaker };
  }
  const i = version.pages.findIndex((p) => squash(escapeUntrusted(p)).includes(q));
  return i >= 0 ? { versionId: version.id, page: i + 1 } : null;
}

function valueFor(item: ExtractedItem): FactValue {
  if (item.type === "lab_result" && item.lab) {
    return {
      kind: "lab_result",
      rawName: item.lab.name,
      indicator: normalizeIndicator(item.lab.name),
      value: parseLabValue(item.lab.value),
      unit: item.lab.unit?.trim() || null,
      reference: parseReference(item.lab.reference),
      method: item.lab.method?.trim() || null,
      origin: item.lab.origin,
      linkedResultId: null,
    };
  }
  if (item.type === "medication") {
    const status: MedicationStatus = item.medication && (DOCUMENT_MEDICATION_STATUSES as readonly string[]).includes(item.medication.status) ? item.medication.status : "unknown";
    // An illegible name stays unknown; it is never guessed.
    return { kind: "medication", name: item.medication?.name?.trim() || null, dose: item.medication?.dose?.trim() || null, status };
  }
  if (item.type === "qualitative_finding") return { kind: "qualitative", indicator: item.qualitative?.indicator ?? null, text: item.qualitative?.text || item.label };
  if (item.type === "appointment") return { kind: "appointment", attended: "unknown" };
  if (item.type === "clarification") return { kind: "clarification", question: item.label, aboutFactIds: [], resolution: "open", answer: null };
  return { kind: "text", text: item.label };
}

function validityFor(type: FactType, eventDate: DateValue): Validity {
  const status: Validity["status"] =
    type === "lab_result" || type === "qualitative_finding" || type === "procedure" || type === "examination"
      ? "historical"
      : type === "appointment" || type === "clarification" || type === "note"
        ? "unknown"
        : "unconfirmed";
  return { status, from: type === "medication" ? eventDate : null, to: null, confirmedAt: null };
}

const NOT_FOUND = "Цитата не найдена дословно в распознанном тексте: сверьте с оригиналом.";
const NO_TEXT = "Текст прочитан моделью из файла без текстового слоя: цитата не сверена программой.";

/** Builds a proposal from model output. Items without a label or quote are dropped. */
export function proposalFromExtraction(doc: SourceDocument, versions: ContentVersion[], out: ExtractionOutput, model: string): Proposal {
  const version = versions.find((v) => v.method !== "prepared");
  const keyOf = (i: number) => `llm:${doc.id}:${i}`;
  const kept = out.items.map((it, i) => ({ it, i })).filter(({ it }) => it.label.trim() && it.quote.trim());
  const keptIdx = new Set(kept.map(({ i }) => i));

  const items: ProposalItem[] = kept.map(({ it, i }) => {
    const located = locateQuote(it.quote, version);
    const notes: string[] = [];
    if (!located) notes.push(version ? NOT_FOUND : NO_TEXT);
    const source: SourceRef = {
      documentId: doc.id,
      versionId: version?.id ?? null,
      page: it.page,
      quote: it.quote.trim(),
      quoteIsExact: !!located,
      timecode: null,
      segmentId: null,
      speaker: null,
      sourceType: "personal",
      ...located,
    };
    const eventDate = toDateValue(it.eventDate);
    const draft: FactDraft = {
      type: it.type,
      label: it.label.trim(),
      value: valueFor(it),
      originalText: source.quote,
      sources: [source],
      eventDate,
      documentDate: doc.documentDate,
      validity: validityFor(it.type, eventDate),
      extraction: { method: "llm", confidence: null, model },
      specialist: doc.specialist,
      problem: it.problem?.trim() || null,
      dedupKey: keyOf(i),
      aboutKeys: it.type === "clarification" ? it.aboutItems.filter((a) => keptIdx.has(a) && a !== i).map(keyOf) : undefined,
    };

    let group: ProposalItem["group"] = it.type === "clarification" ? "clarify" : "history";
    let stateChange: ProposalItem["stateChange"];
    if (it.proposeCurrent && it.type === "medication") {
      group = "state_change";
      stateChange = { medicationStatus: "taking_now" };
    } else if (it.proposeCurrent && (it.type === "complaint" || it.type === "condition" || it.type === "allergy")) {
      group = "state_change";
      stateChange = { validity: { status: "current", from: null, to: null, confirmedAt: null } };
    }
    const explanation = [it.explanation.trim(), ...notes].filter(Boolean).join(" ");
    return { key: draft.dedupKey, group, draft, stateChange, explanation: explanation || "Предложено моделью; проверьте по источнику." };
  });

  const enc = out.encounter;
  return {
    documentId: doc.id,
    encounter: enc && enc.title.trim() ? { key: `llm:${doc.id}:encounter`, kind: enc.kind, title: enc.title.trim(), date: toDateValue(enc.date), specialist: enc.specialist?.trim() || doc.specialist } : null,
    items,
  };
}
