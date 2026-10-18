import type {
  DateValue,
  Fact,
  FactRevision,
  FactValue,
  MedicationStatus,
  SourceRef,
  Validity,
} from "../model";

type Snapshot = NonNullable<FactRevision["before"]>;

function snapshot(f: Fact): Snapshot {
  return structuredClone({
    label: f.label,
    value: f.value,
    validity: f.validity,
    verification: f.verification,
    eventDate: f.eventDate,
  });
}

function withRevision(
  f: Fact,
  next: Fact,
  action: FactRevision["action"],
  at: string,
  reason: string | null,
): Fact {
  const before = snapshot(f);
  const after = snapshot(next);
  return { ...next, revisions: [...f.revisions, { at, action, reason, before, after }] };
}

export interface FactCorrection {
  label?: string;
  value?: FactValue;
  eventDate?: DateValue;
}

/** A user correction. The previous values stay in the revision history. */
export function correctFact(f: Fact, patch: FactCorrection, at: string, reason: string | null): Fact {
  const next: Fact = {
    ...f,
    label: patch.label ?? f.label,
    value: patch.value ?? f.value,
    eventDate: patch.eventDate ?? f.eventDate,
    verification: "corrected",
  };
  return withRevision(f, next, "corrected", at, reason);
}

/** The user confirms the item is current now. */
export function confirmCurrent(f: Fact, at: string): Fact {
  const validity: Validity = { ...f.validity, status: "current", confirmedAt: at };
  return withRevision(f, { ...f, validity, verification: "confirmed" }, "confirmed_current", at, null);
}

/** The user marks that the item is not current (historical) without an end date. */
export function markHistorical(f: Fact, at: string): Fact {
  const validity: Validity = { ...f.validity, status: "historical", confirmedAt: at };
  return withRevision(f, { ...f, validity, verification: "confirmed" }, "status_changed", at, "Не актуально");
}

/** Ends the period of validity. For medications this means stopped. */
export function endFact(f: Fact, at: string, endDate: DateValue): Fact {
  let value = f.value;
  if (value.kind === "medication") value = { ...value, status: "stopped" };
  const validity: Validity = { ...f.validity, status: "ended", to: endDate, confirmedAt: at };
  return withRevision(f, { ...f, value, validity, verification: "confirmed" }, "ended", at, null);
}

const USER_CONFIRMED: MedicationStatus[] = ["started_confirmed", "taking_now", "stopped"];

/**
 * Changes medication status. Only explicit user actions reach this function;
 * extraction can never produce started_confirmed or taking_now.
 */
export function setMedicationStatus(f: Fact, status: MedicationStatus, at: string, startDate: DateValue | null = null): Fact {
  if (f.value.kind !== "medication") throw new Error("Not a medication fact");
  const value = { ...f.value, status };
  let validity = f.validity;
  if (status === "taking_now" || status === "started_confirmed") {
    validity = { ...validity, status: "current", confirmedAt: at, from: startDate ?? validity.from };
  } else if (status === "stopped") {
    validity = { ...validity, status: "ended", confirmedAt: at };
  }
  return withRevision(
    f,
    { ...f, value, validity, verification: USER_CONFIRMED.includes(status) ? "confirmed" : f.verification },
    "status_changed",
    at,
    null,
  );
}

/** Adds a supporting quote instead of creating a duplicate fact. */
export function addSource(f: Fact, src: SourceRef, at: string): Fact {
  const exists = f.sources.some(
    (s) => s.documentId === src.documentId && s.quote === src.quote && s.timecode === src.timecode,
  );
  if (exists) return f;
  return withRevision(f, { ...f, sources: [...f.sources, src] }, "source_added", at, null);
}

export function resolveClarification(f: Fact, answer: string, at: string): Fact {
  if (f.value.kind !== "clarification") throw new Error("Not a clarification");
  return withRevision(
    f,
    { ...f, value: { ...f.value, resolution: "resolved", answer } },
    "resolved",
    at,
    null,
  );
}

export function isConfirmedTaking(f: Fact): boolean {
  return (
    f.type === "medication" &&
    f.value.kind === "medication" &&
    (f.value.status === "taking_now" || f.value.status === "started_confirmed") &&
    f.validity.status !== "ended"
  );
}

export const MEDICATION_STATUS_LABEL: Record<MedicationStatus, string> = {
  prescribed: "Назначен врачом, приём не подтверждён",
  mentioned_taking: "Приём упомянут в документе, не подтверждён вами",
  option_discussed: "Обсуждался как возможный вариант, не назначен",
  started_confirmed: "Вы подтвердили начало приёма",
  taking_now: "Принимаете сейчас (подтверждено вами)",
  stopped: "Приём завершён или прекращён",
  unknown: "Факт приёма неизвестен",
};
