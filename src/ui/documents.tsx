"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { ensureFileChosen, FilePicker } from "./file-picker";
import type { SourceDocument } from "@/core/model";
import { api } from "./api";
import { useProfile } from "./profile";
import { Badge, Card, DemoBadge, DOC_KIND_LABEL, Empty, formatDateTime, formatIso, STATUS_LABEL } from "./common";

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

type BatchRow = {
  name: string;
  status: "waiting" | "uploading" | "uploaded" | "duplicate" | "error" | "extracting" | "extracted" | "extract_error" | "applying" | "applied" | "needs_review";
  doc: SourceDocument | null;
  message: string | null;
  added?: number;
  decisions?: number;
};
type AutoApplied = { document: SourceDocument; applied: boolean; added: number; decisions: number; reason: string | null };

const BATCH_STATUS: Record<BatchRow["status"], string> = {
  waiting: "в очереди",
  uploading: "загружаю…",
  uploaded: "загружен",
  duplicate: "уже был загружен",
  error: "ошибка",
  extracting: "модель читает…",
  extracted: "факты предложены, проверьте",
  extract_error: "ошибка извлечения",
  applying: "добавляю в историю…",
  applied: "добавлен в историю",
  needs_review: "нужна ваша проверка",
};

const SENDABLE_AFTER_UPLOAD: SourceDocument["status"][] = ["extraction_ready", "extraction_unavailable", "recognition_unavailable", "error"];

function Upload() {
  const { base, bump, liveModel } = useProfile();
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; error: string | null; info: string | null }>({ busy: false, error: null, info: null });
  const [batch, setBatch] = useState<BatchRow[]>([]);
  const [agreed, setAgreed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const setRow = (i: number, patch: Partial<BatchRow>) => setBatch((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // Bulk upload adds what was found right away; changes to the current state and questions wait for the user.
  const autoApply = async (i: number, doc: SourceDocument) => {
    setRow(i, { status: "applying" });
    try {
      const r = await api<AutoApplied>(`${base}/documents/${doc.id}/auto-apply`, { method: "POST" });
      setRow(i, { status: r.applied ? "applied" : "needs_review", doc: r.document, added: r.added, decisions: r.decisions, message: r.reason });
    } catch (err) {
      setRow(i, { status: "needs_review", message: (err as Error).message });
    }
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // "Загрузить" without a chosen file opens the file dialog; choosing a file then submits.
    if (!ensureFileChosen(fileRef.current)) return;
    const files = [...(fileRef.current?.files ?? [])];
    const shared = new FormData(e.currentTarget);
    shared.delete("file");
    if (files.length === 1) {
      const form = new FormData(e.currentTarget);
      setState({ busy: true, error: null, info: "Загружаю и обрабатываю…" });
      try {
        const r = await api<{ document: SourceDocument; duplicate: boolean }>(`${base}/documents`, { method: "POST", body: form });
        bump();
        if (r.duplicate) setState({ busy: false, error: null, info: "Этот документ уже загружен. Открываю существующий документ." });
        router.push(`/documents/${r.document.id}${r.duplicate ? "?duplicate=1" : ""}`);
      } catch (err) {
        setState({ busy: false, error: (err as Error).message, info: null });
      }
      return;
    }
    // Several files: uploaded one after another, each gets its own line with the result.
    setAgreed(false);
    setBatch(files.map((f) => ({ name: f.name, status: "waiting", doc: null, message: null })));
    setState({ busy: true, error: null, info: `Загружаю файлы: ${files.length}` });
    for (const [i, file] of files.entries()) {
      setRow(i, { status: "uploading" });
      const form = new FormData();
      for (const [k, v] of shared.entries()) form.append(k, v);
      form.append("file", file);
      try {
        const r = await api<{ document: SourceDocument; duplicate: boolean }>(`${base}/documents`, { method: "POST", body: form });
        setRow(i, { status: r.duplicate ? "duplicate" : "uploaded", doc: r.document });
        if (!r.duplicate && r.document.status === "review_pending" && !r.document.sampleKey) await autoApply(i, r.document);
      } catch (err) {
        setRow(i, { status: "error", message: (err as Error).message });
      }
    }
    if (fileRef.current) fileRef.current.value = "";
    bump();
    setState({ busy: false, error: null, info: null });
  };

  const sendable = batch.map((r, i) => ({ r, i })).filter(({ r }) => r.status === "uploaded" && r.doc && !r.doc.sampleKey && SENDABLE_AFTER_UPLOAD.includes(r.doc.status));
  const extractAll = async () => {
    setState({ busy: true, error: null, info: null });
    for (const { r, i } of sendable) {
      setRow(i, { status: "extracting" });
      try {
        await api(`${base}/documents/${r.doc!.id}/extract`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consent: true }) });
        setRow(i, { status: "extracted" });
        await autoApply(i, r.doc!);
      } catch (err) {
        setRow(i, { status: "extract_error", message: (err as Error).message });
      }
    }
    setAgreed(false);
    bump();
    setState({ busy: false, error: null, info: null });
  };

  return (
    <Card title="Загрузить документ">
      <form onSubmit={submit} className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="sm:col-span-2">
          <div className="mb-1">Файлы (PDF или текст расшифровки .txt), можно выбрать несколько</div>
          <FilePicker label="Файл (PDF или текст расшифровки .txt)" accept=".pdf,.txt,.md,application/pdf,text/plain" inputRef={fileRef} autoSubmit multiple />
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
          Сначала при необходимости укажите тип, дату и врача, затем нажмите «Загрузить» и выберите один или несколько файлов. Тип, дата и врач применяются ко всем выбранным файлам; при нескольких файлах дату лучше не указывать, её найдёт модель. Файлы сохраняются без изменений только на этом компьютере, текстовый слой PDF извлекается локально.
        </p>
      </form>
      {batch.length > 0 && (
        <div className="mt-4 border-t border-slate-200 pt-3 text-sm">
          <h3 className="font-medium">Загрузка нескольких файлов</h3>
          <ul className="mt-2 space-y-1" aria-live="polite">
            {batch.map((r, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2">
                {r.doc ? (
                  <Link className="text-teal-800 underline" href={`/documents/${r.doc.id}${r.status === "duplicate" ? "?duplicate=1" : ""}`}>
                    {r.name}
                  </Link>
                ) : (
                  <span>{r.name}</span>
                )}
                <Badge tone={r.status === "error" || r.status === "extract_error" ? "red" : r.status === "needs_review" ? "amber" : r.status === "applied" || r.status === "extracted" || r.status === "uploaded" ? "green" : "slate"}>{BATCH_STATUS[r.status]}</Badge>
                {r.status === "applied" && (
                  <span className="text-slate-600">
                    новых фактов: {r.added}
                    {r.decisions ? `, ждут решения: ${r.decisions}` : ""}
                  </span>
                )}
                {r.message && <span className={r.status === "needs_review" ? "text-amber-800" : "text-red-700"}>{r.message}</span>}
              </li>
            ))}
          </ul>
          {liveModel && sendable.length > 0 && !state.busy && (
            <div className="mt-3 rounded bg-slate-50 p-2">
              <p>
                Можно сразу извлечь факты из загруженных документов: текст каждого (а для PDF без текстового слоя сам файл) будет отправлен в {liveModel.provider}, модель {liveModel.model}. Найденные факты сразу добавятся в историю с пометкой «не проверено»; что вы принимаете сейчас и что актуально, решаете вы.
              </p>
              <label className="mt-2 flex items-start gap-2">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
                <span>
                  Согласен отправить в {liveModel.provider} эти документы ({sendable.length}): {sendable.map(({ r }) => r.name).join(", ")}
                </span>
              </label>
              <button type="button" onClick={extractAll} disabled={!agreed} className="mt-2 rounded bg-teal-700 px-4 py-1.5 text-white disabled:opacity-50">
                Отправить и извлечь факты из всех
              </button>
            </div>
          )}
          {!state.busy && <BatchSummary rows={batch} />}
        </div>
      )}
    </Card>
  );
}

/** Adds every document waiting for review to the history at once, the same way bulk upload does. */
function ApplyPending() {
  const { base, bump, documents } = useProfile();
  const pending = documents.filter((d) => d.document.status === "review_pending" && !d.document.sampleKey);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [busy, setBusy] = useState(false);
  if (!pending.length && !rows.length) return null;
  const run = async () => {
    setBusy(true);
    const next: BatchRow[] = [];
    for (const { document: d } of pending) {
      try {
        const r = await api<AutoApplied>(`${base}/documents/${d.id}/auto-apply`, { method: "POST" });
        next.push({ name: d.title, status: r.applied ? "applied" : "needs_review", doc: r.document, added: r.added, decisions: r.decisions, message: r.reason });
      } catch (err) {
        next.push({ name: d.title, status: "needs_review", doc: d, message: (err as Error).message });
      }
    }
    setRows(next);
    setBusy(false);
    bump();
  };
  return (
    <div className="mb-3 rounded bg-amber-50 p-2 text-sm text-amber-900">
      {pending.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span>Ждут проверки: {pending.length}.</span>
          <button type="button" onClick={run} disabled={busy} className="rounded bg-teal-700 px-3 py-1 text-white disabled:opacity-50">
            {busy ? "Добавляю…" : "Добавить все в историю"}
          </button>
          <span className="text-xs">Факты будут помечены «не проверено»; что принимаете сейчас и что актуально, решаете вы.</span>
        </div>
      )}
      {rows.length > 0 && <BatchSummary rows={rows} />}
    </div>
  );
}

/** Result of a bulk upload: what was added and what waits for the user's decision. */
function BatchSummary({ rows }: { rows: BatchRow[] }) {
  const applied = rows.filter((r) => r.status === "applied");
  if (!applied.length && !rows.some((r) => r.status === "needs_review")) return null;
  const added = applied.reduce((n, r) => n + (r.added ?? 0), 0);
  const decisions = applied.reduce((n, r) => n + (r.decisions ?? 0), 0);
  const review = rows.filter((r) => r.status === "needs_review");
  return (
    <div role="status" className="mt-3 rounded bg-teal-50 p-2 text-teal-900">
      <p>
        Добавлено в историю: документов {applied.length}, новых фактов {added}. Факты помечены «не проверено»: их можно проверить и исправить в карточке документа.
      </p>
      {decisions > 0 && (
        <p className="mt-1">
          Ждут вашего решения: {decisions} (что принимаете сейчас, что актуально, вопросы). Они в разделе{" "}
          <Link href="/" className="underline">
            «Моё состояние»
          </Link>
          .
        </p>
      )}
      {review.length > 0 && <p className="mt-1">Не добавлены автоматически: {review.map((r) => r.name).join(", ")}. Откройте их по ссылке выше.</p>}
    </div>
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
        <ApplyPending />
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
                  <span>Загружен: {formatDateTime(d.createdAt)}</span>
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
