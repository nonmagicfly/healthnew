"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import type { ChatMessage } from "@/core/model";
import { postJson } from "./api";
import { useProfile } from "./profile";
import { Answer } from "./chat";

/** Documents ticked on a page: id → title. */
export function useDocumentSelection() {
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const toggle = (id: string, title: string) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, title);
      return next;
    });
  return { selected, toggle, clear: () => setSelected(new Map()) };
}

export function SelectDocument({
  id,
  title,
  selected,
  toggle,
}: {
  id: string;
  title: string;
  selected: Map<string, string>;
  toggle: (id: string, title: string) => void;
}) {
  return (
    <input
      type="checkbox"
      aria-label={`Выбрать «${title}»`}
      checked={selected.has(id)}
      onChange={() => toggle(id, title)}
      className="mt-1 h-4 w-4 shrink-0"
    />
  );
}

/** A bar at the bottom of the page while documents are ticked; opens a window to ask about them. */
export function AskSelected({
  selected,
  onClear,
}: {
  selected: Map<string, string>;
  onClear: () => void;
}) {
  const { base, liveModel, bump } = useProfile();
  const dialog = useRef<HTMLDialogElement>(null);
  const [question, setQuestion] = useState("");
  const [useModel, setUseModel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<ChatMessage | null>(null);
  if (!selected.size) return null;

  const ask = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const msgs = await postJson<ChatMessage[]>(`${base}/chat/documents`, {
        documentIds: [...selected.keys()],
        question,
        useModel: useModel && !!liveModel,
      });
      setAnswer(msgs.at(-1) ?? null);
      bump();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        role="region"
        aria-label="Выбранные документы"
        className="sticky bottom-0 z-10 mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm print:hidden"
      >
        <span>Выбрано документов: {selected.size}</span>
        <button
          type="button"
          onClick={() => {
            setAnswer(null);
            setError(null);
            dialog.current?.showModal();
          }}
          className="rounded bg-teal-700 px-3 py-1 text-white"
        >
          Спросить по выбранным
        </button>
        <button type="button" onClick={onClear} className="underline">
          Снять выбор
        </button>
      </div>
      <dialog
        ref={dialog}
        aria-label="Вопрос по выбранным документам"
        className="w-[min(640px,calc(100vw-32px))] rounded-lg p-0 backdrop:bg-slate-900/40"
      >
        <form onSubmit={ask} className="space-y-3 p-4">
          <h2 className="text-lg font-semibold">
            Вопрос по выбранным документам
          </h2>
          <ul className="list-disc pl-5 text-sm text-slate-700">
            {[...selected].map(([id, title]) => (
              <li key={id}>{title}</li>
            ))}
          </ul>
          <label className="block text-sm">
            Что хотите узнать
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={4}
              required
              placeholder="Например: что изменилось между этими приёмами и что врач рекомендовал в итоге?"
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1"
            />
          </label>
          {liveModel ? (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={useModel}
                onChange={(e) => setUseModel(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Отправить текст выбранных документов и их факты в{" "}
                {liveModel.provider} ({liveModel.model}). Без отметки ответ
                собирается локально по фактам из этих документов.
              </span>
            </label>
          ) : (
            <p className="text-sm text-slate-600">
              Модель не подключена: ответ соберётся локально по фактам из этих
              документов.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          {answer && (
            <div className="rounded border border-slate-200 p-2">
              <Answer m={answer} />
              <Link
                href="/chat"
                className="mt-2 inline-block text-sm text-teal-800 underline"
              >
                Вопрос и ответ сохранены в чате
              </Link>
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !question.trim()}
              className="rounded bg-teal-700 px-3 py-1 text-white disabled:opacity-50"
            >
              {busy ? "Спрашиваю…" : "Спросить"}
            </button>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="rounded border border-slate-300 px-3 py-1"
            >
              Закрыть
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
