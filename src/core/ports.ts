// Adapter interfaces. Core use cases depend only on these.
import type {
  ChatMessage,
  ContentVersion,
  Encounter,
  Fact,
  Profile,
  Proposal,
  SourceDocument,
  AnswerSegment,
} from "./model";

/** Persistent storage. Every call that reads profile data takes a profileId. */
export interface Repository {
  listProfiles(): Promise<Profile[]>;
  getProfile(id: string): Promise<Profile | null>;
  saveProfile(p: Profile): Promise<void>;

  listDocuments(profileId: string): Promise<SourceDocument[]>;
  getDocument(profileId: string, id: string): Promise<SourceDocument | null>;
  saveDocument(d: SourceDocument): Promise<void>;

  listVersions(profileId: string, documentId: string): Promise<ContentVersion[]>;
  saveVersion(v: ContentVersion): Promise<void>;

  listFacts(profileId: string): Promise<Fact[]>;
  getFact(profileId: string, id: string): Promise<Fact | null>;
  saveFact(f: Fact): Promise<void>;

  listEncounters(profileId: string): Promise<Encounter[]>;
  saveEncounter(e: Encounter): Promise<void>;

  getProposal(profileId: string, documentId: string): Promise<Proposal | null>;
  saveProposal(profileId: string, p: Proposal): Promise<void>;
  deleteProposal(profileId: string, documentId: string): Promise<void>;

  listMessages(profileId: string): Promise<ChatMessage[]>;
  saveMessage(m: ChatMessage): Promise<void>;
}

/** Original file bytes, addressed by SHA-256. Files are written once and never modified. */
export interface FileStore {
  put(sha256: string, bytes: Uint8Array): Promise<void>;
  get(sha256: string): Promise<Uint8Array | null>;
}

export interface RecognitionInput {
  document: SourceDocument;
  bytes: Uint8Array | null;
}

export type RecognitionResult =
  | { ok: true; version: Omit<ContentVersion, "id" | "profileId" | "documentId" | "createdAt"> }
  | { ok: false; reason: "not_connected" | "no_text" | "failed"; message: string };

/** Turns an original into text (PDF text layer, OCR in the future, transcript parsing). */
export interface DocumentRecognizer {
  recognize(input: RecognitionInput): Promise<RecognitionResult>;
}

export interface SpokenSegment {
  /** Seconds from the start of the recording. */
  start: number;
  end: number | null;
  text: string;
}

export type TranscriptionResult =
  | { ok: true; segments: SpokenSegment[]; /** When the recording was made, if the file says so. */ recordedAt: string | null; model: string }
  | { ok: false; message: string };

/** Turns a recorded conversation into text on this computer. Nothing is sent to external services. */
export interface SpeechTranscriber {
  transcribe(bytes: Uint8Array, mime: string): Promise<TranscriptionResult>;
}

export type ExtractionResult =
  | { ok: true; proposal: Proposal; method: "prepared" | "parser" | "llm" }
  | { ok: false; reason: "not_connected" | "failed"; message: string };

export interface ExtractionInput {
  document: SourceDocument;
  versions: ContentVersion[];
  /** Original bytes, for extractors that can read a file without a text layer (scans). */
  original?: { bytes: Uint8Array; mime: string } | null;
}

/** Extracts structured facts from recognized content. */
export interface FactExtractor {
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}

/**
 * Request to a language model. Instructions and untrusted data are separate fields:
 * an implementation must never merge `untrustedContext` into the system instructions.
 */
export interface LlmRequest {
  system: string;
  question: string;
  untrustedContext: string;
  contextFacts: Fact[];
  stateSummary: string;
}

export interface LlmAnswer {
  mode: "demo" | "llm";
  segments: AnswerSegment[];
  usedFactIds: string[];
}

export interface LlmAdapter {
  answer(request: LlmRequest): Promise<LlmAnswer>;
}

/** A connected language model. Document content is sent to it only after the user agrees. */
export interface LiveModel {
  /** e.g. "OpenAI" or "Anthropic". Shown next to the consent button. */
  provider: string;
  model: string;
  extractor: FactExtractor;
  chat: LlmAdapter;
}

export interface SampleInfo {
  key: string;
  title: string;
  kind: SourceDocument["kind"];
  documentDate: string | null;
  specialist: string | null;
  area: string | null;
  /** Synthetic samples may only be opened in the demo profile; real ones only outside it. */
  synthetic: boolean;
  description: string;
  preparedNotice: string;
}

export interface SampleContent {
  info: SampleInfo;
  /** For synthetic text samples: the file itself. Real samples have no original in the app. */
  originalText: string | null;
  /** Prepared recognized content for samples without an original. */
  preparedPages: string[] | null;
}

/** Built-in examples with prepared parses. */
export interface SampleCatalog {
  list(): SampleInfo[];
  get(key: string): SampleContent | null;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(prefix: string): string;
}
