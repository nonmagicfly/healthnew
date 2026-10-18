// Catalog of normalized lab indicators. Priority groups: ferritin, lipids, liver.

export interface IndicatorDef {
  code: string;
  name: string;
  group: "Обмен железа" | "Липидный профиль" | "Печёночные показатели" | "Общий анализ крови" | "Прочее";
  priority: boolean;
  aliases: string[];
}

export const INDICATORS: IndicatorDef[] = [
  { code: "ferritin", name: "Ферритин", group: "Обмен железа", priority: true, aliases: ["ферритин"] },
  { code: "ldl", name: "ЛПНП", group: "Липидный профиль", priority: true, aliases: ["лпнп", "хс-лпнп", "холестерин лпнп", "ldl"] },
  { code: "hdl", name: "ЛПВП", group: "Липидный профиль", priority: true, aliases: ["лпвп", "хс-лпвп", "холестерин лпвп", "hdl"] },
  { code: "chol", name: "Общий холестерин", group: "Липидный профиль", priority: true, aliases: ["общий холестерин", "холестерин общий"] },
  { code: "tg", name: "Триглицериды", group: "Липидный профиль", priority: true, aliases: ["триглицериды"] },
  { code: "alt", name: "АЛТ", group: "Печёночные показатели", priority: true, aliases: ["алт", "аланинаминотрансфераза", "alt"] },
  { code: "ast", name: "АСТ", group: "Печёночные показатели", priority: true, aliases: ["аст", "аспартатаминотрансфераза", "ast"] },
  { code: "ggt", name: "ГГТ", group: "Печёночные показатели", priority: true, aliases: ["ггт", "гамма-гт"] },
  { code: "bili", name: "Билирубин общий", group: "Печёночные показатели", priority: true, aliases: ["билирубин общий", "билирубин"] },
  { code: "esr", name: "СОЭ", group: "Общий анализ крови", priority: false, aliases: ["соэ", "скорость оседания эритроцитов"] },
  { code: "hbsag", name: "HBsAg", group: "Прочее", priority: false, aliases: ["hbsag"] },
];

export function indicatorByCode(code: string | null): IndicatorDef | null {
  return INDICATORS.find((i) => i.code === code) ?? null;
}

/** Maps a raw lab name to an indicator code, or null when unknown (the raw name is kept either way). */
export function normalizeIndicator(rawName: string): string | null {
  const s = rawName.toLowerCase().replace(/\(.*?\)/g, "").trim();
  for (const i of INDICATORS) {
    if (i.aliases.some((a) => s === a || s.startsWith(a + " ") || s.startsWith(a + ","))) return i.code;
  }
  return null;
}
