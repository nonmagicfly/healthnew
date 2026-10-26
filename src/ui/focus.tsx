"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { CustomFocusArea } from "@/core/model";
import type { FocusCard, FocusMetric } from "@/core/rules/focus";
import { api, useApi } from "./api";
import { useProfile } from "./profile";
import { Badge, Card, Empty, ErrorState, formatIso, Loading } from "./common";

interface FocusData {
  cards: FocusCard[];
  builtIn: { id: string; title: string; description: string; enabled: boolean }[];
  custom: CustomFocusArea[];
  outOfFocus: { id: string; title: string; documentDate: string | null; manual: boolean }[];
  unsorted: { id: string; title: string; documentDate: string | null }[];
}

const TREND = { up: "↑", down: "↓", same: "→" } as const;

function Metric({ m }: { m: FocusMetric }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <Link href={`/indicators?code=${encodeURIComponent(m.code)}`} className="text-teal-800 underline">
        {m.name}
      </Link>
      <span className={m.last.flag ? "font-medium text-red-700" : "font-medium"}>
        {m.last.raw} {m.unit ?? ""}
      </span>
      {m.last.flag && <Badge tone="red">{m.last.flag === "high" ? "выше нормы" : "ниже нормы"}</Badge>}
      {m.previous && m.trend && (
        <span className="text-slate-600" title={`Было ${m.previous.raw} на ${formatIso(m.previous.date)}`}>
          {TREND[m.trend]} было {m.previous.raw}
        </span>
      )}
      <span className="text-xs text-slate-500">{formatIso(m.last.date)}{m.count > 2 ? `, всего ${m.count}` : ""}</span>
    </li>
  );
}

function AreaCard({ c }: { c: FocusCard }) {
  const empty = !c.conclusion && !c.metrics.length && !c.nextCheck;
  return (
    <Card title={c.title} actions={<span className="text-xs text-slate-500">документов: {c.documents}</span>}>
      {empty ? (
        <Empty>Пока ничего нет. {c.description}.</Empty>
      ) : (
        <div className="space-y-3">
          {c.conclusion && (
            <div>
              <div className="text-xs text-slate-500">Последнее заключение</div>
              <Link href={`/documents/${c.conclusion.documentId}`} className="text-sm font-medium text-teal-800 underline">
                {formatIso(c.conclusion.date)}, {c.conclusion.specialist ?? c.conclusion.title}
              </Link>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                {c.conclusion.lines.map((l) => (
                  <li key={l.factId}>{l.label}</li>
                ))}
              </ul>
            </div>
          )}
          {c.metrics.length > 0 && (
            <div>
              <div className="text-xs text-slate-500">Показатели</div>
              <ul className="mt-1 space-y-1">
                {c.metrics.map((m) => (
                  <Metric key={m.code} m={m} />
                ))}
              </ul>
            </div>
          )}
          <div className="text-sm">
            <span className="text-slate-500">Следующая проверка: </span>
            {c.nextCheck ? `${formatIso(c.nextCheck.date)}, ${c.nextCheck.label}` : "в документах не назначена"}
          </div>
        </div>
      )}
    </Card>
  );
}

function Settings({ data, onSaved }: { data: FocusData; onSaved: () => void }) {
  const { base } = useProfile();
  const [title, setTitle] = useState("");
  const [words, setWords] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async (disabled: string[], custom: CustomFocusArea[]) => {
    setError(null);
    try {
      await api(`${base}/focus`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ disabled, custom }) });
      onSaved();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const disabled = data.builtIn.filter((a) => !a.enabled).map((a) => a.id);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (await save(disabled, [...data.custom, { id: "", title, keywords: words.split(",") }])) {
      setTitle("");
      setWords("");
    }
  };
  return (
    <details className="rounded-lg border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer text-sm text-slate-700">Настроить области фокуса</summary>
      <div className="mt-3 space-y-3 text-sm">
        <ul className="space-y-1">
          {data.builtIn.map((a) => (
            <li key={a.id}>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={a.enabled}
                  onChange={(e) => save(e.target.checked ? disabled.filter((id) => id !== a.id) : [...disabled, a.id], data.custom)}
                  className="mt-1"
                />
                <span>
                  {a.title} <span className="text-slate-500">— {a.description}</span>
                </span>
              </label>
            </li>
          ))}
          {data.custom.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2">
              <span>
                {c.title} <span className="text-slate-500">— {c.keywords.join(", ")}</span>
              </span>
              <button type="button" onClick={() => save(disabled, data.custom.filter((x) => x.id !== c.id))} className="text-xs text-red-700 underline">
                Убрать
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <label>
            Своя область
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, Спина" className="mt-1 block rounded border border-slate-300 px-2 py-1" />
          </label>
          <label className="min-w-0 flex-1">
            Слова в документах, через запятую
            <input value={words} onChange={(e) => setWords(e.target.value)} placeholder="позвоночник, грыжа, МРТ поясничного" className="mt-1 block w-full rounded border border-slate-300 px-2 py-1" />
          </label>
          <button type="submit" disabled={!title.trim() || !words.trim()} className="rounded bg-teal-700 px-3 py-1 text-white disabled:opacity-50">
            Добавить
          </button>
        </form>
        {error && <p role="alert" className="text-red-700">{error}</p>}
      </div>
    </details>
  );
}

export function FocusView() {
  const { base, version, bump } = useProfile();
  const data = useApi<FocusData>(`${base}/focus`, version);
  const [error, setError] = useState<string | null>(null);
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;
  if (!data.data) return <Loading />;
  const d = data.data;
  const back = async (id: string) => {
    setError(null);
    try {
      await api(`${base}/documents/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ focus: "in" }) });
      bump();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Фокус</h1>
        <p className="text-sm text-slate-600">
          Только важное: последнее заключение по каждой области, ключевые показатели с динамикой и ближайшая проверка из документов. Документы вне фокуса не удаляются, но не попадают в чат.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {d.cards.map((c) => (
          <AreaCard key={c.id} c={c} />
        ))}
      </div>
      <Settings data={d} onSaved={bump} />
      {d.unsorted.length > 0 && (
        <details className="rounded-lg border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm text-slate-700">Ещё не разобраны: {d.unsorted.length}</summary>
          <p className="mt-2 text-sm text-slate-600">Из этих документов пока ничего не извлечено, поэтому область не определена. Они не скрыты и попадут в фокус или выйдут из него после разбора.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {d.unsorted.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2">
                <span className="text-slate-500">{formatIso(o.documentDate)}</span>
                <Link href={`/documents/${o.id}`} className="text-teal-800 underline">
                  {o.title}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className="rounded-lg border border-slate-200 bg-white p-3">
        <summary className="cursor-pointer text-sm text-slate-700">Вне фокуса: {d.outOfFocus.length}</summary>
        {d.outOfFocus.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">Таких документов нет.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {d.outOfFocus.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2">
                <span className="text-slate-500">{formatIso(o.documentDate)}</span>
                <Link href={`/documents/${o.id}`} className="text-teal-800 underline">
                  {o.title}
                </Link>
                {o.manual && <Badge tone="slate">убран вами</Badge>}
                <button type="button" onClick={() => back(o.id)} className="text-xs text-teal-800 underline">
                  Вернуть в фокус
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      </details>
    </div>
  );
}
