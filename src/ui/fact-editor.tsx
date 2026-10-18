"use client";

import { useState, type FormEvent } from "react";
import type { Fact } from "@/core/model";
import type { FactAction } from "@/core/service";

/** Inline correction form. The previous values stay in the fact's history. */
export function FactEditor({ fact, onDone }: { fact: Fact; onDone: (a: FactAction | null) => void }) {
  const lab = fact.value.kind === "lab_result" ? fact.value : null;
  const [label, setLabel] = useState(fact.label);
  const [date, setDate] = useState(fact.eventDate.kind === "exact" ? fact.eventDate.date : "");
  const [raw, setRaw] = useState(lab?.value.raw ?? "");
  const [unit, setUnit] = useState(lab?.unit ?? "");
  const [reason, setReason] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const origDate = fact.eventDate.kind === "exact" ? fact.eventDate.date : "";
    onDone({
      type: "correct",
      reason: reason || null,
      patch: {
        ...(label !== fact.label ? { label } : {}),
        ...(date !== origDate ? { eventDate: date || null } : {}),
        ...(lab && raw !== lab.value.raw ? { labValueRaw: raw } : {}),
        ...(lab && unit !== (lab.unit ?? "") ? { unit: unit || null } : {}),
      },
    });
  };
  const input = "mt-0.5 block rounded border border-slate-300 px-2 py-1 text-sm";
  return (
    <form onSubmit={submit} className="mt-2 flex flex-wrap items-end gap-2 rounded bg-slate-50 p-2">
      <label className="text-xs text-slate-600">
        Формулировка
        <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} className={`${input} w-60`} />
      </label>
      <label className="text-xs text-slate-600">
        {lab ? "Дата забора" : "Дата события"} (пусто = неизвестна)
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
      </label>
      {lab && (
        <>
          <label className="text-xs text-slate-600">
            Значение как в бланке
            <input value={raw} onChange={(e) => setRaw(e.target.value)} className={`${input} w-24`} />
          </label>
          <label className="text-xs text-slate-600">
            Единицы
            <input value={unit} onChange={(e) => setUnit(e.target.value)} className={`${input} w-24`} />
          </label>
        </>
      )}
      <label className="text-xs text-slate-600">
        Причина (необязательно)
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={`${input} w-44`} />
      </label>
      <button type="submit" className="rounded bg-teal-700 px-3 py-1 text-sm text-white">
        Сохранить
      </button>
      <button type="button" onClick={() => onDone(null)} className="rounded border border-slate-300 px-3 py-1 text-sm">
        Отмена
      </button>
    </form>
  );
}
