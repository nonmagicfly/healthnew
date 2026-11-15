import type { Fact } from "../model";
import { indicatorOf, INDICATORS, qualitativeIndicatorOf } from "../indicators";
import { resultFlag } from "./lab-values";

export type Topic = "medication" | "indicator" | "complaint" | "allergy" | "visits" | "abnormal";

export interface Retrieval {
  topics: Topic[];
  indicators: string[];
  facts: { fact: Fact; reason: string }[];
}

const TOPIC_WORDS: Record<Exclude<Topic, "indicator">, RegExp> = {
  abnormal: /(отклон|вне норм|не в норм|выше норм|ниже норм|вне референс|повышен|понижен|превыш)/i,
  medication: /(препарат|лекарств|назнач|принима|принять|таблет|статин|доз)/i,
  complaint: /(жалоб|симптом|беспоко|вздут|живот|газообраз|тяжест|дискомфорт|болит|боль)/i,
  allergy: /аллерг/i,
  visits: /(врач|визит|консультац|обследован|явк|приём|прием|истори)/i,
};

const stem = (w: string) => w.toLowerCase().replace(/[^а-яёa-z0-9]/gi, "").slice(0, 5);

/** Local keyword search over the profile's facts. Runs entirely in-process. */
export function retrieveFacts(question: string, allFacts: Fact[]): Retrieval {
  const facts = allFacts.filter((f) => f.verification !== "rejected");
  const q = question.toLowerCase();
  const topics = (Object.keys(TOPIC_WORDS) as (keyof typeof TOPIC_WORDS)[]).filter((t) => TOPIC_WORDS[t].test(q)) as Topic[];

  const indicators = INDICATORS.filter((i) => i.aliases.some((a) => q.includes(a)) || q.includes(i.name.toLowerCase())).map((i) => i.code);
  if (/(печен|печён)/i.test(q)) indicators.push("alt", "ast", "ggt", "bili");
  if (/(липид|холестер)/i.test(q)) indicators.push("ldl", "hdl", "chol", "tg");
  if (/желез/i.test(q)) indicators.push("ferritin", "iron", "transferrin", "tsat", "tibc");
  // Lab names outside the catalog (and catalog names written differently) match by the first word of the lab's own name.
  for (const f of facts) {
    if (f.value.kind !== "lab_result") continue;
    const word = stem(f.value.rawName.split(/[\s(,]/)[0] ?? "");
    if (word.length >= 3 && q.split(/\s+/).some((w) => stem(w) === word)) indicators.push(indicatorOf(f.value));
  }
  if (indicators.length) topics.push("indicator");

  const medNames = facts
    .filter((f) => f.value.kind === "medication" && f.value.name)
    .filter((f) => f.value.kind === "medication" && q.includes(stem(f.value.name!)));
  if (medNames.length && !topics.includes("medication")) topics.push("medication");

  const picked = new Map<string, { fact: Fact; reason: string }>();
  const add = (f: Fact, reason: string) => {
    if (!picked.has(f.id)) picked.set(f.id, { fact: f, reason });
  };

  for (const f of facts) {
    if (topics.includes("medication") && f.type === "medication") add(f, "Вопрос о препаратах");
    if (topics.includes("complaint") && (f.type === "complaint" || f.type === "note")) add(f, "Вопрос о жалобах");
    if (topics.includes("allergy") && f.type === "allergy") add(f, "Вопрос об аллергиях");
    if (topics.includes("abnormal") && outOfReference(f)) add(f, "Значение вне референса лаборатории");
    if (topics.includes("visits") && (f.type === "appointment" || f.type === "examination" || f.type === "diagnosis" || f.type === "condition"))
      add(f, "Вопрос о визитах и обследованиях");
    const ind = f.value.kind === "lab_result" ? indicatorOf(f.value) : f.value.kind === "qualitative" ? qualitativeIndicatorOf(f.value.indicator) : null;
    if (ind && indicators.includes(ind)) add(f, "Относится к показателю из вопроса");
    if (indicators.includes("ferritin") && f.type === "procedure") add(f, "Лечение, отмеченное рядом с показателем");
    if (topics.includes("indicator") && f.type === "medication" && /статин/i.test(f.label) && indicators.some((i) => ["ldl", "chol", "alt"].includes(i)))
      add(f, "Препарат, упомянутый вместе с показателем");
  }

  // Fallback: word overlap with fact labels.
  if (!picked.size) {
    const words = q.split(/\s+/).map(stem).filter((w) => w.length >= 4);
    for (const f of facts) {
      const label = f.label.toLowerCase();
      if (words.some((w) => label.includes(w))) add(f, "Совпадение слов с вопросом");
    }
  }

  // Open clarifications on picked facts are always relevant context.
  for (const f of facts) {
    if (f.value.kind === "clarification" && f.value.resolution !== "resolved" && f.value.aboutFactIds.some((id) => picked.has(id)))
      add(f, "Открытый вопрос по найденным сведениям");
  }

  return { topics, indicators: [...new Set(indicators)], facts: [...picked.values()] };
}

/** A lab-form result outside the lab's own reference range. */
export function outOfReference(f: Fact): "high" | "low" | null {
  if (f.value.kind !== "lab_result" || f.value.origin !== "lab_report") return null;
  const flag = resultFlag(f);
  return flag === "high" || flag === "low" ? flag : null;
}
