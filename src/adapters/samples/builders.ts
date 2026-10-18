import type {
  ContentVersion,
  DateValue,
  FactDraft,
  FactType,
  FactValue,
  ISODate,
  LabResultValue,
  MedicationStatus,
  ProposalGroup,
  ProposalItem,
  SourceRef,
  Validity,
} from "@/core/model";
import { normalizeIndicator } from "@/core/indicators";
import { parseLabValue, parseReference } from "@/core/rules/lab-values";

/** Context for building drafts from one document. */
export interface DraftCtx {
  documentId: string;
  documentDate: ISODate | null;
  specialist: string | null;
  versions: ContentVersion[];
  /** Prepared parse of a document we have not seen: quotes are paraphrases. */
  paraphrase: boolean;
}

export function ref(ctx: DraftCtx, quote: string, extra: Partial<SourceRef> = {}): SourceRef {
  const v = ctx.versions[0];
  return {
    documentId: ctx.documentId,
    versionId: v?.id ?? null,
    page: ctx.paraphrase ? null : 1,
    quote,
    quoteIsExact: !ctx.paraphrase,
    timecode: null,
    segmentId: null,
    speaker: null,
    sourceType: "personal",
    ...extra,
  };
}

/** Source pointing to a transcript segment that contains `needle`. Throws if absent, so prepared data cannot drift from the text. */
export function segRef(ctx: DraftCtx, needle: string): SourceRef {
  for (const v of ctx.versions) {
    const s = v.segments.find((x) => x.text.includes(needle));
    if (s) return ref(ctx, s.text, { versionId: v.id, page: null, segmentId: s.id, timecode: s.timecode, speaker: s.speaker });
  }
  throw new Error(`Segment not found: ${needle}`);
}

const validity = (status: Validity["status"], from: DateValue | null = null): Validity => ({ status, from, to: null, confirmedAt: null });

interface FactOpts {
  key: string;
  type: FactType;
  label: string;
  value: FactValue;
  sources: SourceRef[];
  eventDate: DateValue;
  validity?: Validity["status"];
  problem?: string | null;
  conflictsWith?: string[];
  aboutKeys?: string[];
}

export function draft(ctx: DraftCtx, o: FactOpts): FactDraft {
  return {
    type: o.type,
    label: o.label,
    value: o.value,
    originalText: o.sources[0].quote,
    sources: o.sources,
    eventDate: o.eventDate,
    documentDate: ctx.documentDate,
    validity: validity(o.validity ?? "unknown", o.type === "medication" ? o.eventDate : null),
    extraction: { method: "prepared", confidence: null },
    specialist: ctx.specialist,
    problem: o.problem ?? null,
    dedupKey: o.key,
    conflictsWith: o.conflictsWith,
    aboutKeys: o.aboutKeys,
  };
}

export function lab(
  rawName: string,
  rawValue: string,
  unit: string | null,
  reference: string | null,
  method: string | null,
  origin: LabResultValue["origin"],
): LabResultValue {
  return {
    kind: "lab_result",
    rawName,
    indicator: normalizeIndicator(rawName),
    value: parseLabValue(rawValue),
    unit,
    reference: parseReference(reference),
    method,
    origin,
    linkedResultId: null,
  };
}

export const med = (name: string | null, dose: string | null, status: MedicationStatus): FactValue => ({ kind: "medication", name, dose, status });
export const text = (t: string): FactValue => ({ kind: "text", text: t });
export const qual = (indicator: string | null, t: string): FactValue => ({ kind: "qualitative", indicator, text: t });
export const question = (q: string): FactValue => ({ kind: "clarification", question: q, aboutFactIds: [], resolution: "open", answer: null });

export function item(group: ProposalGroup, d: FactDraft, explanation: string, stateChange?: ProposalItem["stateChange"]): ProposalItem {
  return { key: d.dedupKey, group, draft: d, explanation, stateChange };
}

export function clarify(ctx: DraftCtx, key: string, q: string, aboutKeys: string[], quote: string, problem: string | null = null): ProposalItem {
  return item(
    "clarify",
    draft(ctx, { key, type: "clarification", label: q, value: question(q), sources: [ref(ctx, quote)], eventDate: { kind: "unknown" }, aboutKeys, problem }),
    "Нужно ваше уточнение; можно отложить.",
  );
}
