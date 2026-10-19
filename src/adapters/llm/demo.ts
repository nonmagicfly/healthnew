import type { AnswerSegment, Fact } from "@/core/model";
import type { LlmAdapter, LlmAnswer, LlmRequest } from "@/core/ports";
import { formatDateValue, formatIsoRu } from "@/core/rules/dates";
import { MEDICATION_STATUS_LABEL } from "@/core/rules/facts";
import { indicatorByCode } from "@/core/indicators";
import { outOfReference } from "@/core/rules/retrieval";

/**
 * DEMO adapter: no language model is called. The answer is assembled from templates
 * over the facts that local retrieval selected, so corrections show up immediately.
 * It reads only structured facts; document text in `untrustedContext` is never interpreted.
 */
export class DemoLlm implements LlmAdapter {
  async answer(req: LlmRequest): Promise<LlmAnswer> {
    const facts = req.contextFacts;
    const q = req.question.toLowerCase();
    const segs: AnswerSegment[] = [];
    const push = (kind: AnswerSegment["kind"], text: string, fs: Fact[] = []) =>
      segs.push({ kind, text, factIds: fs.map((f) => f.id), sources: fs.map((f) => f.sources[0]) });
    const whose = (f: Fact): AnswerSegment["kind"] =>
      f.extraction.method === "manual" || f.sources[0]?.speaker === "patient" ? "patient_words" : "document_fact";
    const docDate = (f: Fact) => (f.documentDate ? `документ от ${formatIsoRu(f.documentDate)}` : "дата документа неизвестна");

    const meds = facts.filter((f) => f.type === "medication");
    const labs = facts.filter((f) => f.type === "lab_result" && f.value.kind === "lab_result");
    const quals = facts.filter((f) => f.type === "qualitative_finding");
    const complaints = facts.filter((f) => f.type === "complaint" || f.type === "note");
    const allergies = facts.filter((f) => f.type === "allergy");
    const procedures = facts.filter((f) => f.type === "procedure");
    const other = facts.filter((f) => ["appointment", "examination", "diagnosis", "condition"].includes(f.type));
    const questions = facts.filter((f) => f.type === "clarification");

    if (!facts.length && !/аллерг/.test(q)) {
      push("missing", "В вашей истории не нашлось сведений по этому вопросу. Возможно, нужных документов ещё нет в приложении.");
    }

    for (const f of meds) {
      if (f.value.kind !== "medication") continue;
      const dose = f.value.dose ? `, ${f.value.dose}` : ", дозировка не указана";
      const conflict = f.conflictGroupId ? " Есть расхождение с другим источником." : "";
      const userConfirmed = ["taking_now", "started_confirmed", "stopped"].includes(f.value.status) && f.verification === "confirmed";
      push(userConfirmed ? "patient_words" : whose(f), `${f.value.name ?? "Название неизвестно"}${dose}: ${MEDICATION_STATUS_LABEL[f.value.status].toLowerCase()} (${docDate(f)}).${conflict}`, [f]);
    }
    if (meds.some((f) => f.value.kind === "medication" && ["prescribed", "mentioned_taking", "option_discussed", "unknown"].includes(f.value.status))) {
      push("caution", "Назначения из прошлого не означают, что препарат нужно принимать сейчас. Решение о приёме стоит обсудить с врачом.");
    }

    const byIndicator = new Map<string, Fact[]>();
    for (const f of labs) {
      if (f.value.kind !== "lab_result") continue;
      const k = f.value.indicator ?? f.value.rawName;
      byIndicator.set(k, [...(byIndicator.get(k) ?? []), f]);
    }
    for (const [code, fs] of byIndicator) {
      const name = indicatorByCode(code)?.name ?? code;
      const forms = fs.filter((f) => f.value.kind === "lab_result" && f.value.origin === "lab_report");
      const mentions = fs.filter((f) => f.value.kind === "lab_result" && f.value.origin === "mention" && !f.value.linkedResultId);
      for (const f of forms) {
        if (f.value.kind !== "lab_result") continue;
        const v = f.value;
        const flag = outOfReference(f);
        const flagText = flag === "high" ? " (выше референса)" : flag === "low" ? " (ниже референса)" : "";
        push("document_fact", `${name}: ${v.value.raw}${v.unit ? ` ${v.unit}` : ""}${flagText}${v.reference ? `, референс лаборатории ${v.reference.raw}` : ""}; дата забора: ${formatDateValue(f.eventDate)}; ${docDate(f)}.`, [f]);
      }
      for (const f of mentions) {
        if (f.value.kind !== "lab_result") continue;
        push("document_fact", `${name} ${f.value.value.raw}${f.value.unit ? ` ${f.value.unit}` : " (единицы не указаны)"} упомянут в консультации, это не результат бланка; дата анализа: ${formatDateValue(f.eventDate)}.`, [f]);
      }
      const plotted = forms.filter((f) => f.eventDate.kind === "exact");
      if (plotted.length >= 2) {
        const sorted = [...plotted].sort((a, b) => (a.eventDate.kind === "exact" && b.eventDate.kind === "exact" ? a.eventDate.date.localeCompare(b.eventDate.date) : 0));
        const units = new Set(sorted.map((f) => (f.value.kind === "lab_result" ? f.value.unit : null)));
        if (units.size === 1) {
          const first = sorted[0];
          const last = sorted[sorted.length - 1];
          if (first.value.kind === "lab_result" && last.value.kind === "lab_result")
            push("summary", `${name} изменился с ${first.value.value.raw} до ${last.value.value.raw} ${last.value.unit ?? ""} между ${formatDateValue(first.eventDate)} и ${formatDateValue(last.eventDate)}.`, [first, last]);
        } else {
          push("summary", `Результаты ${name} записаны в разных единицах, поэтому напрямую не сравниваются.`, sorted);
        }
      }
      if (!forms.length) push("missing", `Результатов лабораторных бланков для показателя «${name}» нет. Загрузите бланк, чтобы увидеть точные значения, единицы и даты.`);
    }
    for (const f of quals) push("document_fact", `${f.label}: качественная формулировка без числа (${docDate(f)}).`, [f]);
    if (procedures.length && byIndicator.size) {
      for (const f of procedures) push(whose(f), `${f.label}: ${formatDateValue(f.eventDate)}.`, [f]);
      push("caution", "Совпадение по времени с лечением не доказывает причинную связь.");
    }

    for (const f of complaints) {
      const status =
        f.validity.status === "current"
          ? "актуально, подтверждено вами"
          : f.validity.status === "ended" || f.validity.status === "historical"
            ? "не актуально"
            : `из документа, актуальность не подтверждена (${docDate(f)})`;
      push(whose(f), `${f.label}: ${status}.`, [f]);
    }

    const asksAbnormal = /(отклон|вне норм|не в норм|выше норм|ниже норм|вне референс|повышен|понижен|превыш)/.test(q);
    if (asksAbnormal && labs.some((f) => outOfReference(f))) {
      push("caution", "Выход за референс лаборатории сам по себе не диагноз. Значения стоит обсудить с врачом вместе с остальными данными.");
    } else if (asksAbnormal && facts.length) {
      push("missing", "Значений вне референса лаборатории в ваших бланках не найдено.");
    }

    if (/аллерг/.test(q)) {
      if (allergies.length) for (const f of allergies) push(whose(f), `Аллергия: ${f.label}.`, [f]);
      else push("missing", "Сведений об аллергиях в истории нет. Это не означает, что аллергий нет.");
    }

    for (const f of other) {
      const extra = f.value.kind === "appointment" && f.value.attended === "unknown" ? " Посещение не подтверждено." : "";
      const kind = f.type === "diagnosis" ? "Формулировка врача: " : "";
      push("document_fact", `${kind}${f.label}; ${formatDateValue(f.eventDate)}.${extra}`, [f]);
    }

    for (const f of questions) if (f.value.kind === "clarification") push("missing", `Требует уточнения: ${f.value.question}`, [f]);

    const outdated = facts.filter((f) => f.validity.status === "unconfirmed");
    if (outdated.length) push("caution", "Часть сведений взята из документов и не подтверждена как актуальная. Если что-то изменилось, исправьте это в разделе «Моё состояние».");

    return { mode: "demo", segments: segs, usedFactIds: facts.map((f) => f.id) };
  }
}
