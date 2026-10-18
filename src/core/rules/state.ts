import type { Fact } from "../model";
import { formatDateValue } from "./dates";
import { isConfirmedTaking, MEDICATION_STATUS_LABEL } from "./facts";

export interface StateItem {
  factId: string;
  label: string;
  detail: string | null;
  date: string;
  currentness: string;
  documentIds: string[];
}

export interface HealthState {
  currentComplaints: StateItem[];
  documentComplaints: StateItem[];
  conditions: StateItem[];
  takingMedications: StateItem[];
  otherMedications: StateItem[];
  allergies: StateItem[];
  allergiesUnknown: boolean;
  openQuestions: StateItem[];
  factCount: number;
}

const CURRENTNESS_LABEL: Record<Fact["validity"]["status"], string> = {
  current: "Актуально (подтверждено вами)",
  unconfirmed: "Из документа, актуальность не подтверждена",
  historical: "Не актуально",
  ended: "Период завершён",
  unknown: "Актуальность неизвестна",
};

function item(f: Fact, detail: string | null = null): StateItem {
  const confirmed = f.validity.confirmedAt ? `, подтверждено ${f.validity.confirmedAt.slice(0, 10).split("-").reverse().join(".")}` : "";
  return {
    factId: f.id,
    label: f.label,
    detail,
    date: f.type === "clarification" ? `вопрос по документу от ${f.documentDate ? f.documentDate.split("-").reverse().join(".") : "неизвестной даты"}` : formatDateValue(f.eventDate),
    currentness: CURRENTNESS_LABEL[f.validity.status] + (f.validity.status === "current" ? confirmed : ""),
    documentIds: [...new Set(f.sources.map((s) => s.documentId))],
  };
}

/** Builds the current state from facts. Nothing here is stored; it is recomputed on every read. */
export function buildState(allFacts: Fact[]): HealthState {
  const facts = allFacts.filter((f) => f.verification !== "rejected");
  const state: HealthState = {
    currentComplaints: [],
    documentComplaints: [],
    conditions: [],
    takingMedications: [],
    otherMedications: [],
    allergies: [],
    allergiesUnknown: true,
    openQuestions: [],
    factCount: facts.length,
  };

  for (const f of facts) {
    switch (f.type) {
      case "complaint":
        if (f.validity.status === "current") state.currentComplaints.push(item(f));
        else if (f.validity.status === "unconfirmed" || f.validity.status === "unknown")
          state.documentComplaints.push(item(f));
        break;
      case "condition":
      case "diagnosis":
        if (f.validity.status !== "ended") state.conditions.push(item(f, "Формулировка врача"));
        break;
      case "medication":
        if (f.value.kind !== "medication") break;
        if (isConfirmedTaking(f)) state.takingMedications.push(item(f, MEDICATION_STATUS_LABEL[f.value.status]));
        else if (f.value.status !== "stopped" && f.validity.status !== "ended")
          state.otherMedications.push(item(f, MEDICATION_STATUS_LABEL[f.value.status]));
        break;
      case "allergy":
        state.allergies.push(item(f));
        state.allergiesUnknown = false;
        break;
      case "clarification":
        if (f.value.kind === "clarification" && f.value.resolution !== "resolved")
          state.openQuestions.push(item(f, f.value.resolution === "postponed" ? "Отложено" : "Требует уточнения"));
        break;
      case "appointment":
        if (f.value.kind === "appointment" && f.value.attended === "unknown")
          state.openQuestions.push(item(f, "Посещение не подтверждено"));
        break;
      case "examination":
        if (f.validity.status === "current") state.openQuestions.push(item(f, "Обследование не завершено"));
        break;
    }
  }
  return state;
}

/** Plain-text state for the LLM request and the chat context panel. */
export function stateToText(s: HealthState): string {
  const lines: string[] = [];
  const list = (title: string, items: StateItem[], empty: string) => {
    lines.push(`${title}:`);
    if (!items.length) lines.push(`  - ${empty}`);
    for (const i of items) lines.push(`  - ${i.label}${i.detail ? ` (${i.detail})` : ""}; ${i.date}; ${i.currentness}`);
  };
  list("Актуальные жалобы", s.currentComplaints, "нет подтверждённых");
  list("Жалобы из документов без подтверждения актуальности", s.documentComplaints, "нет");
  list("Заболевания и проблемы (формулировки врачей)", s.conditions, "в документах не зафиксированы");
  list("Подтверждённые принимаемые препараты", s.takingMedications, "нет подтверждённых");
  list("Назначения и упоминания без подтверждённого приёма", s.otherMedications, "нет");
  if (s.allergiesUnknown) lines.push("Аллергии: сведений нет (это не означает отсутствие аллергий)");
  else list("Аллергии", s.allergies, "нет");
  list("Незавершённые вопросы", s.openQuestions, "нет");
  return lines.join("\n");
}
