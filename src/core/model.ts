// Domain model. Platform-agnostic: no React, Next.js or Node imports.
// Layers: (1) SourceDocument + ContentVersion, (2) Fact, (3) state derived from
// confirmed facts, (4) derived summaries and chat answers.

export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string;

export interface Profile {
  id: string;
  name: string;
  isDemo: boolean;
}

// ---------- Dates ----------

/** A date that may be exact, approximate or unknown. Never filled from the document date. */
export type DateValue =
  | { kind: "exact"; date: ISODate }
  | { kind: "approx"; label: string; from?: ISODate; to?: ISODate }
  | { kind: "unknown"; before?: ISODate; after?: ISODate };

// ---------- Layer 1: originals and recognized content ----------

export type DocumentKind =
  | "lab_report"
  | "consultation"
  | "examination"
  | "transcript"
  | "note"
  | "other";

export type ProcessingStatus =
  | "stored"
  | "recognized"
  | "recognition_unavailable"
  | "extraction_unavailable"
  /** Text is ready; facts can be extracted by a language model once the user agrees to send the document. */
  | "extraction_ready"
  | "review_pending"
  | "applied"
  | "error";

export interface OriginalFile {
  fileName: string;
  mime: string;
  size: number;
  sha256: string;
}

export interface SourceDocument {
  id: string;
  profileId: string;
  kind: DocumentKind;
  title: string;
  documentDate: ISODate | null;
  specialist: string | null;
  area: string | null;
  original: OriginalFile | null;
  /** Set when the document was opened from a built-in example with a prepared parse. */
  sampleKey: string | null;
  /** Shown next to prepared data, e.g. "not checked against the original". */
  preparedNotice: string | null;
  isSynthetic: boolean;
  encounterId: string | null;
  status: ProcessingStatus;
  statusMessage: string | null;
  createdAt: ISODateTime;
}

export type Speaker = "doctor" | "patient" | "unclear";

export interface TranscriptSegment {
  id: string;
  speaker: Speaker;
  speakerLabel: string | null;
  timecode: string | null;
  text: string;
}

export type ContentMethod = "pdf_text_layer" | "plain_text" | "transcript_parser" | "prepared";

export interface ContentVersion {
  id: string;
  profileId: string;
  documentId: string;
  method: ContentMethod;
  /** One entry per page for PDFs; a single entry otherwise. */
  pages: string[];
  segments: TranscriptSegment[];
  note: string | null;
  createdAt: ISODateTime;
}

// ---------- Layer 2: facts ----------

export interface SourceRef {
  documentId: string;
  versionId: string | null;
  page: number | null;
  quote: string;
  /** False when the quote is a paraphrase (prepared parse not checked against the file). */
  quoteIsExact: boolean;
  timecode: string | null;
  segmentId: string | null;
  speaker: Speaker | null;
  /** Personal history vs. external medical knowledge (external is not used in the prototype). */
  sourceType: "personal";
}

export type FactType =
  | "complaint"
  | "condition"
  | "diagnosis"
  | "medication"
  | "allergy"
  | "lab_result"
  | "qualitative_finding"
  | "procedure"
  | "examination"
  | "appointment"
  | "clarification"
  | "note";

export type Verification = "unverified" | "confirmed" | "corrected" | "rejected";

/** Whether the fact describes the present. "unconfirmed" means it came from a document and nobody said it is current. */
export type Currentness = "current" | "unconfirmed" | "historical" | "ended" | "unknown";

export interface Validity {
  status: Currentness;
  from: DateValue | null;
  to: DateValue | null;
  confirmedAt: ISODateTime | null;
}

export type MedicationStatus =
  | "prescribed" // doctor prescribed
  | "mentioned_taking" // a document says the patient takes it; not confirmed by the user
  | "option_discussed" // discussed as a possible option, not prescribed
  | "started_confirmed" // patient confirmed starting
  | "taking_now" // patient confirms taking now
  | "stopped" // finished or stopped
  | "unknown";

export type LabValueType =
  | "numeric"
  | "less_than"
  | "greater_than"
  | "range"
  | "approximate"
  | "qualitative";

export interface LabValue {
  raw: string;
  type: LabValueType;
  /** numeric / approximate value, or the bound for less_than / greater_than. */
  number: number | null;
  low: number | null;
  high: number | null;
  text: string | null;
}

export interface Reference {
  raw: string;
  low: number | null;
  high: number | null;
}

export interface LabResultValue {
  kind: "lab_result";
  rawName: string;
  indicator: string | null;
  value: LabValue;
  unit: string | null;
  reference: Reference | null;
  method: string | null;
  /** lab_report: from the lab form itself; mention: a number quoted in a consultation or conversation. */
  origin: "lab_report" | "mention";
  /** For a mention: the lab_report fact it was matched to. */
  linkedResultId: string | null;
}

export interface MedicationValue {
  kind: "medication";
  name: string | null;
  dose: string | null;
  status: MedicationStatus;
}

export interface QualitativeValue {
  kind: "qualitative";
  indicator: string | null;
  text: string;
}

export interface AppointmentValue {
  kind: "appointment";
  attended: "yes" | "no" | "unknown";
}

export interface ClarificationValue {
  kind: "clarification";
  question: string;
  /** Facts the question is about. */
  aboutFactIds: string[];
  resolution: "open" | "postponed" | "resolved";
  answer: string | null;
}

export interface TextValue {
  kind: "text";
  text: string;
}

export type FactValue =
  | LabResultValue
  | MedicationValue
  | QualitativeValue
  | AppointmentValue
  | ClarificationValue
  | TextValue;

export interface FactRevision {
  at: ISODateTime;
  action: "created" | "corrected" | "confirmed_current" | "ended" | "status_changed" | "source_added" | "rejected" | "resolved" | "dates_filled";
  reason: string | null;
  before: Partial<Pick<Fact, "label" | "value" | "validity" | "verification" | "eventDate">> | null;
  after: Partial<Pick<Fact, "label" | "value" | "validity" | "verification" | "eventDate">> | null;
}

export interface Fact {
  id: string;
  profileId: string;
  type: FactType;
  label: string;
  value: FactValue;
  /** Exact wording from the source (or the prepared paraphrase, see SourceRef.quoteIsExact). */
  originalText: string;
  /** First is the primary source; the rest are supporting quotes. */
  sources: SourceRef[];
  eventDate: DateValue;
  documentDate: ISODate | null;
  verification: Verification;
  validity: Validity;
  /** model: which language model proposed the fact (method "llm"). */
  extraction: { method: "prepared" | "parser" | "manual" | "llm"; confidence: number | null; model?: string | null };
  specialist: string | null;
  /** Health problem grouping, e.g. "ЖКТ", "Обмен железа". */
  problem: string | null;
  encounterId: string | null;
  dedupKey: string;
  conflictGroupId: string | null;
  revisions: FactRevision[];
  createdAt: ISODateTime;
}

export interface Encounter {
  id: string;
  profileId: string;
  kind: "visit" | "lab" | "examination";
  title: string;
  date: DateValue;
  specialist: string | null;
  documentIds: string[];
}

// ---------- Extraction proposals ----------

export type ProposalGroup = "history" | "state_change" | "clarify";

/** A fact draft before it is stored: no id, profile, timestamps or revisions yet. */
export type FactDraft = Omit<
  Fact,
  "id" | "profileId" | "revisions" | "createdAt" | "verification" | "conflictGroupId" | "encounterId"
> & {
  /** Key of another draft in the same proposal or dedupKey of a stored fact this one contradicts. */
  conflictsWith?: string[];
  /** Clarification drafts reference other drafts by dedupKey. */
  aboutKeys?: string[];
};

export interface ProposalItem {
  key: string;
  group: ProposalGroup;
  draft: FactDraft;
  /** For state_change items: what changes in the current state if accepted. */
  stateChange?: { validity?: Validity; medicationStatus?: MedicationStatus };
  explanation: string;
}

export interface Proposal {
  documentId: string;
  /** Date printed on the document, proposed when the user did not enter one at upload. */
  documentDate?: ISODate | null;
  /** Patient name printed on a lab form, shown so a form of another person is noticed. */
  patientName?: string | null;
  encounter: Omit<Encounter, "id" | "profileId" | "documentIds"> & { key: string } | null;
  items: ProposalItem[];
}

export interface ProposalDecision {
  acceptedStateChanges: string[];
  postponedClarifications: string[];
}

// ---------- Layer 4: chat ----------

export type AnswerSegmentKind = "document_fact" | "patient_words" | "summary" | "missing" | "caution";

export interface AnswerSegment {
  kind: AnswerSegmentKind;
  text: string;
  factIds: string[];
  sources: SourceRef[];
}

export interface ChatMessage {
  id: string;
  profileId: string;
  role: "user" | "assistant";
  text: string;
  segments: AnswerSegment[];
  usedContext: { factId: string; label: string; reason: string }[];
  mode: "demo" | "llm" | null;
  createdAt: ISODateTime;
}
