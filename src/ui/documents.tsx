"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { ensureFileChosen, FilePicker } from "./file-picker";
import type { SourceDocument } from "@/core/model";
import { api } from "./api";
import { useProfile } from "./profile";
import { Badge, Card, DemoBadge, DOC_KIND_LABEL, Empty, formatIso, STATUS_LABEL } from "./common";

function Samples() {
  const { samples, profile, base, bump } = useProfile();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!profile) return null;
  const available = samples.filter((s) => s.synthetic === profile.isDemo);
  const open = async (key: string) => {
    setBusy(key);
    setError(null);
    try {
      const r = await api<{ document: SourceDocument }>(`${base}/samples/${key}`, { method: "POST" });
      bump();
      router.push(`/documents/${r.document.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card title="Примеры документов" actions={<DemoBadge>Подготовленный разбор</DemoBadge>}>
      <p className="mb-2 text-sm text-slate-600">
        {profile.isDemo
          ? "Синтетические документы для демонстрации: динамика анализов, расшифровка разговора, расхождение источников."
          : "Ваши документы с разбором, подготовленным по описанию. Оригиналы не сверялись; PDF можно прикрепить к примеру для сверки."}
      </p>
      <ul className="space-y-2">
        {available.map((s) => (
          <li key={s.key} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-2">
            <div>
              <div className="font-medium">{s.title}</div>
              <div className="text-xs text-slate-500">
                {DOC_KIND_LABEL[s.kind]} · {formatIso(s.documentDate)} · {s.description}
              </div>
            </div>
            <button type="button" onClick={() => open(s.key)} disabled={!!busy} className="rounded bg-teal-700 px-3 py-1 text-sm text-white disabled:opacity-50">
              {busy === s.key ? "Открываю…" : "Открыть пример"}
            </button>
          </li>
        ))}
      </ul>
      {!profile.isDemo && <p className="mt-2 text-xs text-slate-500">Синтетические примеры доступны в демо-профиле.</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </Card>
  );
}

function Upload() {
  const { base, bump } = useProfile();
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; error: string | null; info: string | null }>({ busy: false, error: null, info: null });
  const fileRef = useRef<HTMLInputElement>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // "Загрузить" without a chosen file opens the file dialog; choosing a file then submits.
    if (!ensureFileChosen(fileRef.current)) return;
    const form = new FormData(e.currentTarget);
    setState({ busy: true, error: null, info: "Загружаю и обрабатываю…" });
    try {
      const r = await api<{ document: SourceDocument; duplicate: boolean }>(`${base}/documents`, { method: "POST", body: form });
      bump();
      if (r.duplicate) {
        setState({ busy: false, error: null, info: "Этот файл уже загружен. Открываю существующий документ." });
      }
      router.push(`/documents/${r.document.id}${r.duplicate ? "?duplicate=1" : ""}`);
    } catch (err) {
      setState({ busy: false, error: (err as Error).message, info: null });
    }
  };
  return (
    <Card title="Загрузить документ">
      <form onSubmit={submit} className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="sm:col-span-2">
          <div className="mb-1">Файл (PDF или текст расшифровки .txt)</div>
          <FilePicker label="Файл (PDF или текст расшифровки .txt)" accept=".pdf,.txt,.md,application/pdf,text/plain" inputRef={fileRef} autoSubmit />
        </div>
        <label>
          Тип
          <select name="kind" defaultValue="" className="mt-1 block w-full rounded border border-slate-300 px-2 py-1">
            <option value="">Определить автоматически</option>
            {Object.entries(DOC_KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Дата документа (если известна)
          <input name="documentDate" type="date" className="mt-1 block w-full rounded border border-slate-300 px-2 py-1" />
        </label>
        <label>
          Врач или специалист
          <input name="specialist" placeholder="Например, терапевт" className="mt-1 block w-full rounded border border-slate-300 px-2 py-1" />
        </label>
        <label>
          Направление
          <input name="area" placeholder="Например, терапия" className="mt-1 block w-full rounded border border-slate-300 px-2 py-1" />
        </label>
        <div className="sm:col-span-2 flex items-center gap-3">
          <button type="submit" disabled={state.busy} className="rounded bg-teal-700 px-4 py-1.5 text-white disabled:opacity-50">
            Загрузить
          </button>
          {state.info && <span role="status" className="text-slate-600">{state.info}</span>}
        </div>
        {state.error && <p role="alert" className="sm:col-span-2 text-red-700">{state.error}</p>}
        <p className="sm:col-span-2 text-xs text-slate-500">
          Сначала при необходимости укажите тип, дату и врача, затем нажмите «Загрузить» и выберите файл. Файл сохраняется без изменений только на этом компьютере. Текстовый слой PDF извлекается локально; извлечение фактов для произвольных файлов в прототипе не подключено.
        </p>
      </form>
    </Card>
  );
}

export function DocumentsView() {
  const { documents } = useProfile();
  const [f, setF] = useState({ from: "", to: "", kind: "", specialist: "", area: "" });
  const specialists = useMemo(() => [...new Set(documents.map((d) => d.document.specialist).filter(Boolean))] as string[], [documents]);
  const areas = useMemo(() => [...new Set(documents.map((d) => d.document.area).filter(Boolean))] as string[], [documents]);
  const shown = documents.filter(({ document: d }) => {
    if (f.kind && d.kind !== f.kind) return false;
    if (f.specialist && d.specialist !== f.specialist) return false;
    if (f.area && d.area !== f.area) return false;
    if (f.from && (!d.documentDate || d.documentDate < f.from)) return false;
    if (f.to && (!d.documentDate || d.documentDate > f.to)) return false;
    return true;
  });
  const sel = "mt-1 block w-full rounded border border-slate-300 px-2 py-1";

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <Card title="Документы">
        <fieldset className="mb-3 grid gap-2 text-sm sm:grid-cols-5">
          <legend className="sr-only">Фильтры</legend>
          <label>
            Дата с<input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className={sel} />
          </label>
          <label>
            по<input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className={sel} />
          </label>
          <label>
            Тип
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className={sel}>
              <option value="">Все</option>
              {Object.entries(DOC_KIND_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Врач
            <select value={f.specialist} onChange={(e) => setF({ ...f, specialist: e.target.value })} className={sel}>
              <option value="">Все</option>
              {specialists.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Направление
            <select value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} className={sel}>
              <option value="">Все</option>
              {areas.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </fieldset>
        {documents.length === 0 ? (
          <Empty>Документов пока нет. Откройте пример или загрузите файл.</Empty>
        ) : shown.length === 0 ? (
          <Empty>Под фильтры ничего не подходит.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map(({ document: d, factCount, unverifiedCount }) => (
              <li key={d.id} className="py-2">
                <Link href={`/documents/${d.id}`} className="font-medium text-teal-800 underline">
                  {d.title}
                </Link>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <span>{DOC_KIND_LABEL[d.kind]}</span>
                  <span>Дата документа: {formatIso(d.documentDate)}</span>
                  {d.specialist && <span>{d.specialist}</span>}
                  <Badge tone={STATUS_LABEL[d.status].tone}>{STATUS_LABEL[d.status].text}</Badge>
                  {d.sampleKey && <DemoBadge>{d.isSynthetic ? "Синтетический" : "Подготовленный разбор"}</DemoBadge>}
                  <span>
                    Фактов: {factCount}
                    {unverifiedCount ? `, не проверено вами: ${unverifiedCount}` : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="space-y-4">
        <Samples />
        <Upload />
      </div>
    </div>
  );
}
