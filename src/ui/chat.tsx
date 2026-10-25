"use client";

import { useEffect, useRef, useState } from "react";
import type { AnswerSegment, ChatMessage } from "@/core/model";
import { postJson, useApi } from "./api";
import { useProfile } from "./profile";
import { Badge, Card, DemoBadge, Empty, ErrorState, Loading, SourceLink } from "./common";

const KIND: Record<AnswerSegment["kind"], { label: string; tone: "slate" | "green" | "amber" | "blue" | "red" | "teal" }> = {
  document_fact: { label: "Из документа", tone: "teal" },
  patient_words: { label: "Слова пациента", tone: "blue" },
  summary: { label: "Обобщение", tone: "slate" },
  missing: { label: "Нет сведений", tone: "amber" },
  caution: { label: "Важно", tone: "red" },
};

const EXAMPLES = [
  "Какие препараты мне назначали?",
  "Как менялся ферритин?",
  "Что известно о печёночных показателях?",
  "Какие жалобы меня беспокоят?",
  "Есть ли у меня аллергии?",
];

export function Answer({ m }: { m: ChatMessage }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-800">Ответ</span>
        {m.mode === "demo" && <DemoBadge>Ответ по шаблону, без модели</DemoBadge>}
        {m.mode === "llm" && <Badge tone="blue">Ответ модели; ссылки проверены по вашим фактам</Badge>}
      </div>
      <ul className="space-y-1.5">
        {m.segments.map((s, i) => (
          <li key={i} className="text-sm">
            <Badge tone={KIND[s.kind].tone}>{KIND[s.kind].label}</Badge> <span className="text-slate-800">{s.text}</span>{" "}
            {s.sources.map((src, j) => (
              <span key={j} className="whitespace-nowrap">
                [<SourceLink src={src} factId={s.factIds[j]} />]{" "}
              </span>
            ))}
          </li>
        ))}
      </ul>
      <details className="rounded bg-slate-50 p-2 text-sm">
        <summary className="cursor-pointer text-slate-700">Какой контекст учтён ({m.usedContext.length})</summary>
        <p className="mt-1 text-xs text-slate-500">Текущее состояние профиля учитывается всегда. Ниже факты, найденные локальным поиском по вашей истории. Все источники из личной истории; внешние медицинские сведения не запрашивались.</p>
        {m.usedContext.length === 0 ? (
          <p className="mt-1 text-slate-600">Подходящих фактов не найдено.</p>
        ) : (
          <ul className="mt-1 list-disc pl-5">
            {m.usedContext.map((c) => (
              <li key={c.factId}>
                {c.label} <span className="text-xs text-slate-500">({c.reason})</span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

export function ChatPanel({ compact = false }: { compact?: boolean }) {
  const { base, version, profile, liveModel } = useProfile();
  const history = useApi<ChatMessage[]>(`${base}/chat`, version);
  const [added, setAdded] = useState<ChatMessage[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Off by default: the question and found facts leave the computer only when the user turns this on.
  const [useModel, setUseModel] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const loaded = history.data ?? [];
  const messages = [...loaded, ...added.filter((m) => !loaded.some((l) => l.id === m.id) && m.profileId === profile?.id)];
  useEffect(() => {
    // Block body on purpose: newer browsers return a Promise from scrollIntoView, and an effect must not return it.
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const fresh = await postJson<ChatMessage[]>(`${base}/chat`, { question, useModel: useModel && !!liveModel });
      setAdded((m) => [...m, ...fresh]);
      setQ("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const shown = compact ? messages.slice(-4) : messages;
  return (
    <Card title="Чат" actions={useModel && liveModel ? <Badge tone="blue">{liveModel.provider}</Badge> : <DemoBadge>Ответы по шаблону</DemoBadge>}>
      <p className="mb-3 text-xs text-slate-500">
        Вопросы обрабатываются с учётом текущего состояния {profile?.isDemo ? "демо-профиля" : "вашего профиля"}. Назначения из прошлого не являются рекомендацией принимать препарат сейчас.
      </p>
      <div className={`space-y-4 overflow-y-auto pr-1 ${compact ? "max-h-[55vh]" : "max-h-[65vh]"}`} aria-live="polite">
        {history.error && <ErrorState message={history.error} onRetry={history.reload} />}
        {history.loading && !history.data && <Loading />}
        {history.data && shown.length === 0 && <Empty>Задайте вопрос о жалобах, препаратах, анализах или визитах.</Empty>}
        {shown.map((m) =>
          m.role === "user" ? (
            <p key={m.id} className="ml-auto max-w-[85%] rounded-lg bg-teal-50 px-3 py-2 text-sm text-slate-900">
              {m.text}
            </p>
          ) : (
            <Answer key={m.id} m={m} />
          ),
        )}
        {busy && <Loading text="Собираю ответ…" />}
        <div ref={endRef} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Примеры вопросов">
        {EXAMPLES.map((e) => (
          <button key={e} type="button" onClick={() => ask(e)} disabled={busy} className="rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50">
            {e}
          </button>
        ))}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(q);
        }}
      >
        <label htmlFor={`q-${compact ? "c" : "f"}`} className="sr-only">
          Вопрос
        </label>
        <input
          id={`q-${compact ? "c" : "f"}`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Например: какие препараты мне назначали?"
          className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
        />
        <button type="submit" disabled={busy || !q.trim()} className="rounded bg-teal-700 px-4 py-1.5 text-sm text-white disabled:opacity-50">
          Спросить
        </button>
      </form>
      {liveModel && (
        <label className="mt-2 flex items-start gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={useModel} onChange={(e) => setUseModel(e.target.checked)} className="mt-0.5" />
          <span>
            Отвечать с помощью {liveModel.provider} ({liveModel.model}): вопрос, текущее состояние и найденные факты будут отправлены в {liveModel.provider}. Без отметки ответ собирается локально по шаблону.
          </span>
        </label>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </Card>
  );
}
