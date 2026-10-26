// Use cases. The web API and a future iPhone backend call these; nothing here knows about HTTP or React.
import type {
  ChatMessage,
  ContentVersion,
  DateValue,
  DocumentKind,
  Encounter,
  Fact,
  FactDraft,
  MedicationStatus,
  Profile,
  Proposal,
  ProposalDecision,
  SourceDocument,
  SourceRef,
  TranscriptSegment,
  FocusSettings,
} from "./model";
import type {
  Clock,
  DocumentRecognizer,
  FactExtractor,
  FileStore,
  IdGenerator,
  LiveModel,
  LlmAdapter,
  Repository,
  SampleCatalog,
  SpeechTranscriber,
} from "./ports";
import {
  addSource,
  fillMissingDates,
  confirmCurrent,
  correctFact,
  endFact,
  markHistorical,
  resolveClarification,
  setMedicationStatus,
  type FactCorrection,
} from "./rules/facts";
import { buildState, stateToText } from "./rules/state";
import { buildDecisions } from "./rules/decisions";
import { buildDoctors } from "./rules/doctors";
import { buildDoctorSummary } from "./rules/summary";
import { buildIndicatorView, findMatchingResult, listIndicators } from "./rules/series";
import { buildTimeline, groupTimeline } from "./rules/timeline";
import { retrieveFacts } from "./rules/retrieval";
import { buildDocumentsRequest, buildLlmRequest } from "./rules/llm-request";
import { exactDate, unknownDate } from "./rules/dates";
import { normalizeUnit, parseLabValue } from "./rules/lab-values";
import { indicatorOf } from "./indicators";
import { contentKey, normalizeIsoDate, proposalFromExtraction } from "./rules/extraction";
import { parseLabForm } from "./rules/lab-form";
import { parseConsultation } from "./rules/consultation";
import { applyLabels, deriveLabels } from "./rules/labels";
import { buildFocusCards, DEFAULT_FOCUS_AREAS, documentFocus, factsInFocus, focusAreas, type DocumentFocus } from "./rules/focus";

export class NotFoundError extends Error {}
export class ValidationError extends Error {}
/** A connected model could not answer; the message is safe to show and has no document content. */
export class ExternalServiceError extends Error {}

export interface Deps {
  repo: Repository;
  files: FileStore;
  recognizer: DocumentRecognizer;
  extractor: FactExtractor;
  llm: LlmAdapter;
  /** Connected language model; null when no API key is configured (demo mode only). */
  live?: LiveModel | null;
  samples: SampleCatalog;
  /** Local speech-to-text for recorded conversations; without it audio is stored but not transcribed. */
  transcriber?: SpeechTranscriber | null;
  clock: Clock;
  ids: IdGenerator;
}

export const DEFAULT_PROFILES: Profile[] = [
  { id: "me", name: "Мой профиль", isDemo: false },
  { id: "demo", name: "Демо-профиль", isDemo: true },
];

const AUDIO: Record<string, string> = { ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".webm": "audio/webm", ".aac": "audio/aac" };
const ALLOWED_MIME = new Set(["application/pdf", "text/plain", "text/markdown", ...Object.values(AUDIO)]);
const MAX_SIZE = 25 * 1024 * 1024;
/** An hour-long recording of a visit fits. */
const MAX_AUDIO_SIZE = 300 * 1024 * 1024;

export const isAudio = (mime: string) => mime.startsWith("audio/");

/** Seconds as «m:ss» or «h:mm:ss». */
export function timecodeOf(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Text of a document with whitespace collapsed, for spotting the same document saved as another file. */
function sameText(pages: string[]): string {
  return pages.join("\n").replace(/\s+/g, " ").trim();
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function mimeFor(fileName: string, declared: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".md")) return "text/markdown";
  const audio = AUDIO[lower.slice(lower.lastIndexOf("."))];
  if (audio) return audio;
  return declared || "application/octet-stream";
}

export interface UploadInput {
  fileName: string;
  mime: string;
  bytes: Uint8Array;
  kind?: DocumentKind;
  title?: string;
  documentDate?: string | null;
  specialist?: string | null;
  area?: string | null;
}

/** Correction as the user enters it; dates and lab values are parsed here, the original wording is kept in history. */
export interface UserCorrection {
  label?: string;
  /** YYYY-MM-DD, or null to mark the date as unknown. */
  eventDate?: string | null;
  labValueRaw?: string;
  unit?: string | null;
}

function toCorrection(f: Fact, p: UserCorrection): FactCorrection {
  const c: FactCorrection = {};
  if (p.label !== undefined && p.label.trim()) c.label = p.label.trim();
  if (p.eventDate !== undefined) c.eventDate = p.eventDate ? exactDate(p.eventDate) : unknownDate();
  if (f.value.kind === "lab_result" && (p.labValueRaw !== undefined || p.unit !== undefined)) {
    c.value = {
      ...f.value,
      value: p.labValueRaw !== undefined && p.labValueRaw.trim() ? parseLabValue(p.labValueRaw.trim()) : f.value.value,
      unit: p.unit !== undefined ? p.unit?.trim() || null : f.value.unit,
      linkedResultId: null,
    };
  }
  if (!c.label && !c.eventDate && !c.value) throw new ValidationError("Нечего исправлять");
  return c;
}

export type FactAction =
  | { type: "correct"; patch: UserCorrection; reason: string | null }
  | { type: "confirm_current" }
  | { type: "mark_historical" }
  | { type: "end"; endDate: string | null }
  | { type: "medication_status"; status: MedicationStatus; startDate: string | null }
  | { type: "resolve"; answer: string }
  | { type: "appointment_attended"; attended: "yes" | "no" }
  | { type: "reject"; reason: string | null };

export class HealthService {
  constructor(private d: Deps) {}

  private now() {
    return this.d.clock.now().toISOString();
  }

  // ---------- Profiles ----------

  async ensureProfiles(): Promise<Profile[]> {
    for (const p of DEFAULT_PROFILES) if (!(await this.d.repo.getProfile(p.id))) await this.d.repo.saveProfile(p);
    return this.d.repo.listProfiles();
  }

  /** A new profile for a family member. Its data never mixes with other profiles. */
  async createProfile(name: string): Promise<Profile> {
    const clean = name.trim().replace(/\s+/g, " ");
    if (!clean) throw new ValidationError("Укажите имя профиля");
    if (clean.length > 60) throw new ValidationError("Имя профиля длиннее 60 символов");
    if ((await this.d.repo.listProfiles()).some((p) => p.name.toLowerCase() === clean.toLowerCase())) throw new ValidationError("Профиль с таким именем уже есть");
    const profile: Profile = { id: this.d.ids.next("prof"), name: clean, isDemo: false };
    await this.d.repo.saveProfile(profile);
    return profile;
  }

  /**
   * Moves a document with everything extracted from it to another profile, e.g. a child's form uploaded into a parent's profile.
   * A fact that also has sources in other documents stays and loses this document's sources; a copy with them goes to the target.
   */
  async moveDocument(profileId: string, documentId: string, targetProfileId: string) {
    const doc = await this.d.repo.getDocument(profileId, documentId);
    if (!doc) throw new NotFoundError("Документ не найден");
    const target = await this.profile(targetProfileId);
    if (target.id === profileId) throw new ValidationError("Документ уже в этом профиле");
    if (target.isDemo || doc.sampleKey) throw new ValidationError("Демо-профиль и встроенные примеры не смешиваются с личными данными");
    if (doc.original && (await this.d.repo.listDocuments(target.id)).some((d) => d.original?.sha256 === doc.original!.sha256))
      throw new ValidationError(`Этот документ уже есть в профиле «${target.name}»`);
    const at = this.now();
    const patientKey = `llm:${documentId}:patient`;

    for (const v of await this.d.repo.listVersions(profileId, documentId)) await this.d.repo.saveVersion({ ...v, profileId: target.id });
    for (const f of await this.d.repo.listFacts(profileId)) {
      const own = f.sources.filter((x) => x.documentId === documentId);
      if (!own.length) continue;
      if (f.dedupKey === patientKey) {
        // Moving the form answers the question whose form it is.
        await this.d.repo.saveFact({ ...resolveClarification(f, `Перенесён в профиль «${target.name}»`, at), profileId: target.id });
        continue;
      }
      if (own.length === f.sources.length) {
        await this.d.repo.saveFact({ ...f, profileId: target.id, encounterId: null, conflictGroupId: null });
      } else {
        await this.d.repo.saveFact({ ...f, sources: f.sources.filter((x) => x.documentId !== documentId) });
        await this.d.repo.saveFact({ ...f, id: this.d.ids.next("fact"), profileId: target.id, sources: own, encounterId: null, conflictGroupId: null });
      }
    }
    for (const e of await this.d.repo.listEncounters(profileId)) {
      if (!e.documentIds.includes(documentId)) continue;
      await this.d.repo.saveEncounter({ ...e, documentIds: e.documentIds.filter((id) => id !== documentId) });
    }
    const proposal = await this.d.repo.getProposal(profileId, documentId);
    if (proposal) {
      await this.d.repo.deleteProposal(profileId, documentId);
      await this.d.repo.saveProposal(target.id, { ...proposal, items: proposal.items.filter((i) => i.key !== patientKey) });
      if (proposal.patientName && !target.patientNames?.includes(proposal.patientName))
        await this.d.repo.saveProfile({ ...target, patientNames: [...(target.patientNames ?? []), proposal.patientName] });
    }
    const moved: SourceDocument = { ...doc, profileId: target.id, encounterId: null };
    await this.d.repo.saveDocument(moved);
    return moved;
  }

  /** The user says a form printed for another name is this profile's own: the question is closed and the name remembered. */
  async claimDocument(profileId: string, documentId: string) {
    const doc = await this.d.repo.getDocument(profileId, documentId);
    if (!doc) throw new NotFoundError("Документ не найден");
    const profile = await this.profile(profileId);
    const patientKey = `llm:${documentId}:patient`;
    const at = this.now();
    for (const f of await this.d.repo.listFacts(profileId))
      if (f.dedupKey === patientKey && f.value.kind === "clarification" && f.value.resolution !== "resolved")
        await this.d.repo.saveFact(resolveClarification(f, `Документ профиля «${profile.name}»`, at));
    const proposal = await this.d.repo.getProposal(profileId, documentId);
    if (proposal) {
      await this.d.repo.saveProposal(profileId, { ...proposal, items: proposal.items.filter((i) => i.key !== patientKey) });
      if (proposal.patientName && !profile.patientNames?.some((n) => n.toLowerCase() === proposal.patientName!.toLowerCase()))
        await this.d.repo.saveProfile({ ...profile, patientNames: [...(profile.patientNames ?? []), proposal.patientName] });
    }
    return doc;
  }

  async profile(profileId: string): Promise<Profile> {
    const p = await this.d.repo.getProfile(profileId);
    if (!p) throw new NotFoundError("Профиль не найден");
    return p;
  }

  // ---------- Documents ----------

  async listDocuments(profileId: string) {
    await this.profile(profileId);
    const docs = await this.d.repo.listDocuments(profileId);
    const facts = await this.d.repo.listFacts(profileId);
    const { focus } = await this.focusOf(profileId, docs, facts);
    return docs
      .map((doc) => {
        const own = facts.filter((f) => f.sources.some((s) => s.documentId === doc.id));
        return {
          document: doc,
          focus: focus.get(doc.id)!,
          factCount: own.length,
          unverifiedCount: own.filter((f) => f.verification === "unverified").length,
        };
      })
      .sort((a, b) => (b.document.documentDate ?? "").localeCompare(a.document.documentDate ?? ""));
  }

  async getDocument(profileId: string, documentId: string) {
    const document = await this.d.repo.getDocument(profileId, documentId);
    if (!document) throw new NotFoundError("Документ не найден");
    const [versions, facts, proposal, encounters] = await Promise.all([
      this.d.repo.listVersions(profileId, documentId),
      this.d.repo.listFacts(profileId),
      this.d.repo.getProposal(profileId, documentId),
      this.d.repo.listEncounters(profileId),
    ]);
    const encounter = encounters.find((e) => e.id === document.encounterId) ?? null;
    const allDocs = encounter ? await this.d.repo.listDocuments(profileId) : [];
    const areas = focusAreas((await this.profile(profileId)).focus);
    const v = versions.find((x) => x.method !== "prepared");
    const focus = documentFocus(document, facts, v ? [...v.pages, ...v.segments.map((x) => x.text)].join("\n").slice(0, 100_000) : "", areas);
    return {
      document,
      focus: { ...focus, titles: focus.areas.map((id) => areas.find((a) => a.id === id)?.title ?? id) },
      versions,
      facts: facts.filter((f) => f.sources.some((s) => s.documentId === documentId)),
      proposal,
      encounter,
      relatedDocuments: allDocs.filter((d) => encounter?.documentIds.includes(d.id) && d.id !== documentId),
    };
  }

  async getOriginal(profileId: string, documentId: string): Promise<{ bytes: Uint8Array; mime: string; fileName: string }> {
    const doc = await this.d.repo.getDocument(profileId, documentId);
    if (!doc?.original) throw new NotFoundError("Оригинал не найден");
    const bytes = await this.d.files.get(doc.original.sha256);
    if (!bytes) throw new NotFoundError("Файл оригинала отсутствует в хранилище");
    return { bytes, mime: doc.original.mime, fileName: doc.original.fileName };
  }

  async upload(profileId: string, input: UploadInput): Promise<{ document: SourceDocument; duplicate: boolean }> {
    await this.profile(profileId);
    const mime = mimeFor(input.fileName, input.mime);
    if (!input.bytes.length) throw new ValidationError("Файл пустой");
    if (!ALLOWED_MIME.has(mime)) throw new ValidationError("Поддерживаются PDF, текстовые файлы (.txt, .md) и записи разговора (.m4a, .mp3, .wav, .ogg, .webm)");
    if (isAudio(mime) ? input.bytes.length > MAX_AUDIO_SIZE : input.bytes.length > MAX_SIZE) throw new ValidationError(isAudio(mime) ? "Запись больше 300 МБ" : "Файл больше 25 МБ");

    const sha256 = await sha256Hex(input.bytes);
    const existing = (await this.d.repo.listDocuments(profileId)).find((d) => d.original?.sha256 === sha256);
    if (existing) return { document: await this.fillFormDates(existing), duplicate: true };

    const kind = isAudio(mime) ? "transcript" : (input.kind ?? (mime === "application/pdf" ? "other" : "transcript"));
    const doc: SourceDocument = {
      id: this.d.ids.next("doc"),
      profileId,
      kind,
      title: input.title?.trim() || input.fileName.replace(/\.[^.]+$/, ""),
      documentDate: input.documentDate || null,
      specialist: input.specialist || null,
      area: input.area || null,
      original: { fileName: input.fileName, mime, size: input.bytes.length, sha256 },
      sampleKey: null,
      preparedNotice: null,
      isSynthetic: false,
      encounterId: null,
      status: "stored",
      statusMessage: null,
      createdAt: this.now(),
    };
    if (isAudio(mime)) {
      // A recording is turned into text in the background: an hour of speech takes a while on a laptop.
      const stored: SourceDocument = this.d.transcriber
        ? { ...doc, status: "transcribing", statusMessage: "Запись расшифровывается на этом компьютере." }
        : { ...doc, status: "recognition_unavailable", statusMessage: "Расшифровка записей не подключена. Запись сохранена." };
      await this.d.files.put(sha256, input.bytes);
      await this.d.repo.saveDocument(stored);
      if (this.d.transcriber) this.startTranscription(stored, input.bytes);
      return { document: stored, duplicate: false };
    }
    // The same document saved again as another file (a re-download, a copy) has the same text: it is not stored twice.
    const rec = await this.d.recognizer.recognize({ document: doc, bytes: input.bytes });
    const text = rec.ok ? sameText(rec.version.pages) : "";
    if (text.length >= 50) {
      for (const other of await this.d.repo.listDocuments(profileId)) {
        const versions = await this.d.repo.listVersions(profileId, other.id);
        if (versions.some((v) => sameText(v.pages) === text)) return { document: await this.fillFormDates(other), duplicate: true };
      }
    }
    await this.d.files.put(sha256, input.bytes);
    await this.d.repo.saveDocument(doc);
    const processed = await this.process(doc, input.bytes, rec);
    await this.fillAllFormDates(profileId);
    return { document: processed, duplicate: false };
  }

  /** Opens a built-in example. Synthetic examples are allowed only in the demo profile. */
  async openSample(profileId: string, key: string): Promise<{ document: SourceDocument; duplicate: boolean }> {
    const profile = await this.profile(profileId);
    const sample = this.d.samples.get(key);
    if (!sample) throw new NotFoundError("Пример не найден");
    if (sample.info.synthetic !== profile.isDemo)
      throw new ValidationError(
        sample.info.synthetic
          ? "Синтетический пример можно открыть только в демо-профиле"
          : "Пример с вашими документами нельзя открыть в демо-профиле",
      );
    const existing = (await this.d.repo.listDocuments(profileId)).find((d) => d.sampleKey === key);
    if (existing) return { document: existing, duplicate: true };

    let original: SourceDocument["original"] = null;
    let bytes: Uint8Array | null = null;
    if (sample.originalText !== null) {
      bytes = new TextEncoder().encode(sample.originalText);
      const sha256 = await sha256Hex(bytes);
      await this.d.files.put(sha256, bytes);
      original = { fileName: `${sample.info.title}.txt`, mime: "text/plain", size: bytes.length, sha256 };
    }
    const doc: SourceDocument = {
      id: this.d.ids.next("doc"),
      profileId,
      kind: sample.info.kind,
      title: sample.info.title,
      documentDate: sample.info.documentDate,
      specialist: sample.info.specialist,
      area: sample.info.area,
      original,
      sampleKey: key,
      preparedNotice: sample.info.preparedNotice,
      isSynthetic: sample.info.synthetic,
      encounterId: null,
      status: "stored",
      statusMessage: null,
      createdAt: this.now(),
    };
    await this.d.repo.saveDocument(doc);
    if (sample.preparedPages) {
      await this.d.repo.saveVersion({
        id: this.d.ids.next("ver"),
        profileId,
        documentId: doc.id,
        method: "prepared",
        pages: sample.preparedPages,
        segments: [],
        note: sample.info.preparedNotice,
        createdAt: this.now(),
      });
    }
    return { document: await this.process(doc, bytes), duplicate: false };
  }

  /** Lets the user attach their own original to an example; the prepared parse stays marked as unchecked. */
  async attachOriginal(profileId: string, documentId: string, file: { fileName: string; mime: string; bytes: Uint8Array }) {
    const doc = await this.d.repo.getDocument(profileId, documentId);
    if (!doc) throw new NotFoundError("Документ не найден");
    if (doc.original) throw new ValidationError("У документа уже есть оригинал");
    const mime = mimeFor(file.fileName, file.mime);
    if (mime !== "application/pdf") throw new ValidationError("Прикрепить можно только PDF");
    if (!file.bytes.length) throw new ValidationError("Файл пустой");
    const sha256 = await sha256Hex(file.bytes);
    await this.d.files.put(sha256, file.bytes);
    const updated: SourceDocument = { ...doc, original: { fileName: file.fileName, mime, size: file.bytes.length, sha256 } };
    await this.d.repo.saveDocument(updated);
    const rec = await this.d.recognizer.recognize({ document: updated, bytes: file.bytes });
    if (rec.ok) await this.saveVersion(updated, rec.version);
    return this.getDocument(profileId, documentId);
  }

  private transcriptions = new Map<string, Promise<void>>();

  private startTranscription(doc: SourceDocument, bytes: Uint8Array) {
    if (this.transcriptions.has(doc.id)) return;
    const run = this.transcribe(doc, bytes).finally(() => this.transcriptions.delete(doc.id));
    this.transcriptions.set(doc.id, run);
  }

  /** Resolves once every transcription in progress has finished (used by tests). */
  async transcriptionsIdle() {
    while (this.transcriptions.size) await Promise.all([...this.transcriptions.values()]);
  }

  private async transcribe(doc: SourceDocument, bytes: Uint8Array) {
    const fail = async (message: string) => {
      const current = (await this.d.repo.getDocument(doc.profileId, doc.id)) ?? doc;
      await this.d.repo.saveDocument({ ...current, status: "recognition_unavailable", statusMessage: message });
    };
    let result: Awaited<ReturnType<SpeechTranscriber["transcribe"]>>;
    try {
      result = await this.d.transcriber!.transcribe(bytes, doc.original!.mime);
    } catch {
      // Generic on purpose: no words of the recording in logs or errors.
      return fail("Не удалось расшифровать запись. Оригинал сохранён.");
    }
    if (!result.ok) return fail(result.message);
    const segments: TranscriptSegment[] = result.segments
      .map((s) => ({ ...s, text: s.text.trim() }))
      .filter((s) => s.text)
      // Speech-to-text does not tell the doctor from the patient: every line is marked as unclear.
      .map((s, i) => ({ id: `s${i + 1}`, speaker: "unclear", speakerLabel: null, timecode: timecodeOf(s.start), text: s.text }));
    if (!segments.length) return fail("В записи не найдено речи. Оригинал сохранён.");
    const current = (await this.d.repo.getDocument(doc.profileId, doc.id)) ?? doc;
    const recordedAt = normalizeIsoDate(result.recordedAt?.slice(0, 10));
    const ready: SourceDocument = { ...current, documentDate: current.documentDate ?? recordedAt ?? null, status: "recognized", statusMessage: null };
    await this.d.repo.saveDocument(ready);
    await this.saveVersion(ready, {
      method: "speech_to_text",
      pages: [segments.map((s) => `[${s.timecode}] ${s.text}`).join("\n")],
      segments,
      note: `Расшифровано на этом компьютере (${result.model}); говорящие не размечены`,
    });
    await this.process(ready, null);
  }

  /** Starts the transcription of a recording again; a text already made from it is kept until the new one is ready. */
  async retranscribe(profileId: string, documentId: string) {
    if (!this.d.transcriber) throw new ValidationError("Расшифровка записей не подключена");
    const doc = await this.d.repo.getDocument(profileId, documentId);
    if (!doc) throw new NotFoundError("Документ не найден");
    if (!doc.original || !isAudio(doc.original.mime)) throw new ValidationError("Это не запись разговора");
    if (doc.status !== "recognition_unavailable" && doc.status !== "error") throw new ValidationError("Запись уже расшифрована или расшифровывается");
    const bytes = await this.d.files.get(doc.original.sha256);
    if (!bytes) throw new NotFoundError("Файл оригинала отсутствует в хранилище");
    const started: SourceDocument = { ...doc, status: "transcribing", statusMessage: "Запись расшифровывается на этом компьютере." };
    await this.d.repo.saveDocument(started);
    this.startTranscription(started, bytes);
    return started;
  }

  /** Recordings whose transcription was cut short by a restart start again. */
  async resumeTranscriptions() {
    if (!this.d.transcriber) return;
    for (const p of await this.d.repo.listProfiles())
      for (const doc of await this.d.repo.listDocuments(p.id)) {
        if (doc.status !== "transcribing" || !doc.original) continue;
        const bytes = await this.d.files.get(doc.original.sha256);
        if (bytes) this.startTranscription(doc, bytes);
      }
  }

  private async saveVersion(doc: SourceDocument, v: Omit<ContentVersion, "id" | "profileId" | "documentId" | "createdAt">) {
    await this.d.repo.saveVersion({ ...v, id: this.d.ids.next("ver"), profileId: doc.profileId, documentId: doc.id, createdAt: this.now() });
  }

  private async process(doc: SourceDocument, bytes: Uint8Array | null, recognized?: Awaited<ReturnType<Deps["recognizer"]["recognize"]>>): Promise<SourceDocument> {
    let current = doc;
    const setStatus = async (status: SourceDocument["status"], statusMessage: string | null) => {
      current = { ...current, status, statusMessage };
      await this.d.repo.saveDocument(current);
    };
    try {
      if (bytes) {
        const rec = recognized ?? (await this.d.recognizer.recognize({ document: doc, bytes }));
        if (rec.ok) {
          await this.saveVersion(doc, rec.version);
          await setStatus("recognized", null);
        } else {
          await setStatus("recognition_unavailable", rec.message);
        }
      }
      const versions = await this.d.repo.listVersions(doc.profileId, doc.id);
      const ex = await this.d.extractor.extract({ document: current, versions });
      if (!ex.ok && !current.sampleKey) {
        // A lab form of a known layout is parsed locally: no model, nothing sent anywhere.
        const proposal = await this.labFormProposal(current, versions);
        if (proposal) {
          await this.d.repo.saveProposal(doc.profileId, proposal);
          await setStatus("review_pending", null);
          return current;
        }
      }
      if (!ex.ok && ex.reason === "not_connected" && this.d.live && !current.sampleKey) {
        // Nothing is sent automatically: the user decides per document.
        await setStatus("extraction_ready", [current.status === "recognition_unavailable" ? current.statusMessage : null, this.readyMessage()].filter(Boolean).join(" "));
        return current;
      }
      if (!ex.ok) {
        await setStatus(
          current.status === "recognition_unavailable" ? "recognition_unavailable" : "extraction_unavailable",
          [current.statusMessage, ex.message].filter(Boolean).join(" "),
        );
        return current;
      }
      await this.d.repo.saveProposal(doc.profileId, ex.proposal);
      await setStatus("review_pending", null);
    } catch {
      // Message is generic on purpose: no document content in logs or errors.
      await setStatus("error", "Не удалось обработать документ. Оригинал сохранён.");
    }
    return current;
  }

  /** Proposal from the local lab-form parser, or null when the layout is not recognized. */
  private async labFormProposal(doc: SourceDocument, versions: ContentVersion[]): Promise<Proposal | null> {
    const text = versions.find((v) => v.method === "pdf_text_layer" || v.method === "plain_text" || v.method === "transcript_parser" || v.method === "speech_to_text");
    // A lab form or a consultation of a known layout; anything else is left for the model.
    const parsed = text ? (parseLabForm(text.pages) ?? parseConsultation(text.pages)) : null;
    if (!parsed) return null;
    const proposal = proposalFromExtraction(doc, versions, parsed, null, "parser");
    proposal.patientName = parsed.patientName;
    // A form printed for someone else (a family member) is pointed out before anything is applied.
    const others = new Set<string>();
    for (const d of await this.d.repo.listDocuments(doc.profileId)) {
      if (d.id === doc.id) continue;
      const name = (await this.d.repo.getProposal(doc.profileId, d.id))?.patientName;
      if (name) others.add(name.toLowerCase());
    }
    // A name already moved to another profile points there even when this profile has no forms yet.
    const name = parsed.patientName?.toLowerCase() ?? null;
    const owner = name
      ? (await this.d.repo.listProfiles()).find((p) => p.id !== doc.profileId && p.patientNames?.some((n) => n.toLowerCase() === name))
      : undefined;
    // A name the user already confirmed for this profile is never questioned again.
    const mine = name ? (await this.d.repo.getProfile(doc.profileId))?.patientNames?.some((n) => n.toLowerCase() === name) : false;
    if (parsed.patientName && !mine && ((others.size && !others.has(name!)) || owner)) {
      const key = `llm:${doc.id}:patient`;
      proposal.items.unshift({
        key,
        group: "clarify",
        explanation: owner ? `ФИО в документе совпадает с профилем «${owner.name}».` : "ФИО в документе отличается от других документов профиля.",
        draft: {
          type: "clarification",
          label: `Бланк выписан на «${parsed.patientName}». Это документ этого профиля?`,
          value: { kind: "clarification", question: `Бланк выписан на «${parsed.patientName}». Это документ этого профиля?`, aboutFactIds: [], resolution: "open", answer: null },
          originalText: parsed.patientName,
          sources: [{ documentId: doc.id, versionId: text!.id, page: 1, quote: parsed.patientName, quoteIsExact: false, timecode: null, segmentId: null, speaker: null, sourceType: "personal" }],
          eventDate: { kind: "unknown" },
          documentDate: proposal.documentDate ?? doc.documentDate,
          validity: { status: "unknown", from: null, to: null, confirmedAt: null },
          extraction: { method: "parser", confidence: null, model: null },
          specialist: doc.specialist,
          problem: null,
          dedupKey: key,
          aboutKeys: [],
        },
      });
    }
    return proposal;
  }

  /** Fills missing dates of every lab form already in the profiles; runs at startup and after each upload. */
  async fillAllFormDates(profileId?: string) {
    const profiles = profileId ? [profileId] : (await this.d.repo.listProfiles()).map((p) => p.id);
    for (const pid of profiles) for (const doc of await this.d.repo.listDocuments(pid)) await this.fillLabels(await this.fillFormDates(await this.parsePendingLocally(doc)));
  }

  /**
   * A lab form uploaded again fills the dates its facts are missing from the date printed in the form.
   * Only empty dates are filled, and never on facts the user corrected; values are not touched.
   */
  private async fillFormDates(doc: SourceDocument): Promise<SourceDocument> {
    if (doc.sampleKey) return doc;
    const facts = (await this.d.repo.listFacts(doc.profileId)).filter((f) => f.sources.some((s) => s.documentId === doc.id));
    const undated = facts.some((f) => f.documentDate === null || (f.type === "lab_result" && f.eventDate.kind === "unknown"));
    if (!undated && doc.documentDate) return doc;
    // The date printed in a known lab form wins; otherwise the date the earlier extraction found for the document or its visit.
    const form = await this.labFormProposal(doc, await this.d.repo.listVersions(doc.profileId, doc.id));
    const stored = await this.d.repo.getProposal(doc.profileId, doc.id);
    const encounter = (await this.d.repo.listEncounters(doc.profileId)).find((e) => e.id === doc.encounterId) ?? stored?.encounter ?? null;
    const encounterDate = encounter?.date.kind === "exact" ? encounter.date.date : null;
    const date = form?.documentDate ?? doc.documentDate ?? stored?.documentDate ?? encounterDate;
    if (!date) return doc;
    const at = this.now();
    for (const f of facts) {
      // A lab result was collected on the form's date, or on the date of a lab visit; a consultation's date says nothing about it.
      const collected = (form?.encounter?.kind === "lab" ? form.documentDate : null) ?? (encounter?.kind === "lab" ? encounterDate : null);
      const eventDate = f.type === "lab_result" && collected ? ({ kind: "exact", date: collected } as const) : ({ kind: "unknown" } as const);
      const next = fillMissingDates(f, eventDate, date, at);
      if (next !== f) await this.d.repo.saveFact(next);
    }
    if (doc.documentDate) return doc;
    const updated: SourceDocument = { ...doc, documentDate: date };
    await this.d.repo.saveDocument(updated);
    return updated;
  }

  /**
   * Fills the document's empty type, section, doctor and clinic from what parsing found
   * (the stored proposal, the visit, the lab results). Nothing the user entered is replaced.
   */
  private async fillLabels(doc: SourceDocument): Promise<SourceDocument> {
    if (doc.sampleKey || doc.labelsEditedAt) return doc;
    if (doc.kind !== "other" && doc.area && (doc.specialist || doc.kind === "lab_report") && doc.institution) return doc;
    const proposal = (await this.d.repo.getProposal(doc.profileId, doc.id)) ?? (await this.labFormProposal(doc, await this.d.repo.listVersions(doc.profileId, doc.id)));
    const encounter = (await this.d.repo.listEncounters(doc.profileId)).find((e) => e.id === doc.encounterId) ?? proposal?.encounter ?? null;
    const labNames = new Set<string>();
    for (const i of proposal?.items ?? []) if (i.draft.value.kind === "lab_result" && i.draft.value.origin === "lab_report") labNames.add(i.draft.value.rawName);
    for (const f of await this.d.repo.listFacts(doc.profileId)) {
      if (f.value.kind === "lab_result" && f.value.origin === "lab_report" && f.sources.some((s) => s.documentId === doc.id)) labNames.add(f.value.rawName);
    }
    const next = applyLabels(doc, deriveLabels({ encounter, labNames: [...labNames], title: doc.title }), proposal?.items.some((i) => i.draft.extraction.method === "parser") ?? false);
    if (next !== doc) await this.d.repo.saveDocument(next);
    return next;
  }

  /** The user's own type, section, doctor and clinic; from now on they are not filled automatically. */
  async setDocumentLabels(profileId: string, documentId: string, input: { kind?: string; area?: string | null; specialist?: string | null; institution?: string | null }) {
    const doc = await this.d.repo.getDocument(profileId, documentId);
    if (!doc) throw new NotFoundError("Документ не найден");
    const KINDS: DocumentKind[] = ["lab_report", "consultation", "examination", "transcript", "note", "other"];
    if (input.kind !== undefined && !KINDS.includes(input.kind as DocumentKind)) throw new ValidationError("Неизвестный тип документа");
    const text = (v: string | null | undefined, old: string | null | undefined) => (v === undefined ? (old ?? null) : v?.trim().slice(0, 80) || null);
    await this.d.repo.saveDocument({
      ...doc,
      kind: (input.kind as DocumentKind | undefined) ?? doc.kind,
      area: text(input.area, doc.area),
      specialist: text(input.specialist, doc.specialist),
      institution: text(input.institution, doc.institution),
      labelsEditedAt: this.now(),
    });
    return this.getDocument(profileId, documentId);
  }

  /** A document that was waiting for the model is parsed locally once a parser for its layout exists. */
  private async parsePendingLocally(doc: SourceDocument): Promise<SourceDocument> {
    if (doc.sampleKey || !["extraction_ready", "extraction_unavailable"].includes(doc.status)) return doc;
    if (await this.d.repo.getProposal(doc.profileId, doc.id)) return doc;
    const local = await this.labFormProposal(doc, await this.d.repo.listVersions(doc.profileId, doc.id));
    if (!local) return doc;
    await this.d.repo.saveProposal(doc.profileId, local);
    const parsed: SourceDocument = { ...doc, status: "review_pending", statusMessage: null };
    await this.d.repo.saveDocument(parsed);
    return parsed;
  }

  /** Parses an already uploaded document with the local lab-form parser. */
  async parseLocally(profileId: string, documentId: string) {
    const doc = await this.d.repo.getDocument(profileId, documentId);
    if (!doc) throw new NotFoundError("Документ не найден");
    if (doc.sampleKey) throw new ValidationError("У примера уже есть подготовленный разбор.");
    const proposal = await this.labFormProposal(doc, await this.d.repo.listVersions(profileId, documentId));
    if (!proposal) throw new ValidationError("Шаблон документа не распознан: его можно разобрать только с помощью модели.");
    // An earlier parse of this document by a previous version of the template may have misread a row.
    // Its facts that the new parse no longer finds, and that the user never checked or corrected, are withdrawn.
    const found = new Set(proposal.items.map((i) => i.draft.dedupKey));
    const at = this.now();
    for (const f of await this.d.repo.listFacts(profileId)) {
      const onlyHere = f.sources.length > 0 && f.sources.every((x) => x.documentId === documentId);
      if (!onlyHere || f.extraction.method !== "parser" || f.verification !== "unverified" || f.type !== "lab_result" || found.has(f.dedupKey)) continue;
      await this.d.repo.saveFact({ ...f, verification: "rejected", revisions: [...f.revisions, { at, action: "rejected", reason: "Не подтверждено повторным разбором по шаблону", before: null, after: null }] });
    }
    await this.d.repo.saveProposal(profileId, proposal);
    const updated: SourceDocument = { ...doc, status: "review_pending", statusMessage: null };
    await this.d.repo.saveDocument(updated);
    return this.fillLabels(updated);
  }

  private readyMessage() {
    return `Факты можно извлечь с помощью ${this.d.live!.provider} (${this.d.live!.model}). Документ отправляется по кнопке «Отправить и извлечь факты».`;
  }

  /** The connected model, if any. */
  liveModel(): { provider: string; model: string } | null {
    return this.d.live ? { provider: this.d.live.provider, model: this.d.live.model } : null;
  }

  /**
   * Sends one document to the connected model and stores its proposal for review.
   * Requires explicit consent for this document; prepared examples are never sent.
   */
  async extractWithModel(profileId: string, documentId: string, consent: boolean): Promise<SourceDocument> {
    const doc = await this.d.repo.getDocument(profileId, documentId);
    if (!doc) throw new NotFoundError("Документ не найден");
    // A document the local parsers can read never goes to the model.
    if (!doc.sampleKey) {
      const local = await this.labFormProposal(doc, await this.d.repo.listVersions(profileId, documentId));
      if (local) {
        await this.d.repo.saveProposal(profileId, local);
        const parsed: SourceDocument = { ...doc, status: doc.status === "applied" ? "applied" : "review_pending", statusMessage: null };
        await this.d.repo.saveDocument(parsed);
        return this.fillLabels(parsed);
      }
    }
    if (!this.d.live) throw new ValidationError("Модель не подключена: укажите ключ API в .env.local.");
    if (!consent) throw new ValidationError("Нужно согласие на отправку документа.");
    if (doc.sampleKey) throw new ValidationError("У примера уже есть подготовленный разбор; он не отправляется модели.");
    // A repeated extraction (status applied or review_pending) is allowed: matching facts are merged, not duplicated.
    const versions = await this.d.repo.listVersions(profileId, documentId);
    const bytes = doc.original ? await this.d.files.get(doc.original.sha256) : null;
    const ex = await this.d.live.extractor.extract({ document: doc, versions, original: bytes && doc.original ? { bytes, mime: doc.original.mime } : null });
    if (!ex.ok) {
      const failed: SourceDocument = { ...doc, status: "extraction_ready", statusMessage: `${ex.message} Оригинал сохранён; можно попробовать ещё раз.` };
      await this.d.repo.saveDocument(failed);
      throw new ExternalServiceError(ex.message);
    }
    await this.d.repo.saveProposal(profileId, ex.proposal);
    const updated: SourceDocument = { ...doc, status: "review_pending", statusMessage: null };
    await this.d.repo.saveDocument(updated);
    return this.fillLabels(updated);
  }

  /**
   * Applies an extraction proposal. Idempotent: a fact with an existing dedupKey
   * gets the new source added instead of being created again.
   */
  async applyProposal(profileId: string, documentId: string, decision: ProposalDecision) {
    const doc = await this.d.repo.getDocument(profileId, documentId);
    if (!doc) throw new NotFoundError("Документ не найден");
    const proposal = await this.d.repo.getProposal(profileId, documentId);
    if (!proposal) throw new ValidationError("Для документа нет предложений");
    const at = this.now();

    // Encounter linking: documents of the same visit share one encounter.
    let encounterId: string | null = doc.encounterId;
    if (proposal.encounter) {
      const encounters = await this.d.repo.listEncounters(profileId);
      const id = `enc_${profileId}_${proposal.encounter.key}`;
      const existing = encounters.find((e) => e.id === id);
      const { key: _key, ...rest } = proposal.encounter;
      void _key;
      const enc: Encounter = existing
        ? { ...existing, documentIds: [...new Set([...existing.documentIds, doc.id])] }
        : { ...rest, id, profileId, documentIds: [doc.id] };
      await this.d.repo.saveEncounter(enc);
      encounterId = id;
    }

    const facts = await this.d.repo.listFacts(profileId);
    const byKey = new Map(facts.map((f) => [f.dedupKey, f]));
    // Facts a model extracted from this document before, by what they say: a repeated extraction merges into them.
    const llmKey = (f: Pick<Fact, "type" | "label" | "value">) => `llm:${documentId}:${contentKey(f)}`;
    for (const f of facts) {
      if ((f.extraction.method === "llm" || f.extraction.method === "parser") && f.sources.some((s) => s.documentId === documentId) && !byKey.has(llmKey(f))) byKey.set(llmKey(f), f);
    }
    // One measurement printed in several forms (a panel and its separate blank, a re-issued form) is one fact with several sources.
    const measurementKey = (f: Pick<Fact, "value" | "eventDate">) =>
      f.value.kind === "lab_result" && f.value.origin === "lab_report" && f.eventDate.kind === "exact"
        ? `${indicatorOf(f.value)}|${f.eventDate.date}|${f.value.value.raw.replace(/\s+/g, "").replace(",", ".")}|${normalizeUnit(f.value.unit)}`
        : null;
    const byMeasurement = new Map<string, Fact>();
    for (const f of facts) {
      const k = measurementKey(f);
      if (k && f.verification !== "rejected" && !byMeasurement.has(k)) byMeasurement.set(k, f);
    }
    const touched = new Map<string, Fact>();

    const materialize = (draft: FactDraft): Fact => {
      const mk = measurementKey(draft);
      const sameMeasurement = mk ? byMeasurement.get(mk) : undefined;
      const prev = touched.get(draft.dedupKey) ?? byKey.get(draft.dedupKey) ?? (sameMeasurement && (touched.get(sameMeasurement.dedupKey) ?? sameMeasurement));
      if (prev) {
        let f = prev;
        for (const s of draft.sources) f = addSource(f, s, at);
        if (draft.extraction.method === "llm" || draft.extraction.method === "parser") f = fillMissingDates(f, draft.eventDate, draft.documentDate, at);
        return f;
      }
      const { conflictsWith: _c, aboutKeys: _a, ...rest } = draft;
      void _c;
      void _a;
      return {
        ...structuredClone(rest),
        id: this.d.ids.next("fact"),
        profileId,
        verification: "unverified",
        conflictGroupId: null,
        encounterId,
        revisions: [{ at, action: "created", reason: null, before: null, after: null }],
        createdAt: at,
      };
    };

    // Non-clarifications first so clarifications can reference them.
    const ordered = [...proposal.items].sort((a, b) => Number(a.draft.type === "clarification") - Number(b.draft.type === "clarification"));
    for (const item of ordered) {
      let f = materialize(item.draft);
      const isNew = !byKey.has(item.draft.dedupKey) && !touched.has(item.draft.dedupKey);
      if (f.value.kind === "clarification") {
        const aboutIds = (item.draft.aboutKeys ?? [])
          .map((k) => (touched.get(k) ?? byKey.get(k))?.id)
          .filter((x): x is string => !!x);
        if (isNew) {
          const resolution = decision.postponedClarifications.includes(item.key) ? "postponed" : "open";
          f = { ...f, value: { ...f.value, aboutFactIds: aboutIds, resolution } };
        }
      }
      if (item.group === "state_change" && item.stateChange && decision.acceptedStateChanges.includes(item.key)) {
        if (item.stateChange.medicationStatus) f = setMedicationStatus(f, item.stateChange.medicationStatus, at);
        else if (item.stateChange.validity?.status === "current") f = confirmCurrent(f, at);
      }
      touched.set(item.draft.dedupKey, f);
    }

    // Contradictions: keep both, link them.
    for (const item of proposal.items) {
      for (const otherKey of item.draft.conflictsWith ?? []) {
        const a = touched.get(item.draft.dedupKey);
        const b = touched.get(otherKey) ?? byKey.get(otherKey);
        if (!a || !b) continue;
        const group = a.conflictGroupId ?? b.conflictGroupId ?? `conf_${a.id}`;
        touched.set(a.dedupKey, { ...a, conflictGroupId: group });
        touched.set(b.dedupKey, { ...(touched.get(b.dedupKey) ?? b), conflictGroupId: group });
      }
    }

    for (const f of touched.values()) await this.d.repo.saveFact(f);
    await this.linkMentions(profileId, at);
    // A document uploaded as "other" takes its kind from the event it records.
    const ENC_KIND = { visit: "consultation", lab: "lab_report", examination: "examination" } as const;
    const kind = doc.kind === "other" && proposal.encounter ? ENC_KIND[proposal.encounter.kind] : doc.kind;
    // A title that is just the file name is replaced by the name of the event the document records.
    const fileTitle = doc.original ? doc.original.fileName.replace(/\.[^.]+$/, "") : null;
    const title = proposal.encounter && doc.title === fileTitle ? proposal.encounter.title : doc.title;
    const updated: SourceDocument = { ...doc, kind, title, status: "applied", statusMessage: null, encounterId, documentDate: doc.documentDate ?? proposal.documentDate ?? null };
    await this.d.repo.saveDocument(updated);
    await this.fillLabels(await this.fillFormDates(updated));
    return this.getDocument(profileId, documentId);
  }

  /**
   * Applies a document's proposal without a review card, for bulk upload. Facts are added unverified as always;
   * changes to the current state are not accepted and clarifications stay open, so they wait for the user's decision.
   * A form printed for another person is left for manual review.
   */
  async autoApply(profileId: string, documentId: string): Promise<{ document: SourceDocument; applied: boolean; added: number; decisions: number; reason: string | null }> {
    const doc = await this.d.repo.getDocument(profileId, documentId);
    if (!doc) throw new NotFoundError("Документ не найден");
    const proposal = await this.d.repo.getProposal(profileId, documentId);
    if (doc.status !== "review_pending" || !proposal) return { document: doc, applied: false, added: 0, decisions: 0, reason: "Нечего применять: фактов не предложено." };
    if (proposal.items.some((i) => i.key === `llm:${documentId}:patient`))
      return { document: doc, applied: false, added: 0, decisions: 1, reason: "Бланк выписан на другого человека: откройте документ и решите, относится ли он к профилю." };
    const before = new Set((await this.d.repo.listFacts(profileId)).map((f) => f.id));
    const result = await this.applyProposal(profileId, documentId, { acceptedStateChanges: [], postponedClarifications: [] });
    return {
      document: result.document,
      applied: true,
      added: result.facts.filter((f) => !before.has(f.id)).length,
      decisions: proposal.items.filter((i) => i.group !== "history").length,
      reason: null,
    };
  }

  /** Sets or clears the document date; facts from this document that carried the old date get the new one. */
  async setDocumentDate(profileId: string, documentId: string, date: string | null) {
    const doc = await this.d.repo.getDocument(profileId, documentId);
    if (!doc) throw new NotFoundError("Документ не найден");
    const next = date ? normalizeIsoDate(date) : null;
    if (next === undefined) throw new ValidationError("Дата должна быть в формате ГГГГ-ММ-ДД или ДД.ММ.ГГГГ");
    const facts = await this.d.repo.listFacts(profileId);
    for (const f of facts) {
      if (f.sources.some((s) => s.documentId === documentId) && f.documentDate === doc.documentDate) await this.d.repo.saveFact({ ...f, documentDate: next });
    }
    await this.d.repo.saveDocument({ ...doc, documentDate: next });
    return this.getDocument(profileId, documentId);
  }

  /** Links numbers quoted in consultations to the lab-form result, so one measurement is one point. */
  private async linkMentions(profileId: string, at: string) {
    const facts = await this.d.repo.listFacts(profileId);
    for (const f of facts) {
      if (f.value.kind !== "lab_result" || f.value.origin !== "mention" || f.value.linkedResultId) continue;
      const match = findMatchingResult(f, facts);
      if (!match) continue;
      await this.d.repo.saveFact({
        ...f,
        value: { ...f.value, linkedResultId: match.id },
        revisions: [...f.revisions, { at, action: "status_changed", reason: "Связано с результатом лабораторного бланка", before: null, after: null }],
      });
    }
  }

  // ---------- Facts ----------

  async listFacts(profileId: string) {
    await this.profile(profileId);
    return this.d.repo.listFacts(profileId);
  }

  async factAction(profileId: string, factId: string, action: FactAction): Promise<Fact> {
    const f = await this.d.repo.getFact(profileId, factId);
    if (!f) throw new NotFoundError("Факт не найден");
    const at = this.now();
    const toDate = (d: string | null): DateValue => (d ? exactDate(d) : unknownDate());
    let next: Fact;
    switch (action.type) {
      case "correct":
        next = correctFact(f, toCorrection(f, action.patch), at, action.reason);
        break;
      case "confirm_current":
        next = confirmCurrent(f, at);
        break;
      case "mark_historical":
        next = markHistorical(f, at);
        break;
      case "end":
        next = endFact(f, at, toDate(action.endDate));
        break;
      case "medication_status":
        if (f.value.kind !== "medication") throw new ValidationError("Это не препарат");
        next = setMedicationStatus(f, action.status, at, action.startDate ? exactDate(action.startDate) : null);
        break;
      case "resolve":
        if (f.value.kind !== "clarification") throw new ValidationError("Это не вопрос");
        next = resolveClarification(f, action.answer, at);
        break;
      case "appointment_attended":
        if (f.value.kind !== "appointment") throw new ValidationError("Это не явка");
        next = correctFact(f, { value: { ...f.value, attended: action.attended } }, at, action.attended === "yes" ? "Посещение подтверждено" : "Не посещал");
        break;
      case "reject":
        next = { ...f, verification: "rejected", revisions: [...f.revisions, { at, action: "rejected", reason: action.reason, before: null, after: null }] };
        break;
    }
    await this.d.repo.saveFact(next);
    return next;
  }

  /** A manual note becomes its own source with the patient's words. */
  async addNote(profileId: string, input: { kind: "complaint" | "medication" | "event"; text: string; current: boolean; date: string | null }) {
    await this.profile(profileId);
    const text = input.text.trim();
    if (!text) throw new ValidationError("Заметка пустая");
    const at = this.now();
    const bytes = new TextEncoder().encode(text);
    const sha256 = await sha256Hex(bytes);
    await this.d.files.put(sha256, bytes);
    const doc: SourceDocument = {
      id: this.d.ids.next("doc"),
      profileId,
      kind: "note",
      title: `Заметка: ${text.slice(0, 40)}`,
      documentDate: at.slice(0, 10),
      specialist: null,
      area: null,
      original: { fileName: "note.txt", mime: "text/plain", size: bytes.length, sha256 },
      sampleKey: null,
      preparedNotice: null,
      isSynthetic: false,
      encounterId: null,
      status: "applied",
      statusMessage: null,
      createdAt: at,
    };
    await this.d.repo.saveDocument(doc);
    const versionId = this.d.ids.next("ver");
    await this.d.repo.saveVersion({ id: versionId, profileId, documentId: doc.id, method: "plain_text", pages: [text], segments: [], note: null, createdAt: at });
    const source: SourceRef = { documentId: doc.id, versionId, page: null, quote: text, quoteIsExact: true, timecode: null, segmentId: null, speaker: "patient", sourceType: "personal" };
    const eventDate = input.date ? exactDate(input.date) : unknownDate();
    const fact: Fact = {
      id: this.d.ids.next("fact"),
      profileId,
      type: input.kind === "complaint" ? "complaint" : input.kind === "medication" ? "medication" : "note",
      label: text,
      value:
        input.kind === "medication"
          ? { kind: "medication", name: text, dose: null, status: input.current ? "taking_now" : "unknown" }
          : { kind: "text", text },
      originalText: text,
      sources: [source],
      eventDate,
      documentDate: doc.documentDate,
      verification: "confirmed",
      validity: { status: input.current ? "current" : "unknown", from: eventDate, to: null, confirmedAt: input.current ? at : null },
      extraction: { method: "manual", confidence: null },
      specialist: null,
      problem: null,
      encounterId: null,
      dedupKey: `note:${doc.id}`,
      conflictGroupId: null,
      revisions: [{ at, action: "created", reason: "Заметка пациента", before: null, after: null }],
      createdAt: at,
    };
    await this.d.repo.saveFact(fact);
    return fact;
  }

  // ---------- Derived views ----------

  /** Overview for a doctor from stored facts only. */
  async doctorSummary(profileId: string) {
    return buildDoctorSummary(await this.listFacts(profileId), await this.d.repo.listDocuments(profileId), this.now().slice(0, 10));
  }

  /** Everything waiting for the user's decision, across all documents. */
  async decisions(profileId: string) {
    const docs = await this.d.repo.listDocuments(profileId);
    const withPatient = await Promise.all(
      docs.map(async (document) => ({
        document,
        otherPatient: !!(await this.d.repo.getProposal(profileId, document.id))?.items.some((i) => i.key === `llm:${document.id}:patient`),
      })),
    );
    return buildDecisions(await this.listFacts(profileId), withPatient, this.now().slice(0, 10));
  }

  // ---------- Focus ----------

  /** Focus areas of the profile and the areas of each document, by rules only. */
  private async focusOf(profileId: string, docs?: SourceDocument[], facts?: Fact[]) {
    const profile = await this.profile(profileId);
    const areas = focusAreas(profile.focus);
    docs ??= await this.d.repo.listDocuments(profileId);
    facts ??= await this.d.repo.listFacts(profileId);
    const focus = new Map<string, DocumentFocus>();
    for (const d of docs) {
      const v = (await this.d.repo.listVersions(profileId, d.id)).find((x) => x.method !== "prepared");
      const text = v ? [...v.pages, ...v.segments.map((x) => x.text)].join("\n").slice(0, 100_000) : "";
      focus.set(d.id, documentFocus(d, facts, text, areas));
    }
    return { profile, areas, focus };
  }

  /** Ids of documents out of focus: hidden by default and never part of what goes to a model. */
  private async outOfFocus(profileId: string): Promise<Set<string>> {
    const { focus } = await this.focusOf(profileId);
    return new Set([...focus].filter(([, f]) => f.status === "out").map(([id]) => id));
  }

  async focus(profileId: string) {
    const docs = await this.d.repo.listDocuments(profileId);
    const facts = await this.d.repo.listFacts(profileId);
    const { profile, areas, focus } = await this.focusOf(profileId, docs, facts);
    const out = docs.filter((d) => focus.get(d.id)?.status === "out");
    return {
      cards: buildFocusCards(docs, focus, facts, areas, this.now().slice(0, 10)),
      builtIn: DEFAULT_FOCUS_AREAS.map((a) => ({ id: a.id, title: a.title, description: a.description, enabled: !profile.focus?.disabled.includes(a.id) })),
      custom: profile.focus?.custom ?? [],
      outOfFocus: out.map((d) => ({ id: d.id, title: d.title, documentDate: d.documentDate, manual: focus.get(d.id)!.manual })),
      unsorted: docs
        .filter((d) => focus.get(d.id)?.status === "unknown")
        .map((d) => ({ id: d.id, title: d.title, documentDate: d.documentDate })),
    };
  }

  async setFocusSettings(profileId: string, input: { disabled?: unknown; custom?: unknown }) {
    const profile = await this.profile(profileId);
    const known = new Set(DEFAULT_FOCUS_AREAS.map((a) => a.id));
    const disabled = Array.isArray(input.disabled) ? [...new Set(input.disabled.filter((x): x is string => typeof x === "string" && known.has(x)))] : (profile.focus?.disabled ?? []);
    const custom = Array.isArray(input.custom)
      ? input.custom.flatMap((c: { id?: unknown; title?: unknown; keywords?: unknown }) => {
          const title = typeof c?.title === "string" ? c.title.trim().slice(0, 60) : "";
          const keywords = (Array.isArray(c?.keywords) ? c.keywords : typeof c?.keywords === "string" ? c.keywords.split(",") : [])
            .filter((k: unknown): k is string => typeof k === "string")
            .map((k: string) => k.trim().slice(0, 60))
            .filter((k: string) => k.length >= 3)
            .slice(0, 20);
          if (!title || !keywords.length) return [];
          const id = typeof c?.id === "string" && c.id.startsWith("custom_") ? c.id : this.d.ids.next("custom");
          return [{ id, title, keywords }];
        })
      : (profile.focus?.custom ?? []);
    if (Array.isArray(input.custom) && custom.length !== input.custom.length)
      throw new ValidationError("У своей области нужно название и хотя бы одно слово длиной от 3 букв");
    const focus: FocusSettings = { disabled, custom };
    await this.d.repo.saveProfile({ ...profile, focus });
    return this.focus(profileId);
  }

  /** The user's own choice for one document: in focus, out of focus, or back to the rules (null). */
  async setDocumentFocus(profileId: string, documentId: string, override: unknown) {
    const doc = await this.d.repo.getDocument(profileId, documentId);
    if (!doc) throw new NotFoundError("Документ не найден");
    if (override !== "in" && override !== "out" && override !== null) throw new ValidationError("Некорректная отметка фокуса");
    const updated: SourceDocument = { ...doc, focusOverride: override };
    await this.d.repo.saveDocument(updated);
    return updated;
  }

  async doctors(profileId: string) {
    const [docs, facts, encounters] = await Promise.all([this.d.repo.listDocuments(profileId), this.listFacts(profileId), this.d.repo.listEncounters(profileId)]);
    return buildDoctors(docs, facts, encounters, this.now().slice(0, 10));
  }

  /**
   * A question about documents the user selected. Without consent it is answered from their facts by the
   * template, locally; with consent their text and facts go to the connected model. Saved to the chat.
   */
  async askAboutDocuments(profileId: string, documentIds: string[], question: string, opts: { useModel?: boolean } = {}): Promise<ChatMessage[]> {
    await this.profile(profileId);
    const q = question.trim();
    if (!q) throw new ValidationError("Вопрос пустой");
    const ids = [...new Set(documentIds)].slice(0, 30);
    if (!ids.length) throw new ValidationError("Выберите хотя бы один документ");
    if (opts.useModel && !this.d.live) throw new ValidationError("Модель не подключена: укажите ключ API в .env.local.");
    const docs = (await Promise.all(ids.map((id) => this.d.repo.getDocument(profileId, id)))).filter((d): d is SourceDocument => !!d);
    if (!docs.length) throw new NotFoundError("Документы не найдены");
    const chosen = new Set(docs.map((d) => d.id));
    const facts = (await this.d.repo.listFacts(profileId)).filter((f) => f.verification !== "rejected" && f.sources.some((s) => chosen.has(s.documentId)));
    const texts = opts.useModel
      ? await Promise.all(
          docs.map(async (d) => {
            const v = (await this.d.repo.listVersions(profileId, d.id)).find((x) => x.method !== "prepared");
            const text = !v ? "" : v.segments.length ? v.segments.map((s) => `${s.speakerLabel ? `${s.speakerLabel}: ` : ""}${s.text}`).join("\n") : v.pages.join("\n");
            return { title: d.title, date: d.documentDate, text };
          }),
        )
      : docs.map((d) => ({ title: d.title, date: d.documentDate, text: "" }));
    const request = buildDocumentsRequest(q, facts, texts);
    let answer;
    try {
      answer = await (opts.useModel ? this.d.live!.chat : this.d.llm).answer(request);
    } catch (e) {
      throw new ExternalServiceError(e instanceof Error && e.message ? e.message : "Модель не ответила.");
    }
    const at = this.now();
    const titles = docs.map((d) => `«${d.title}»`).join(", ");
    const userMsg: ChatMessage = { id: this.d.ids.next("msg"), profileId, role: "user", text: `${q}\n(по документам: ${titles})`, segments: [], usedContext: [], mode: null, createdAt: at };
    const used = new Set(answer.usedFactIds);
    const assistant: ChatMessage = {
      id: this.d.ids.next("msg"),
      profileId,
      role: "assistant",
      text: answer.segments.map((s) => s.text).join("\n"),
      segments: request.truncated ? [...answer.segments, { kind: "caution", text: "Документы длинные: часть текста не поместилась и не была передана модели.", factIds: [], sources: [] }] : answer.segments,
      usedContext: facts.map((f) => ({ factId: f.id, label: f.label, reason: used.has(f.id) ? "Использовано в ответе" : "Из выбранного документа" })),
      mode: answer.mode,
      createdAt: at,
    };
    await this.d.repo.saveMessage(userMsg);
    await this.d.repo.saveMessage(assistant);
    return [userMsg, assistant];
  }

  async state(profileId: string) {
    return buildState(await this.listFacts(profileId), this.now().slice(0, 10));
  }

  async indicators(profileId: string) {
    return listIndicators(await this.listFacts(profileId));
  }

  async indicator(profileId: string, code: string, period: { from: string | null; to: string | null }) {
    const view = buildIndicatorView(await this.listFacts(profileId), code, period);
    if (!view) throw new NotFoundError("Показатель не найден");
    return view;
  }

  async timeline(profileId: string, groupBy: "date" | "problem" | "specialist") {
    await this.profile(profileId);
    const [facts, docs, encs] = await Promise.all([
      this.d.repo.listFacts(profileId),
      this.d.repo.listDocuments(profileId),
      this.d.repo.listEncounters(profileId),
    ]);
    return groupTimeline(buildTimeline(facts, docs, encs, this.now().slice(0, 10)), groupBy);
  }

  // ---------- Chat ----------

  async messages(profileId: string) {
    await this.profile(profileId);
    return this.d.repo.listMessages(profileId);
  }

  /** useModel: the user agreed to send the question and the selected facts to the connected model. */
  async ask(profileId: string, question: string, opts: { useModel?: boolean } = {}): Promise<ChatMessage[]> {
    await this.profile(profileId);
    const q = question.trim();
    if (!q) throw new ValidationError("Вопрос пустой");
    if (opts.useModel && !this.d.live) throw new ValidationError("Модель не подключена: укажите ключ API в .env.local.");
    // Only what is in focus is looked through and sent: a cold or a certificate does not crowd the context.
    const facts = factsInFocus(await this.d.repo.listFacts(profileId), await this.outOfFocus(profileId));
    const state = buildState(facts, this.now().slice(0, 10));
    const retrieval = retrieveFacts(q, facts);
    const request = buildLlmRequest(q, retrieval.facts.map((r) => r.fact), stateToText(state));
    let answer;
    try {
      answer = await (opts.useModel ? this.d.live!.chat : this.d.llm).answer(request);
    } catch (e) {
      throw new ExternalServiceError(e instanceof Error && e.message ? e.message : "Модель не ответила.");
    }
    const at = this.now();
    const userMsg: ChatMessage = { id: this.d.ids.next("msg"), profileId, role: "user", text: q, segments: [], usedContext: [], mode: null, createdAt: at };
    const reasons = new Map(retrieval.facts.map((r) => [r.fact.id, r.reason]));
    const used = [...new Set([...retrieval.facts.map((r) => r.fact.id), ...answer.usedFactIds])];
    const assistant: ChatMessage = {
      id: this.d.ids.next("msg"),
      profileId,
      role: "assistant",
      text: answer.segments.map((s) => s.text).join("\n"),
      segments: answer.segments,
      usedContext: used.map((id) => {
        const f = facts.find((x) => x.id === id)!;
        return { factId: id, label: f.label, reason: reasons.get(id) ?? "Использовано в ответе" };
      }),
      mode: answer.mode,
      createdAt: at,
    };
    await this.d.repo.saveMessage(userMsg);
    await this.d.repo.saveMessage(assistant);
    return [userMsg, assistant];
  }
}
