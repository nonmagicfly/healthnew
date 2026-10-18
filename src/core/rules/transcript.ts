import type { Speaker, TranscriptSegment } from "../model";

const DOCTOR = /^(врач|доктор|гастроэнтеролог|терапевт|кардиолог|гематолог|эндокринолог)$/i;
const PATIENT = /^(пациент|пациентка|я)$/i;
const LINE = /^\s*(?:\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*)?(?:([А-ЯЁA-Z][^:\n]{0,30}?):\s+)?(.*)$/u;

export function speakerFromLabel(label: string | null): Speaker {
  if (!label) return "unclear";
  const l = label.trim();
  if (DOCTOR.test(l)) return "doctor";
  if (PATIENT.test(l)) return "patient";
  return "unclear";
}

/**
 * Splits a plain-text transcript into segments. A line without a recognizable
 * speaker label is kept with speaker "unclear"; nothing is guessed.
 */
export function parseTranscript(text: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
    const m = rawLine.match(LINE);
    if (!m) continue;
    const [, timecode, label, body] = m;
    const knownLabel = label && (DOCTOR.test(label.trim()) || PATIENT.test(label.trim()) || /^(говорящий|спикер)\s*\d*$/i.test(label.trim()));
    const speakerLabel = knownLabel ? label!.trim() : null;
    const textPart = knownLabel ? body : (label ? `${label}: ${body}` : body);
    segments.push({
      id: `s${segments.length + 1}`,
      speaker: speakerFromLabel(speakerLabel),
      speakerLabel,
      timecode: timecode ?? null,
      text: textPart.trim(),
    });
  }
  return segments;
}

export const SPEAKER_LABEL: Record<Speaker, string> = {
  doctor: "Врач",
  patient: "Пациент",
  unclear: "Говорящий неясен",
};
