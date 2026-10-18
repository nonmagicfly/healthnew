"use client";

import Link from "next/link";
import { useState } from "react";
import type { TimelineGroup } from "@/core/rules/timeline";
import { useApi } from "./api";
import { useProfile } from "./profile";
import { Badge, Card, Empty, ErrorState, Loading } from "./common";

const KIND_LABEL: Record<string, string> = {
  visit: "Визит",
  lab: "Анализ",
  examination: "Обследование",
  symptom: "Симптом",
  treatment: "Лечение",
  procedure: "Процедура",
  note: "Заметка",
  result: "Результат",
};

const CERTAINTY: Record<string, { text: string; tone: "green" | "amber" | "red" }> = {
  exact: { text: "точная дата", tone: "green" },
  approx: { text: "приблизительно", tone: "amber" },
  unknown: { text: "дата неизвестна", tone: "red" },
};

export function HistoryView() {
  const { base, version, docTitle } = useProfile();
  const [by, setBy] = useState<"date" | "problem" | "specialist">("date");
  const t = useApi<TimelineGroup[]>(`${base}/timeline?groupBy=${by}`, version);

  return (
    <Card
      title="История"
      actions={
        <label className="text-sm text-slate-600">
          Группировать{" "}
          <select value={by} onChange={(e) => setBy(e.target.value as typeof by)} className="rounded border border-slate-300 px-2 py-1 text-slate-900">
            <option value="date">по годам</option>
            <option value="problem">по проблеме здоровья</option>
            <option value="specialist">по специалисту</option>
          </select>
        </label>
      }
    >
      {t.error && <ErrorState message={t.error} onRetry={t.reload} />}
      {!t.data && !t.error && <Loading />}
      {t.data && t.data.length === 0 && <Empty>Хронология пуста. Добавьте документы или заметки.</Empty>}
      <div className="space-y-5">
        {t.data?.map((g) => (
          <section key={g.key} aria-labelledby={`g-${g.key}`}>
            <h3 id={`g-${g.key}`} className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              {g.title}
            </h3>
            <ol className="space-y-2 border-l-2 border-slate-200 pl-4">
              {g.entries.map((e) => (
                <li key={e.id} className="relative">
                  <span className={`absolute -left-[23px] top-1.5 h-3 w-3 rounded-full border-2 ${e.certainty === "exact" ? "border-teal-700 bg-teal-700" : "border-slate-400 bg-white"}`} aria-hidden />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-slate-600">{e.date}</span>
                    <Badge tone={CERTAINTY[e.certainty].tone}>{CERTAINTY[e.certainty].text}</Badge>
                    <Badge>{KIND_LABEL[e.kind]}</Badge>
                    <span className="font-medium">{e.title}</span>
                    {e.specialist && <span className="text-sm text-slate-600">{e.specialist}</span>}
                  </div>
                  {e.note && <p className="text-xs text-slate-500">{e.note}</p>}
                  {e.kind === "visit" || e.kind === "lab" ? (
                    e.items.length > 0 && (
                      <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
                        {e.items.map((i) => (
                          <li key={i.factId}>
                            <Link href={`/documents/${e.documentIds[0]}?fact=${i.factId}`} className="hover:underline">
                              {i.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )
                  ) : null}
                  <p className="mt-0.5 text-sm">
                    {e.documentIds.map((id) => (
                      <Link key={id} href={`/documents/${id}${e.factIds.length === 1 ? `?fact=${e.factIds[0]}` : ""}`} className="mr-3 text-teal-800 underline">
                        {docTitle(id)}
                      </Link>
                    ))}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </Card>
  );
}
