"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { SourceRef } from "@/core/model";
import { useProfile } from "./profile";
import { SPEAKER_LABEL } from "@/core/rules/transcript";

export function Card({ title, children, actions, id }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <section id={id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Loading({ text = "Загрузка…" }: { text?: string }) {
  return (
    <p role="status" aria-live="polite" className="text-sm text-slate-500">
      {text}
    </p>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <p>Не удалось загрузить данные: {message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 rounded border border-red-300 bg-white px-3 py-1 text-red-800 hover:bg-red-100">
          Повторить
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">{children}</div>;
}

export function Badge({ children, tone = "slate", title }: { children: ReactNode; tone?: "slate" | "green" | "amber" | "red" | "blue" | "teal"; title?: string }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-green-100 text-green-800",
    amber: "bg-amber-100 text-amber-900",
    red: "bg-red-100 text-red-800",
    blue: "bg-sky-100 text-sky-800",
    teal: "bg-teal-100 text-teal-800",
  };
  return (
    <span title={title} className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function DemoBadge({ children = "Демонстрация" }: { children?: ReactNode }) {
  return <Badge tone="amber">{children}</Badge>;
}

export function sourceHref(src: SourceRef, factId?: string) {
  const q = new URLSearchParams();
  if (factId) q.set("fact", factId);
  if (src.segmentId) q.set("segment", src.segmentId);
  const s = q.toString();
  return `/documents/${src.documentId}${s ? `?${s}` : ""}`;
}

/** Link from a fact, result or answer to the exact place in the source document. */
export function SourceLink({ src, factId, compact = false }: { src: SourceRef; factId?: string; compact?: boolean }) {
  const { docTitle } = useProfile();
  const where = [
    src.page ? `стр. ${src.page}` : null,
    src.timecode ? `таймкод ${src.timecode}` : null,
    src.speaker ? SPEAKER_LABEL[src.speaker].toLowerCase() : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Link href={sourceHref(src, factId)} className="text-sm text-teal-800 underline decoration-teal-300 underline-offset-2 hover:text-teal-950">
      {compact ? "источник" : docTitle(src.documentId)}
      {where && !compact ? ` (${where})` : ""}
    </Link>
  );
}

export const DOC_KIND_LABEL: Record<string, string> = {
  lab_report: "Анализ",
  consultation: "Консультация",
  examination: "Обследование",
  transcript: "Расшифровка разговора",
  note: "Заметка",
  other: "Другое",
};

export const STATUS_LABEL: Record<string, { text: string; tone: "slate" | "green" | "amber" | "red" | "blue" }> = {
  stored: { text: "Сохранён", tone: "slate" },
  recognized: { text: "Текст распознан", tone: "blue" },
  recognition_unavailable: { text: "Распознавание недоступно", tone: "amber" },
  extraction_unavailable: { text: "Извлечение не подключено", tone: "amber" },
  extraction_ready: { text: "Можно извлечь факты", tone: "blue" },
  review_pending: { text: "Ожидает проверки", tone: "blue" },
  applied: { text: "Добавлен в историю", tone: "green" },
  error: { text: "Ошибка", tone: "red" },
};

/** Upload time in the viewer's local time zone: "19.10.2026, 10:05". */
export function formatDateTime(at: string) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatIso(d: string | null) {
  return d ? d.slice(0, 10).split("-").reverse().join(".") : "не указана";
}
