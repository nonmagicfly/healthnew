"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ensureFileChosen, FilePicker } from "./file-picker";
import type { ContentVersion, Encounter, Fact, Proposal, ProposalItem, SourceDocument } from "@/core/model";
import { MEDICATION_STATUS_LABEL } from "@/core/rules/facts";
import { formatDateValue } from "@/core/rules/dates";
import { SPEAKER_LABEL } from "@/core/rules/transcript";
import { api, postJson, useApi } from "./api";
import { FactEditor } from "./fact-editor";
import type { FactAction } from "@/core/service";
import { useProfile } from "./profile";
import { Badge, Card, DemoBadge, DOC_KIND_LABEL, Empty, ErrorState, formatDateTime, formatIso, Loading, STATUS_LABEL } from "./common";

interface Detail {
  document: SourceDocument;
  versions: ContentVersion[];
  facts: Fact[];
  proposal: Proposal | null;
  encounter: Encounter | null;
  relatedDocuments: SourceDocument[];
}

const METHOD_LABEL: Record<ContentVersion["method"], { text: string; demo: boolean }> = {
  pdf_text_layer: { text: "Текстовый слой PDF (извлечён локально)", demo: false },
  plain_text: { text: "Текст файла", demo: false },
  transcript_parser: { text: "Расшифровка, разобранная по репликам", demo: false },
  prepared: { text: "Подготовленное описание (не текст оригинала)", demo: true },
};

const TYPE_LABEL: Record<Fact["type"], string> = {
  complaint: "Жалоба",
  condition: "Проблема",
  diagnosis: "Диагноз (формулировка врача)",
  medication: "Препарат",
  allergy: "Аллергия",
  lab_result: "Результат анализа",
  qualitative_finding: "Качественное описание",
  procedure: "Процедура",
  examination: "Обследование",
  appointment: "Явка",
  clarification: "Требует уточнения",
  note: "Заметка",
};

function Highlight({ text, quote }: { text: string; quote: string | null }) {
  const i = quote ? text.indexOf(quote) : -1;
  if (!quote || i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="highlight-fragment" data-testid="source-fragment">
        {text.slice(i, i + quote.length)}
      </mark>
      {text.slice(i + quote.length)}
    </>
  );
}

function SourcePane({ detail, focusFact, focusSegment }: { detail: Detail; focusFact: Fact | null; focusSegment: string | null }) {
  const { base, bump } = useProfile();
  const d = detail.document;
  const tabs = [...(d.original ? [{ id: "original", label: "Оригинал" }] : []), ...detail.versions.map((v) => ({ id: v.id, label: METHOD_LABEL[v.method].text }))];
  const preferred = focusFact?.sources.find((s) => s.documentId === d.id)?.versionId ?? null;
  const [chosen, setTab] = useState<string | null>(null);
  const parsed = detail.versions.find((v) => v.method === "transcript_parser")?.id;
  const tab = chosen ?? preferred ?? parsed ?? tabs[0]?.id ?? "";
  const quote = focusFact?.sources.find((s) => s.documentId === d.id)?.quote ?? null;
  const [attachError, setAttachError] = useState<string | null>(null);
  const attachRef = useRef<HTMLInputElement>(null);

  const attach = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!ensureFileChosen(attachRef.current)) return;
    try {
      await api(`${base}/documents/${d.id}/original`, { method: "POST", body: new FormData(e.currentTarget) });
      bump();
    } catch (err) {
      setAttachError((err as Error).message);
    }
  };

  const version = detail.versions.find((v) => v.id === tab);
  return (
    <Card title="Источник">
      {tabs.length > 1 && (
        <div role="tablist" aria-label="Представления документа" className="mb-3 flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded px-2 py-1 text-xs ${tab === t.id ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {!d.original && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
          Оригинал в приложение не загружен. {d.sampleKey && !d.isSynthetic && "Можно прикрепить свой PDF: он сохранится без изменений, а рядом появится его текстовый слой для сверки с подготовленным разбором."}
          {d.sampleKey && !d.isSynthetic && (
            <form onSubmit={attach} className="mt-2 flex flex-wrap items-center gap-2">
              <FilePicker label="PDF оригинала" accept="application/pdf,.pdf" inputRef={attachRef} autoSubmit />
              <button type="submit" className="rounded bg-teal-700 px-3 py-1 text-white">
                Прикрепить оригинал
              </button>
              {attachError && <span role="alert" className="text-red-700">{attachError}</span>}
            </form>
          )}
        </div>
      )}
      {tab === "original" && d.original && (
        d.original.mime === "application/pdf" ? (
          <iframe title={`Оригинал: ${d.title}`} src={`${base}/documents/${d.id}/original`} className="h-[70vh] w-full rounded border border-slate-200" />
        ) : (
          <OriginalText url={`${base}/documents/${d.id}/original`} quote={quote} />
        )
      )}
      {version && (
        <div>
          {METHOD_LABEL[version.method].demo && <p className="mb-2"><DemoBadge>{version.note ?? "Подготовленное описание"}</DemoBadge></p>}
          {version.segments.length > 0 ? (
            <ol className="space-y-1 text-sm">
              {version.segments.map((s) => {
                const focused = s.id === focusSegment || focusFact?.sources.some((src) => src.segmentId === s.id && src.versionId === version.id);
                return (
                  <li key={s.id} id={`seg-${s.id}`} className={`rounded px-2 py-1 ${focused ? "highlight-fragment" : ""}`} data-testid={focused ? "source-fragment" : undefined}>
                    <span className="mr-2 font-mono text-xs text-slate-500">{s.timecode ?? "—"}</span>
                    <Badge tone={s.speaker === "doctor" ? "teal" : s.speaker === "patient" ? "blue" : "amber"}>{SPEAKER_LABEL[s.speaker]}</Badge>{" "}
                    {s.text}
                  </li>
                );
              })}
            </ol>
          ) : (
            version.pages.map((p, i) => (
              <div key={i} className="mb-2">
                {version.pages.length > 1 && <div className="text-xs text-slate-500">Страница {i + 1}</div>}
                <pre className="whitespace-pre-wrap rounded bg-slate-50 p-2 font-sans text-sm text-slate-800">
                  <Highlight text={p} quote={quote} />
                </pre>
              </div>
            ))
          )}
        </div>
      )}
      {tabs.length === 0 && <Empty>Текст документа недоступен.</Empty>}
    </Card>
  );
}

function OriginalText({ url, quote }: { url: string; quote: string | null }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    fetch(url, { cache: "no-store" })
      .then((r) => r.text())
      .then(setText)
      .catch(() => setText(null));
  }, [url]);
  if (text === null) return <Loading />;
  return (
    <pre className="whitespace-pre-wrap rounded bg-slate-50 p-2 font-sans text-sm text-slate-800">
      <Highlight text={text} quote={quote} />
    </pre>
  );
}

function valueDetail(f: Pick<Fact, "value">): string | null {
  const v = f.value;
  switch (v.kind) {
    case "lab_result":
      return `${v.rawName}: ${v.value.raw}${v.unit ? ` ${v.unit}` : ", единицы не указаны"}${v.reference ? `; референс ${v.reference.raw}` : ""}${v.method ? `; метод ${v.method}` : ""}; ${v.origin === "lab_report" ? "бланк лаборатории" : "упоминание, не результат бланка"}`;
    case "medication":
      return `${v.name ?? "Название неизвестно"}; ${v.dose ?? "дозировка не указана"}; ${MEDICATION_STATUS_LABEL[v.status]}`;
    case "appointment":
      return v.attended === "unknown" ? "Посещение неизвестно" : v.attended === "yes" ? "Посещение подтверждено" : "Не посещал(а)";
    case "clarification":
      return v.resolution === "resolved" ? `Ответ: ${v.answer}` : v.resolution === "postponed" ? "Отложено" : "Открыт";
    default:
      return null;
  }
}

function SourceQuote({ f, docId }: { f: Pick<Fact, "sources">; docId: string }) {
  return (
    <>
      {f.sources.map((s, i) => (
        <blockquote key={i} className="mt-1 border-l-2 border-slate-300 pl-2 text-sm text-slate-700">
          «{s.quote}»
          <span className="ml-1 text-xs text-slate-500">
            {s.quoteIsExact ? "точная цитата" : "пересказ, не сверено с оригиналом"}
            {s.page ? `, стр. ${s.page}` : ", страница неизвестна"}
            {s.timecode ? `, ${s.timecode}` : ""}
            {s.speaker ? `, ${SPEAKER_LABEL[s.speaker].toLowerCase()}` : ""}
            {s.documentId !== docId ? (
              <>
                {", "}
                <Link className="text-teal-800 underline" href={`/documents/${s.documentId}`}>
                  другой документ
                </Link>
              </>
            ) : null}
          </span>
        </blockquote>
      ))}
    </>
  );
}

function FactCard({ f, docId, focused }: { f: Fact; docId: string; focused: boolean }) {
  const detail = valueDetail(f);
  const { base, bump } = useProfile();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (a: FactAction | null) => {
    setEditing(false);
    if (!a) return;
    try {
      await postJson(`${base}/facts/${f.id}`, a);
      setError(null);
      bump();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <li id={`fact-${f.id}`} className={`rounded border p-2 ${focused ? "border-amber-400 bg-amber-50" : "border-slate-200"}`} data-focused={focused || undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{TYPE_LABEL[f.type]}</Badge>
        <span className="font-medium">{f.label}</span>
        {f.conflictGroupId && <Badge tone="red">Расхождение с другим источником</Badge>}
      </div>
      {detail && <p className="mt-0.5 text-sm text-slate-700">{detail}</p>}
      <p className="mt-0.5 text-xs text-slate-500">
        Дата события: {formatDateValue(f.eventDate)} · Дата документа: {formatIso(f.documentDate)} · Проверка:{" "}
        {{ unverified: "не проверено вами", confirmed: "подтверждено", corrected: "исправлено вами", rejected: "отклонено" }[f.verification]} · Извлечение:{" "}
        {f.extraction.method === "llm"
          ? `модель ${f.extraction.model ?? ""}`.trim()
          : { prepared: "подготовленный разбор", parser: "разбор текста", manual: "вручную" }[f.extraction.method]}
      </p>
      <SourceQuote f={f} docId={docId} />
      {f.type !== "clarification" && !editing && (
        <button type="button" onClick={() => setEditing(true)} className="mt-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-xs hover:bg-slate-100">
          Исправить
        </button>
      )}
      {editing && <FactEditor fact={f} onDone={save} />}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {f.revisions.length > 1 && (
        <details className="mt-1 text-xs text-slate-600">
          <summary className="cursor-pointer">История изменений ({f.revisions.length})</summary>
          <ol className="mt-1 list-decimal pl-5">
            {f.revisions.map((r, i) => (
              <li key={i}>
                {formatIso(r.at)}: {r.action}
                {r.before?.label && r.after?.label && r.before.label !== r.after.label ? ` «${r.before.label}» → «${r.after.label}»` : ""}
                {r.reason ? ` (${r.reason})` : ""}
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="mt-3">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <p className="text-xs text-slate-500">{hint}</p>
      <ul className="mt-1 space-y-1.5">{children}</ul>
    </section>
  );
}

function ProposalCard({ detail, onApplied }: { detail: Detail; onApplied: () => void }) {
  const { base } = useProfile();
  const items = detail.proposal!.items;
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [postponed, setPostponed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (set: Set<string>, key: string, on: boolean) => {
    const n = new Set(set);
    if (on) n.add(key);
    else n.delete(key);
    return n;
  };
  const group = (g: ProposalItem["group"]) => items.filter((i) => i.group === g);
  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await postJson(`${base}/documents/${detail.document.id}/apply`, { acceptedStateChanges: [...accepted], postponedClarifications: [...postponed] });
      onApplied();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const fromModel = items.some((i) => i.draft.extraction.method === "llm");
  const fromParser = items.some((i) => i.draft.extraction.method === "parser");
  const proposedDate = detail.proposal!.documentDate;
  const patientName = detail.proposal!.patientName;

  return (
    <Card title="Что изменится после применения" actions={fromModel ? <Badge tone="blue">Предложено моделью</Badge> : fromParser ? <Badge tone="green">Разобрано по шаблону, без модели</Badge> : <DemoBadge>Подготовленный разбор</DemoBadge>}>
      {patientName && <p className="mb-2 text-sm text-slate-700">Пациент в бланке: {patientName}</p>}
      {proposedDate && (
        <p className="mb-2 rounded bg-sky-50 p-2 text-sm text-sky-900">
          Дата документа из текста: {formatIso(proposedDate)}. Она будет сохранена при применении; изменить её можно в заголовке документа.
        </p>
      )}
      <Section title={`Предлагается изменить текущее состояние (${group("state_change").length})`} hint="Изменится только то, что вы отметите. Без отметки сведение попадёт только в историю.">
        {group("state_change").map((i) => (
          <li key={i.key} className="rounded border border-teal-200 bg-teal-50/40 p-2 text-sm">
            <label className="flex gap-2">
              <input type="checkbox" checked={accepted.has(i.key)} onChange={(e) => setAccepted(toggle(accepted, i.key, e.target.checked))} className="mt-1" />
              <span>
                <span className="font-medium">
                  {i.stateChange?.medicationStatus ? `Отметить «${i.draft.label}» как принимаемый сейчас` : `Отметить «${i.draft.label}» как актуальное сейчас`}
                </span>
                <span className="block text-xs text-slate-600">{i.explanation}</span>
              </span>
            </label>
          </li>
        ))}
      </Section>
      <Section title={`Нужно уточнить (${group("clarify").length})`} hint="Вопросы появятся в «Моём состоянии». Их можно отложить.">
        {group("clarify").map((i) => (
          <li key={i.key} className="rounded border border-amber-200 bg-amber-50/50 p-2 text-sm">
            <div>{i.draft.label}</div>
            <label className="mt-1 flex items-center gap-1 text-xs text-slate-600">
              <input type="checkbox" checked={postponed.has(i.key)} onChange={(e) => setPostponed(toggle(postponed, i.key, e.target.checked))} /> Отложить
            </label>
          </li>
        ))}
      </Section>
      <Section title={`Добавится в историю (${group("history").length})`} hint="Подтверждать каждую строку не нужно. Всё можно исправить позже.">
        {group("history").map((i) => (
          <li key={i.key} className="rounded border border-slate-200 p-2 text-sm">
            <Badge>{TYPE_LABEL[i.draft.type]}</Badge> <span className="font-medium">{i.draft.label}</span>
            {valueDetail(i.draft) && <div className="text-slate-700">{valueDetail(i.draft)}</div>}
            <div className="text-xs text-slate-500">Дата события: {formatDateValue(i.draft.eventDate)}. {i.explanation}</div>
            <SourceQuote f={i.draft} docId={detail.document.id} />
          </li>
        ))}
      </Section>
      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={apply} disabled={busy} className="rounded bg-teal-700 px-4 py-1.5 text-white disabled:opacity-50">
          {busy ? "Применяю…" : "Применить"}
        </button>
        {error && <span role="alert" className="text-sm text-red-700">{error}</span>}
      </div>
    </Card>
  );
}

export function DocumentDetailView() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const { base, version, bump } = useProfile();
  const detail = useApi<Detail>(`${base}/documents/${params.id}`, version);
  const focusId = search.get("fact");
  const focusSegment = search.get("segment");

  useEffect(() => {
    if (!detail.data || !focusId) return;
    document.getElementById(`fact-${focusId}`)?.scrollIntoView({ block: "center" });
  }, [detail.data, focusId]);

  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return <Loading />;
  const d = detail.data.document;
  const focusFact = detail.data.facts.find((f) => f.id === focusId) ?? null;
  const st = STATUS_LABEL[d.status];

  return (
    <div className="space-y-4">
      <div>
        <Link href="/documents" className="text-sm text-teal-800 underline">
          ← Все документы
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{d.title}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <span>{DOC_KIND_LABEL[d.kind]}</span>
          <DocumentDate doc={d} onSaved={bump} />
          <span>Загружен: {formatDateTime(d.createdAt)}</span>
          {d.specialist && <span>{d.specialist}</span>}
          <Badge tone={st.tone}>{st.text}</Badge>
          {d.isSynthetic && <DemoBadge>Синтетический документ</DemoBadge>}
        </div>
        {search.get("duplicate") && (
          <p role="status" className="mt-2 rounded bg-sky-50 p-2 text-sm text-sky-900">
            Этот документ уже был загружен (тот же файл или копия с тем же текстом). Открыт существующий документ, дубль не создан.
          </p>
        )}
        {d.preparedNotice && <p className="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-900">{d.preparedNotice}</p>}
        {d.statusMessage && <p className="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-900">{d.statusMessage}</p>}
        {detail.data.relatedDocuments.length > 0 && (
          <p className="mt-2 text-sm">
            Документы того же события «{detail.data.encounter?.title}»:{" "}
            {detail.data.relatedDocuments.map((r) => (
              <Link key={r.id} href={`/documents/${r.id}`} className="mr-2 text-teal-800 underline">
                {r.title}
              </Link>
            ))}
          </p>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SourcePane key={focusId ?? "none"} detail={detail.data} focusFact={focusFact} focusSegment={focusSegment} />
        <div className="space-y-4">
          {d.status === "review_pending" && detail.data.proposal && <ProposalCard detail={detail.data} onApplied={bump} />}
          {canParseLocally(d) && <LocalParse doc={d} onDone={bump} />}
          {canSendToModel(d) && <ModelExtract doc={d} onDone={bump} />}
          {!d.sampleKey && <MoveDocument doc={d} otherPatient={detail.data.proposal?.items.some((i) => i.key === `llm:${d.id}:patient`) ?? false} patientName={detail.data.proposal?.patientName ?? null} />}
          {d.status !== "review_pending" && (
            <Card title={`Извлечённые факты (${detail.data.facts.length})`}>
              {detail.data.facts.length === 0 ? (
                <Empty>
                  {d.status === "extraction_ready"
                    ? "Факты ещё не извлечены. Оригинал сохранён; текст, если он есть, доступен слева."
                    : d.status === "extraction_unavailable" || d.status === "recognition_unavailable"
                    ? "Извлечение фактов для этого файла не подключено. Оригинал сохранён; текст, если он есть, доступен слева."
                    : "Фактов нет."}
                </Empty>
              ) : (
                <ul className="space-y-2">
                  {detail.data.facts.map((f) => (
                    <FactCard key={f.id} f={f} docId={d.id} focused={f.id === focusId} />
                  ))}
                </ul>
              )}
              {detail.data.facts.length > 0 && (
                <p className="mt-3 text-sm">
                  Изменения видны в{" "}
                  <Link className="text-teal-800 underline" href="/">
                    «Моём состоянии»
                  </Link>{" "}
                  и{" "}
                  <Link className="text-teal-800 underline" href="/history">
                    «Истории»
                  </Link>
                  .
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

const SENDABLE: SourceDocument["status"][] = ["extraction_ready", "extraction_unavailable", "recognition_unavailable", "error", "applied"];

function canSendToModel(d: SourceDocument) {
  return !d.sampleKey && SENDABLE.includes(d.status);
}

/** Sends one document to the connected model, only after the user ticks the consent box. */
function ModelExtract({ doc, onDone }: { doc: SourceDocument; onDone: () => void }) {
  const { liveModel, base } = useProfile();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!liveModel) return null;
  const again = doc.status === "applied";
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await postJson(`${base}/documents/${doc.id}/extract`, { consent: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onDone();
    }
  };
  return (
    <Card title={again ? "Извлечь факты заново" : "Извлечь факты с помощью модели"}>
      {again && (
        <p className="mb-2 text-sm text-slate-700">
          Модель прочитает документ ещё раз. Совпадающие факты не задвоятся, а недостающие даты дополнятся; исправленное вами не изменится, добавленные ранее факты останутся.
        </p>
      )}
      <p className="text-sm text-slate-700">
        Текст документа (а для PDF без текстового слоя сам файл) будет отправлен в {liveModel.provider}, модель {liveModel.model}. Модель только предлагает факты: вы увидите их в карточке и решите, что добавить. Без вашего согласия ничего не отправляется.
      </p>
      <label className="mt-2 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
        <span>Согласен отправить этот документ в {liveModel.provider}</span>
      </label>
      <button type="button" onClick={send} disabled={!agreed || busy} className="mt-2 rounded bg-teal-700 px-4 py-1.5 text-sm text-white disabled:opacity-50">
        {busy ? "Модель читает документ…" : "Отправить и извлечь факты"}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </Card>
  );
}

/** Shows the document date with an inline editor; facts from this document get the new date too. */
function DocumentDate({ doc, onSaved }: { doc: SourceDocument; onSaved: () => void }) {
  const { base } = useProfile();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(doc.documentDate ?? "");
  const [error, setError] = useState<string | null>(null);
  if (!editing) {
    return (
      <span>
        Дата документа: {formatIso(doc.documentDate)}{" "}
        {!doc.sampleKey && (
          <button type="button" className="text-teal-800 underline" onClick={() => { setValue(doc.documentDate ?? ""); setEditing(true); }}>
            {doc.documentDate ? "изменить" : "указать"}
          </button>
        )}
      </span>
    );
  }
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api(`${base}/documents/${doc.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentDate: value || null }) });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <form onSubmit={save} className="flex items-center gap-2">
      <label className="flex items-center gap-1">
        Дата документа
        <input type="date" value={value} onChange={(e) => setValue(e.target.value)} className="rounded border border-slate-300 px-1 py-0.5" />
      </label>
      <button type="submit" className="rounded bg-teal-700 px-2 py-0.5 text-white">Сохранить</button>
      <button type="button" className="underline" onClick={() => setEditing(false)}>Отмена</button>
      {error && <span role="alert" className="text-red-700">{error}</span>}
    </form>
  );
}

function canParseLocally(d: SourceDocument) {
  return !d.sampleKey && !!d.original && ["extraction_ready", "extraction_unavailable", "applied"].includes(d.status);
}

/** Tries the local lab-form parser: free, instant, and the document stays on this computer. */
/** Moves a document that belongs to someone else (e.g. a child's form) to that person's profile. */
function MoveDocument({ doc, otherPatient, patientName }: { doc: SourceDocument; otherPatient: boolean; patientName: string | null }) {
  const { base, profiles, profile, setProfileId, bump } = useProfile();
  const targets = profiles.filter((p) => !p.isDemo && p.id !== profile?.id);
  const suggested = patientName ? targets.find((p) => p.patientNames?.some((n) => n.toLowerCase() === patientName.toLowerCase())) : undefined;
  const [target, setTarget] = useState(suggested?.id ?? targets[0]?.id ?? "");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const move = async () => {
    setBusy(true);
    setError(null);
    try {
      let to = target;
      if (!to) {
        const p = await postJson<{ id: string }>("/api/profiles", { name: newName });
        to = p.id;
      }
      await postJson(`${base}/documents/${doc.id}/move`, { targetProfileId: to });
      bump();
      setProfileId(to);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const body = (
    <div className="space-y-2 text-sm">
      <p className="text-slate-700">
        {otherPatient
          ? `Бланк выписан на «${patientName}». Если это документ другого человека, перенесите его в его профиль вместе со всем, что из него извлечено.`
          : "Если документ относится к другому человеку, перенесите его в его профиль вместе со всем, что из него извлечено."}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label>
          Перенести в профиль
          <select id="move-target" value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1">
            {targets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="">+ Новый профиль…</option>
          </select>
        </label>
        {!target && (
          <label>
            Имя
            <input id="move-new-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={patientName?.split(" ")[1] ?? "Например, Алиса"} className="mt-1 block rounded border border-slate-300 px-2 py-1" />
          </label>
        )}
        <button type="button" onClick={move} disabled={busy || (!target && !newName.trim())} className="rounded bg-teal-700 px-4 py-1.5 text-white disabled:opacity-50">
          {busy ? "Переношу…" : "Перенести"}
        </button>
      </div>
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </div>
  );
  if (otherPatient) return <Card title="Чей это документ?">{body}</Card>;
  return (
    <details className="rounded-lg border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer text-sm text-slate-700">Документ другого человека? Перенести в другой профиль</summary>
      <div className="mt-2">{body}</div>
    </details>
  );
}

function LocalParse({ doc, onDone }: { doc: SourceDocument; onDone: () => void }) {
  const { base } = useProfile();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await postJson(`${base}/documents/${doc.id}/parse`, {});
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Разобрать бланк без модели">
      <p className="text-sm text-slate-700">
        Бланки анализов известного вида разбираются прямо на этом компьютере: бесплатно и без отправки куда-либо. {doc.status === "applied" && "Совпадающие факты не задвоятся."}
      </p>
      <button type="button" onClick={run} disabled={busy} className="mt-2 rounded border border-teal-700 px-4 py-1.5 text-sm text-teal-800 disabled:opacity-50">
        {busy ? "Разбираю…" : "Разобрать по шаблону"}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </Card>
  );
}
