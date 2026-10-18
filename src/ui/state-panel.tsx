"use client";

import { useState } from "react";
import type { Fact } from "@/core/model";
import type { HealthState, StateItem } from "@/core/rules/state";
import type { FactAction } from "@/core/service";
import { postJson, useApi } from "./api";
import { useProfile } from "./profile";
import { Badge, Card, Empty, ErrorState, Loading, SourceLink } from "./common";
import Link from "next/link";
import { FactEditor } from "./fact-editor";

const today = () => new Date().toISOString().slice(0, 10);

function Btn({ onClick, children, primary }: { onClick: () => void; children: string; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border px-2 py-0.5 text-xs ${primary ? "border-teal-700 bg-teal-700 text-white hover:bg-teal-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}
    >
      {children}
    </button>
  );
}

function AnswerForm({ onDone }: { onDone: (a: FactAction | null) => void }) {
  const [answer, setAnswer] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (answer.trim()) onDone({ type: "resolve", answer: answer.trim() });
      }}
      className="mt-2 flex flex-wrap items-end gap-2"
    >
      <label className="text-xs text-slate-600">
        Ответ
        <input autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} className="mt-0.5 block w-72 rounded border border-slate-300 px-2 py-1 text-sm" />
      </label>
      <button type="submit" className="rounded bg-teal-700 px-3 py-1 text-sm text-white">
        Сохранить ответ
      </button>
      <button type="button" onClick={() => onDone(null)} className="rounded border border-slate-300 px-3 py-1 text-sm">
        Отмена
      </button>
    </form>
  );
}

function Item({ item, fact, section, act }: { item: StateItem; fact: Fact | undefined; section: string; act: (id: string, a: FactAction) => Promise<void> }) {
  const [mode, setMode] = useState<"none" | "correct" | "answer">("none");
  const run = (a: FactAction | null) => {
    setMode("none");
    if (a) void act(item.factId, a);
  };
  const actions: { label: string; action?: FactAction; mode?: "correct" | "answer"; primary?: boolean }[] = [];
  if (section === "documentComplaints") actions.push({ label: "Актуально сейчас", action: { type: "confirm_current" }, primary: true }, { label: "Не актуально", action: { type: "mark_historical" } });
  if (section === "currentComplaints") actions.push({ label: "Прошло", action: { type: "end", endDate: today() } });
  if (section === "otherMedications")
    actions.push(
      { label: "Принимаю сейчас", action: { type: "medication_status", status: "taking_now", startDate: null }, primary: true },
      { label: "Начал(а) приём", action: { type: "medication_status", status: "started_confirmed", startDate: null } },
      { label: "Не принимаю", action: { type: "mark_historical" } },
    );
  if (section === "takingMedications") actions.push({ label: "Завершить приём", action: { type: "end", endDate: today() } });
  if (section === "conditions") actions.push({ label: "Завершить период", action: { type: "end", endDate: today() } });
  if (section === "openQuestions") {
    if (fact?.value.kind === "clarification") actions.push({ label: "Ответить", mode: "answer", primary: true });
    if (fact?.value.kind === "appointment")
      actions.push({ label: "Был(а) на приёме", action: { type: "appointment_attended", attended: "yes" }, primary: true }, { label: "Не был(а)", action: { type: "appointment_attended", attended: "no" } });
    if (fact?.type === "examination") actions.push({ label: "Выполнено", action: { type: "end", endDate: today() } });
  }
  if (section !== "openQuestions") actions.push({ label: "Исправить", mode: "correct" });

  return (
    <li className="border-t border-slate-100 py-2 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-slate-900">{item.label}</span>
        {item.detail && <span className="text-sm text-slate-600">{item.detail}</span>}
        {fact?.conflictGroupId && <Badge tone="red">Есть расхождение</Badge>}
        {fact?.verification === "corrected" && <Badge tone="blue">Исправлено вами</Badge>}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span>Дата: {item.date}</span>
        <span>{item.currentness}</span>
        {fact?.sources.slice(0, 2).map((s, i) => <SourceLink key={i} src={s} factId={fact.id} />)}
      </div>
      <div role="group" className="mt-1.5 flex flex-wrap gap-1.5" aria-label={`Действия: ${item.label}`}>
        {actions.map((a) => (
          <Btn key={a.label} primary={a.primary} onClick={() => (a.mode ? setMode(a.mode) : run(a.action!))}>
            {a.label}
          </Btn>
        ))}
      </div>
      {mode === "correct" && fact && <FactEditor fact={fact} onDone={run} />}
      {mode === "answer" && <AnswerForm onDone={run} />}
    </li>
  );
}

function NoteForm({ onAdded }: { onAdded: () => void }) {
  const { base } = useProfile();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"complaint" | "medication" | "event">("complaint");
  const [text, setText] = useState("");
  const [current, setCurrent] = useState(true);
  const [error, setError] = useState<string | null>(null);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-100">
        Добавить заметку
      </button>
    );
  return (
    <form
      className="w-full space-y-2 rounded bg-slate-50 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await postJson(`${base}/notes`, { kind, text, current, date: today() });
          setText("");
          setOpen(false);
          setError(null);
          onAdded();
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          Тип{" "}
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="rounded border border-slate-300 px-2 py-1">
            <option value="complaint">Симптом или жалоба</option>
            <option value="medication">Препарат</option>
            <option value="event">Событие</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={current} onChange={(e) => setCurrent(e.target.checked)} /> Актуально сейчас
        </label>
      </div>
      <label className="block text-sm">
        Текст своими словами
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={2} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1" />
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="rounded bg-teal-700 px-3 py-1 text-sm text-white">Сохранить заметку</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded border border-slate-300 px-3 py-1 text-sm">Отмена</button>
      </div>
    </form>
  );
}

const SECTIONS: { key: keyof HealthState; title: string; empty: string }[] = [
  { key: "currentComplaints", title: "Актуальные жалобы", empty: "Нет жалоб, подтверждённых вами как актуальные." },
  { key: "documentComplaints", title: "Жалобы из документов (актуальность не подтверждена)", empty: "Нет." },
  { key: "conditions", title: "Заболевания и проблемы из документов", empty: "В документах нет формулировок диагнозов. Система диагнозы не ставит." },
  { key: "takingMedications", title: "Подтверждённые принимаемые препараты", empty: "Нет препаратов, приём которых вы подтвердили." },
  { key: "otherMedications", title: "Назначения и упоминания без подтверждённого приёма", empty: "Нет." },
  { key: "openQuestions", title: "Незавершённые обследования и вопросы", empty: "Нет открытых вопросов." },
];

export function StatePanel() {
  const { base, version, bump, documents } = useProfile();
  const state = useApi<HealthState>(`${base}/state`, version);
  const facts = useApi<Fact[]>(`${base}/facts`, version);
  const [error, setError] = useState<string | null>(null);

  const act = async (id: string, a: FactAction) => {
    try {
      await postJson(`${base}/facts/${id}`, a);
      setError(null);
      bump();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;
  if (!state.data) return <Loading />;
  const s = state.data;
  const byId = new Map((facts.data ?? []).map((f) => [f.id, f]));

  return (
    <Card title="Моё состояние" actions={<NoteForm onAdded={bump} />}>
      {error && <p role="alert" className="mb-2 text-sm text-red-700">{error}</p>}
      {s.factCount === 0 && documents.length === 0 && (
        <Empty>
          Сведений пока нет. Откройте пример или загрузите документ в разделе{" "}
          <Link href="/documents" className="text-teal-800 underline">
            «Документы»
          </Link>
          .
        </Empty>
      )}
      <div className="space-y-4">
        {SECTIONS.map(({ key, title, empty }) => {
          const items = s[key] as StateItem[];
          return (
            <div key={key}>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
              {items.length ? (
                <ul>
                  {items.map((i) => (
                    <Item key={i.factId} item={i} fact={byId.get(i.factId)} section={key} act={act} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">{empty}</p>
              )}
            </div>
          );
        })}
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Аллергии</h3>
          {s.allergiesUnknown ? (
            <p className="text-sm text-slate-700">Сведений нет. Это не означает, что аллергий нет.</p>
          ) : (
            <ul>
              {s.allergies.map((i) => (
                <Item key={i.factId} item={i} fact={byId.get(i.factId)} section="allergies" act={act} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
