// Catalog of normalized lab indicators. Priority groups: ferritin, lipids, liver.

export interface IndicatorDef {
  code: string;
  name: string;
  group: "Обмен железа" | "Липидный профиль" | "Печёночные показатели" | "Общий анализ крови" | "Биохимия" | "Гормоны и витамины" | "Воспаление" | "Прочее";
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
  { code: "iron", name: "Железо сывороточное", group: "Обмен железа", priority: false, aliases: ["железо сывороточное", "сывороточное железо", "железо", "fe"] },
  { code: "transferrin", name: "Трансферрин", group: "Обмен железа", priority: false, aliases: ["трансферрин"] },
  { code: "tsat", name: "Насыщение трансферрина", group: "Обмен железа", priority: false, aliases: ["насыщение трансферрина", "коэффициент насыщения трансферрина", "кнт"] },
  { code: "tibc", name: "ОЖСС", group: "Обмен железа", priority: false, aliases: ["ожсс", "общая железосвязывающая способность"] },
  { code: "ldh", name: "ЛДГ", group: "Биохимия", priority: false, aliases: ["лдг", "лактатдегидрогеназа"] },
  { code: "alp", name: "Щелочная фосфатаза", group: "Печёночные показатели", priority: false, aliases: ["щелочная фосфатаза", "щф", "alp"] },
  { code: "bili_direct", name: "Билирубин прямой", group: "Печёночные показатели", priority: false, aliases: ["билирубин прямой", "прямой билирубин", "билирубин связанный"] },
  { code: "hgb", name: "Гемоглобин", group: "Общий анализ крови", priority: false, aliases: ["гемоглобин", "hgb", "hb"] },
  { code: "rbc", name: "Эритроциты", group: "Общий анализ крови", priority: false, aliases: ["эритроциты", "rbc"] },
  { code: "hct", name: "Гематокрит", group: "Общий анализ крови", priority: false, aliases: ["гематокрит", "hct"] },
  { code: "mcv", name: "Средний объём эритроцита", group: "Общий анализ крови", priority: false, aliases: ["средний объем эритроцита", "средний объём эритроцита", "mcv"] },
  { code: "wbc", name: "Лейкоциты", group: "Общий анализ крови", priority: false, aliases: ["лейкоциты", "wbc"] },
  { code: "plt", name: "Тромбоциты", group: "Общий анализ крови", priority: false, aliases: ["тромбоциты", "plt"] },
  { code: "esr", name: "СОЭ", group: "Общий анализ крови", priority: false, aliases: ["соэ", "скорость оседания эритроцитов"] },
  { code: "crp", name: "С-реактивный белок", group: "Воспаление", priority: false, aliases: ["с-реактивный белок", "c-реактивный белок", "срб", "crp", "вч-срб", "высокочувствительный срб"] },
  { code: "glucose", name: "Глюкоза", group: "Биохимия", priority: false, aliases: ["глюкоза", "глюкоза крови", "glu"] },
  { code: "hba1c", name: "Гликированный гемоглобин", group: "Биохимия", priority: false, aliases: ["гликированный гемоглобин", "гликозилированный гемоглобин", "hba1c"] },
  { code: "creatinine", name: "Креатинин", group: "Биохимия", priority: false, aliases: ["креатинин"] },
  { code: "urea", name: "Мочевина", group: "Биохимия", priority: false, aliases: ["мочевина"] },
  { code: "uric", name: "Мочевая кислота", group: "Биохимия", priority: false, aliases: ["мочевая кислота"] },
  { code: "protein", name: "Белок общий", group: "Биохимия", priority: false, aliases: ["белок общий", "общий белок"] },
  { code: "albumin", name: "Альбумин", group: "Биохимия", priority: false, aliases: ["альбумин"] },
  { code: "potassium", name: "Калий", group: "Биохимия", priority: false, aliases: ["калий", "k+"] },
  { code: "sodium", name: "Натрий", group: "Биохимия", priority: false, aliases: ["натрий", "na+"] },
  { code: "tsh", name: "ТТГ", group: "Гормоны и витамины", priority: false, aliases: ["ттг", "тиреотропный гормон", "tsh"] },
  { code: "ft4", name: "Т4 свободный", group: "Гормоны и витамины", priority: false, aliases: ["т4 свободный", "свободный т4", "ft4"] },
  { code: "b12", name: "Витамин B12", group: "Гормоны и витамины", priority: false, aliases: ["витамин b12", "витамин в12", "b12", "в12", "цианокобаламин"] },
  { code: "folate", name: "Фолиевая кислота", group: "Гормоны и витамины", priority: false, aliases: ["фолиевая кислота", "фолаты"] },
  { code: "vitd", name: "Витамин D", group: "Гормоны и витамины", priority: false, aliases: ["витамин d", "25-oh витамин d", "25-он витамин d", "25(oh)d", "витамин д"] },
  { code: "hbsag", name: "HBsAg", group: "Прочее", priority: false, aliases: ["hbsag"] },
];

/** Prefix of codes for lab names that are not in the catalog; the name itself becomes the indicator. */
const RAW = "raw:";

const clean = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

export function indicatorByCode(code: string | null): IndicatorDef | null {
  if (code?.startsWith(RAW)) {
    const name = code.slice(RAW.length);
    return name ? { code, name: name[0].toUpperCase() + name.slice(1), group: "Прочее", priority: false, aliases: [] } : null;
  }
  return INDICATORS.find((i) => i.code === code) ?? null;
}

/** Maps a raw lab name to an indicator code, or null when unknown (the raw name is kept either way). */
export function normalizeIndicator(rawName: string): string | null {
  const full = clean(rawName);
  // "Гемоглобин (HGB)": the name outside brackets, then the abbreviation inside them.
  const candidates = [full.replace(/\(.*?\)/g, "").replace(/[,:;.]+$/, "").trim(), ...[...full.matchAll(/\((.*?)\)/g)].map((m) => m[1].trim())];
  for (const s of candidates) {
    for (const i of INDICATORS) {
      if (i.aliases.some((a) => { const c = clean(a); return s === c || s.startsWith(c + " ") || s.startsWith(c + ","); })) return i.code;
    }
  }
  return null;
}

/** Indicator of a stored lab result: the catalog code, or a code made from the lab's own name. */
export function indicatorOf(v: { indicator: string | null; rawName: string }): string {
  return v.indicator ?? normalizeIndicator(v.rawName) ?? `${RAW}${clean(v.rawName).replace(/\(.*?\)/g, "").trim() || clean(v.rawName)}`;
}

/** Indicator of a qualitative finding, matched to the catalog when the model named it differently. */
export function qualitativeIndicatorOf(indicator: string | null): string | null {
  if (!indicator) return null;
  return indicatorByCode(indicator) ? indicator : normalizeIndicator(indicator);
}
