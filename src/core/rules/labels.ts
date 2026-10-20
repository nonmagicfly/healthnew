// Document labels (type, section, specialist, clinic) derived from what parsing already found,
// and the virtual folder tree of the «Документы» page. Files on disk are never moved.
import type { DocumentKind, SourceDocument } from "../model";
import { indicatorByCode, normalizeIndicator } from "../indicators";

export interface LabelSource {
  encounter: { kind: "visit" | "lab" | "examination"; title: string; specialist: string | null; institution?: string | null } | null;
  /** Names of lab results the parse found ("Ферритин", "АЛТ"). */
  labNames: string[];
  title: string;
}

export interface DerivedLabels {
  kind: DocumentKind | null;
  area: string | null;
  specialist: string | null;
  institution: string | null;
}

const LAB_SECTION: Record<string, string> = {
  "Общий анализ крови": "Общий анализ крови",
  "Гормоны и витамины": "Гормоны и витамины",
  "Биохимия": "Биохимия",
  "Печёночные показатели": "Биохимия",
  "Липидный профиль": "Биохимия",
  "Обмен железа": "Биохимия",
  "Воспаление": "Биохимия",
};

const EXAMINATIONS: [RegExp, string][] = [
  [/узи|ультразвук|доплер|допплер|эхокг|эхокардио/i, "УЗИ"],
  [/экг|электрокардио|холтер/i, "ЭКГ"],
  [/мрт|магнитно/i, "МРТ"],
  [/(^|[^а-я])кт([^а-я]|$)|компьютерн.. томогр/i, "КТ"],
  [/рентген|флюорогр/i, "Рентген"],
  [/фгдс|эгдс|гастроскоп|колоноскоп|эндоскоп/i, "Эндоскопия"],
];

const SPECIALTY: Record<string, string> = { терапевт: "Терапия", педиатр: "Педиатрия", хирург: "Хирургия", "лор": "Оториноларингология" };

/** «кардиолог» → «Кардиология», «терапевт» → «Терапия». */
export function specialtyOf(specialist: string | null): string | null {
  const word = specialist?.trim().toLowerCase().split(/[\s,(]+/)[0] ?? "";
  if (!word) return null;
  if (SPECIALTY[word]) return SPECIALTY[word];
  if (word.endsWith("лог")) return cap(word.slice(0, -3) + "логия");
  return null;
}

/** The lab section most of the document's results belong to. */
export function labSectionOf(names: string[], title: string): string | null {
  if (/моч/i.test(title)) return "Анализ мочи";
  const counts = new Map<string, number>();
  for (const n of names) {
    const group = indicatorByCode(normalizeIndicator(n))?.group;
    const section = group ? LAB_SECTION[group] : undefined;
    if (section) counts.set(section, (counts.get(section) ?? 0) + 1);
  }
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (best) return best[0];
  if (/общ(ий|его) анализ крови|оак|гемограм/i.test(title)) return "Общий анализ крови";
  return names.length ? "Прочие анализы" : null;
}

export function examinationOf(text: string): string | null {
  return EXAMINATIONS.find(([re]) => re.test(text))?.[1] ?? null;
}

export function deriveLabels(src: LabelSource): DerivedLabels {
  const enc = src.encounter;
  const text = [src.title, enc?.title ?? ""].join(" ");
  const isLab = enc?.kind === "lab" || (!enc && src.labNames.length > 0);
  const kind: DocumentKind | null = isLab ? "lab_report" : enc?.kind === "examination" ? "examination" : enc?.kind === "visit" ? "consultation" : null;
  const specialist = enc?.specialist?.trim() || null;
  const area = isLab ? labSectionOf(src.labNames, text) : enc?.kind === "examination" ? examinationOf(text) ?? specialtyOf(specialist) : specialtyOf(specialist);
  return { kind, area, specialist, institution: enc?.institution?.trim() || null };
}

/** Fills only empty labels; what the user entered or edited is never replaced. */
/** fromForm: the labels come from a recognized form layout, which a conversation transcript never has. */
export function applyLabels(doc: SourceDocument, labels: DerivedLabels, fromForm = false): SourceDocument {
  if (doc.labelsEditedAt) return doc;
  const next = { ...doc };
  // A plain-text file is taken for a transcript at upload; a lab form or a consultation form found in it says otherwise.
  if (labels.kind && (doc.kind === "other" || (doc.kind === "transcript" && (labels.kind === "lab_report" || fromForm)))) next.kind = labels.kind;
  // A transcript keeps its kind; its section and doctor still come from the visit it records.
  if (!doc.area && labels.area && (next.kind === labels.kind || doc.kind === "transcript")) next.area = labels.area;
  if (!doc.specialist && labels.specialist) next.specialist = labels.specialist;
  if (!doc.institution && labels.institution) next.institution = labels.institution;
  const changed = next.kind !== doc.kind || next.area !== doc.area || next.specialist !== doc.specialist || (next.institution ?? null) !== (doc.institution ?? null);
  return changed ? next : doc;
}

// ---------- Virtual folders ----------

export type FolderMode = "type" | "year" | "clinic";

export interface Folder {
  key: string;
  label: string;
  count: number;
  children: { key: string; label: string; count: number }[];
}

const TOP: Record<DocumentKind, string> = {
  lab_report: "Анализы",
  consultation: "Врачи",
  examination: "Обследования",
  transcript: "Расшифровки",
  note: "Заметки и прочее",
  other: "Заметки и прочее",
};
const TOP_ORDER = ["Анализы", "Врачи", "Обследования", "Расшифровки", "Заметки и прочее"];

/** Folder and subfolder of a document in the given mode. */
export function folderOf(doc: SourceDocument, mode: FolderMode): [string, string] {
  if (mode === "year") return [doc.documentDate?.slice(0, 4) ?? "Без даты", TOP[doc.kind]];
  if (mode === "clinic") return [doc.institution?.trim() || "Клиника не указана", TOP[doc.kind]];
  const top = TOP[doc.kind];
  if (doc.kind === "lab_report") return [top, doc.area?.trim() || "Без раздела"];
  if (doc.kind === "examination") return [top, doc.area?.trim() || "Другие обследования"];
  if (doc.kind === "consultation" || doc.kind === "transcript") return [top, cap(doc.specialist?.trim() || "") || "Врач не указан"];
  return [top, doc.kind === "note" ? "Заметки" : "Другое"];
}

export function buildFolders(docs: SourceDocument[], mode: FolderMode): Folder[] {
  const tops = new Map<string, Map<string, number>>();
  for (const d of docs) {
    const [top, sub] = folderOf(d, mode);
    const subs = tops.get(top) ?? new Map<string, number>();
    subs.set(sub, (subs.get(sub) ?? 0) + 1);
    tops.set(top, subs);
  }
  const rank = (label: string) => {
    if (mode === "type") return TOP_ORDER.indexOf(label);
    return label.startsWith("Без") || label.endsWith("не указана") ? Infinity : 0;
  };
  const tieBreak = (a: string, b: string) => (mode === "year" ? b.localeCompare(a) : a.localeCompare(b, "ru"));
  return [...tops]
    .map(([label, subs]) => ({
      key: label,
      label,
      count: [...subs.values()].reduce((s, n) => s + n, 0),
      children: [...subs]
        .sort((a, b) => (mode === "type" ? Number(isFallback(a[0])) - Number(isFallback(b[0])) : TOP_ORDER.indexOf(a[0]) - TOP_ORDER.indexOf(b[0])) || a[0].localeCompare(b[0], "ru"))
        .map(([sub, count]) => ({ key: `${label}/${sub}`, label: sub, count })),
    }))
    .sort((a, b) => rank(a.label) - rank(b.label) || tieBreak(a.label, b.label));
}

function isFallback(label: string) {
  return /^(Без |Врач не указан|Другие |Другое|Прочие)/.test(label);
}

function cap(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
