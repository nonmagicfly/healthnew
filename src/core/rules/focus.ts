// Focus areas: what matters for this person (a man over 44 by default) and its course over time.
// A document is matched to areas by rules only: the doctor's specialty, the examination, ICD codes of
// diagnoses, lab indicators and specific words. Nothing is deleted: a document with no match is only
// marked «вне фокуса», hidden by default and left out of what is sent to a model.
import type { Fact, FocusSettings, SourceDocument } from "../model";
import { indicatorByCode, indicatorOf } from "../indicators";
import { buildIndicatorView } from "./series";
import { specialtyKey } from "./doctors";

export interface FocusAreaDef {
  id: string;
  title: string;
  description: string;
  /** Specialties as specialtyKey writes them, lowercased: «кардиолог». */
  specialties: string[];
  indicators: string[];
  /** ICD-10 code prefixes of diagnoses: «I», «N40». */
  icd: string[];
  /** Matched in the title and labels only: broad words a routine note may mention in passing. */
  titleWords: RegExp | null;
  /** Matched anywhere in the text: specific enough not to appear in a routine note. */
  textWords: RegExp | null;
  custom: boolean;
}

export const DEFAULT_FOCUS_AREAS: FocusAreaDef[] = [
  {
    id: "cardio",
    title: "Сердце и сосуды",
    description: "Кардиолог, ЭКГ, ЭхоКГ, холтер, СМАД, липиды",
    specialties: ["кардиолог", "аритмолог", "кардиохирург", "ангиохирург", "сосудистый"],
    indicators: ["chol", "ldl", "hdl", "tg"],
    icd: ["I", "E78"],
    titleWords: /экг|эхо|холтер|смад|кардио|сердц|сосуд|липид|дуплекс|брахиоцефал/i,
    textWords: /(^|[^а-яё])(экг|эхокг|эхо-кг)([^а-яё]|$)|эхокардиограф|холтер|смад|гипертони|ишемическ|аритми|фибрилляци|экстрасистол|стенокард|атеросклер|дислипидеми|гиперхолестерин/i,
    custom: false,
  },
  {
    id: "uro",
    title: "Урология и простата",
    description: "Уролог, ТРУЗИ, ПСА, тестостерон",
    specialties: ["уролог", "андролог"],
    indicators: ["psa", "psa_free", "testosterone"],
    icd: ["N40", "N41", "N42", "N20", "N13", "N30", "N34", "N52", "C61"],
    titleWords: /трузи|простат|уролог|узи почек|мочев(ого|ой) пузыр|пса/i,
    textWords: /трузи|простат|(^|[^а-яё])пса([^а-яё]|$)|аденом|мочекаменн|нефролитиаз|уретрит|цистит|эректил/i,
    custom: false,
  },
  {
    id: "gastro",
    title: "ЖКТ и печень",
    description: "Гастроэнтеролог, УЗИ брюшной полости, ФГДС, колоноскопия, печёночные показатели",
    specialties: ["гастроэнтеролог", "гепатолог", "колопроктолог", "проктолог", "эндоскопист"],
    indicators: ["alt", "ast", "ggt", "bili", "bili_direct", "alp", "amylase"],
    icd: ["K", "B18", "C16", "C18", "C20"],
    titleWords: /брюшн|колоноскоп|фгдс|эгдс|гастроскоп|гастро|печен|желч|кишечн|эндоскоп|helicobacter|хеликобакт/i,
    textWords: /колоноскоп|фгдс|эгдс|гастроскоп|гастрит|рефлюкс|гэрб|холецистит|желчнокаменн|панкреатит|гепатоз|стеатоз|хеликобакт|helicobacter|дивертикул|раздражённого кишечника|раздраженного кишечника|сибр/i,
    custom: false,
  },
  {
    id: "iron",
    title: "Обмен железа",
    description: "Ферритин, железо, трансферрин, гемоглобин",
    specialties: ["гематолог"],
    indicators: ["ferritin", "iron", "transferrin", "tsat", "tibc", "hgb"],
    icd: ["D50", "D51", "D52", "D53", "D64", "E83.1"],
    titleWords: /феррит|желез|анеми/i,
    textWords: /ферритин|железодефицит|анеми|гемохроматоз/i,
    custom: false,
  },
  {
    id: "metabolic",
    title: "Обмен веществ 44+",
    description: "Глюкоза, HbA1c, почки, витамин D, ТТГ, мочевая кислота",
    specialties: ["эндокринолог", "нефролог"],
    indicators: ["glucose", "hba1c", "creatinine", "urea", "uric", "vitd", "tsh", "ft4", "b12"],
    icd: ["E0", "E1", "E21", "E55", "E66", "M10", "N18"],
    titleWords: /глюкоз|гликир|диабет|щитовид|ттг|витамин d|эндокрин/i,
    textWords: /сахарн(ый|ого) диабет|преддиабет|инсулинорезист|гипотиреоз|гипертиреоз|тиреоидит|ожирени|подагр|гиперурикеми|хроническ(ая|ой) болезн(ь|и) почек/i,
    custom: false,
  },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Built-in areas that are on, then the user's own ones. */
export function focusAreas(settings: FocusSettings | undefined): FocusAreaDef[] {
  const off = new Set(settings?.disabled ?? []);
  const custom = (settings?.custom ?? [])
    .filter((c) => c.title.trim() && c.keywords.some((k) => k.trim()))
    .map((c): FocusAreaDef => {
      const words = new RegExp(c.keywords.map((k) => escape(k.trim().toLowerCase())).filter(Boolean).join("|"), "i");
      return { id: c.id, title: c.title.trim(), description: c.keywords.join(", "), specialties: [], indicators: [], icd: [], titleWords: words, textWords: words, custom: true };
    });
  return [...DEFAULT_FOCUS_AREAS.filter((a) => !off.has(a.id)), ...custom];
}

export type FocusStatus = "in" | "out" | "unknown";

export interface DocumentFocus {
  areas: string[];
  status: FocusStatus;
  /** True when the user decided it, not the rules. */
  manual: boolean;
}

/** Areas of one document from what is already known about it. text: its recognized text, if any. */
export function documentFocus(doc: SourceDocument, facts: Fact[], text: string, areas: FocusAreaDef[]): DocumentFocus {
  const own = facts.filter((f) => f.verification !== "rejected" && f.sources.some((s) => s.documentId === doc.id));
  const specialty = doc.specialist ? specialtyKey(doc.specialist).toLowerCase() : null;
  const labels = [doc.title, doc.area ?? "", doc.specialist ?? ""].join(" ");
  const codes = new Set(own.flatMap((f) => (f.value.kind === "lab_result" ? [indicatorOf(f.value)] : [])));
  const icd = own
    .filter((f) => f.type === "diagnosis" || f.type === "condition")
    .flatMap((f) => [...f.label.matchAll(/\b([A-Z]\d{2}(?:\.\d{1,2})?)\b/g)].map((m) => m[1]));
  const matched = areas
    .filter(
      (a) =>
        (specialty !== null && a.specialties.some((s) => specialty.startsWith(s))) ||
        a.indicators.some((c) => codes.has(c)) ||
        icd.some((c) => a.icd.some((p) => c.startsWith(p))) ||
        (a.titleWords?.test(labels) ?? false) ||
        (a.textWords?.test(text) ?? false),
    )
    .map((a) => a.id);
  if (doc.focusOverride === "in") return { areas: matched, status: "in", manual: true };
  if (doc.focusOverride === "out") return { areas: matched, status: "out", manual: true };
  // Nothing read from it yet (a scan, a recording being transcribed): not hidden until there is something to judge by.
  if (!matched.length && !own.length && !text.trim()) return { areas: [], status: "unknown", manual: false };
  return { areas: matched, status: matched.length ? "in" : "out", manual: false };
}

/** Facts that may go to a model: from documents in focus, plus allergies and what the user entered. */
export function factsInFocus(facts: Fact[], outOfFocus: Set<string>): Fact[] {
  return facts.filter(
    (f) => f.type === "allergy" || f.extraction.method === "manual" || !f.sources.length || f.sources.some((s) => !outOfFocus.has(s.documentId)),
  );
}

export interface FocusMetric {
  code: string;
  name: string;
  unit: string | null;
  last: { value: number; raw: string; date: string; flag: "high" | "low" | null; documentId: string };
  previous: { value: number; raw: string; date: string } | null;
  trend: "up" | "down" | "same" | null;
  count: number;
}

export interface FocusConclusion {
  documentId: string;
  title: string;
  date: string | null;
  specialist: string | null;
  lines: { factId: string; type: Fact["type"]; label: string }[];
}

export interface FocusCard {
  id: string;
  title: string;
  description: string;
  custom: boolean;
  documents: number;
  conclusion: FocusConclusion | null;
  metrics: FocusMetric[];
  nextCheck: { date: string; label: string; factId: string } | null;
}

const CONCLUSION_TYPES: Fact["type"][] = ["diagnosis", "condition", "examination", "procedure", "qualitative_finding", "medication"];

export function buildFocusCards(
  documents: SourceDocument[],
  focus: Map<string, DocumentFocus>,
  facts: Fact[],
  areas: FocusAreaDef[],
  today: string,
): FocusCard[] {
  const live = facts.filter((f) => f.verification !== "rejected");
  return areas.map((a) => {
    const docs = documents.filter((d) => focus.get(d.id)?.status !== "out" && focus.get(d.id)?.areas.includes(a.id));
    const ids = new Set(docs.map((d) => d.id));
    const fromArea = (f: Fact) => f.sources.some((s) => ids.has(s.documentId));

    // The latest specialist's word: a consultation, an examination or a recorded visit, newest first.
    const visits = docs
      .filter((d) => d.kind === "consultation" || d.kind === "examination" || d.kind === "transcript")
      .sort((x, y) => (y.documentDate ?? "").localeCompare(x.documentDate ?? ""));
    let conclusion: FocusConclusion | null = null;
    for (const d of visits) {
      const lines = live
        .filter((f) => f.sources.some((s) => s.documentId === d.id) && CONCLUSION_TYPES.includes(f.type))
        .filter((f) => f.value.kind !== "medication" || f.value.status === "prescribed" || f.value.status === "option_discussed")
        .map((f) => ({ factId: f.id, type: f.type, label: f.label }));
      if (!lines.length) continue;
      conclusion = { documentId: d.id, title: d.title, date: d.documentDate, specialist: d.specialist, lines: lines.slice(0, 6) };
      break;
    }

    const areaFacts = live.filter(fromArea);
    const metrics: FocusMetric[] = [];
    for (const code of a.indicators) {
      const view = buildIndicatorView(areaFacts, code);
      const series = view?.series.slice().sort((x, y) => y.points.length - x.points.length)[0];
      if (!view || !series?.points.length) continue;
      const [last, prev] = series.points.slice(-2).reverse();
      metrics.push({
        code,
        name: indicatorByCode(code)!.name,
        unit: series.unit,
        last: { value: last.value, raw: last.raw, date: last.date, flag: last.flag === "high" || last.flag === "low" ? last.flag : null, documentId: last.documentId },
        previous: prev ? { value: prev.value, raw: prev.raw, date: prev.date } : null,
        trend: prev ? (last.value > prev.value ? "up" : last.value < prev.value ? "down" : "same") : null,
        count: series.points.length,
      });
    }

    // Only a date a document names; intervals are never made up.
    const next = areaFacts
      .filter((f) => f.type === "appointment" && f.eventDate.kind === "exact" && f.eventDate.date >= today)
      .map((f) => ({ date: f.eventDate.kind === "exact" ? f.eventDate.date : "", label: f.label, factId: f.id }))
      .sort((x, y) => x.date.localeCompare(y.date))[0] ?? null;

    return { id: a.id, title: a.title, description: a.description, custom: a.custom, documents: docs.length, conclusion, metrics, nextCheck: next };
  });
}
