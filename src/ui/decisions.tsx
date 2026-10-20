"use client";

import Link from "next/link";
import { useState } from "react";
import type { Fact } from "@/core/model";
import type { Decisions } from "@/core/rules/decisions";
import type { StateItem } from "@/core/rules/state";
import type { FactAction } from "@/core/service";
import { postJson, useApi } from "./api";
import { useProfile } from "./profile";
import { Card, Empty, ErrorState, Loading } from "./common";
import { Item } from "./state-panel";

const GROUPS: { key: "medications" | "complaints" | "conditions" | "questions"; section: string; title: string; hint: string }[] = [
  { key: "medications", section: "otherMedications", title: "Препараты из документов", hint: "Принимаете ли вы их сейчас? Назначение в прошлом не значит, что препарат нужно принимать." },
  { key: "complaints", section: "documentComplaints", title: "Жалобы из документов", hint: "Беспокоит ли это сейчас?" },
  { key: "conditions", section: "undecidedConditions", title: "Диагнозы и проблемы из документов", hint: "Это формулировки врача. Актуальны ли они сейчас?" },
  { key: "questions", section: "openQuestions", title: "Вопросы и незавершённое", hint: "Уточнения, явки и обследования без отметки." },
];

/** One screen with every decision the documents left to the user. */
export function DecisionsView() {
  const { base, version, bump } = useProfile();
  const d = useApi<Decisions>(`${base}/decisions`, version);
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
  if (d.error) return <ErrorState message={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading />;
  const byId = new Map((facts.data ?? []).map((f) => [f.id, f]));
  const list = (items: StateItem[], section: string) => (
    <ul>
      {items.map((i) => (
        <Item key={i.factId} item={i} fact={byId.get(i.factId)} section={section} act={act} />
      ))}
    </ul>
  );

  return (
    <Card title={`Нужно ваше решение${d.data.total ? ` (${d.data.total})` : ""}`}>
      {error && <p role="alert" className="mb-2 text-sm text-red-700">{error}</p>}
      {d.data.total === 0 ? (
        <Empty>Решать ничего не нужно: всё из документов разобрано.</Empty>
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-slate-600">Здесь собрано всё, что документы оставили на ваше решение. Каждое действие сохраняется сразу; исправить его можно в «Моём состоянии».</p>
          {d.data.documents.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Документы</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {d.data.documents.map((doc) => (
                  <li key={doc.documentId}>
                    <Link href={`/documents/${doc.documentId}`} className="font-medium text-teal-800 underline">
                      {doc.title}
                    </Link>{" "}
                    <span className="text-slate-600">{doc.reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {GROUPS.filter((g) => d.data![g.key].length).map((g) => (
            <section key={g.key}>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                {g.title} ({d.data![g.key].length})
              </h3>
              <p className="text-xs text-slate-500">{g.hint}</p>
              {list(d.data![g.key], g.section)}
            </section>
          ))}
          {d.data.conflicts.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Расхождения между источниками ({d.data.conflicts.length})</h3>
              <p className="text-xs text-slate-500">Источники говорят разное. Отклоните неверное; оба варианта остаются в истории правок.</p>
              {d.data.conflicts.map((c) => (
                <div key={c.groupId} className="mt-1 rounded border border-slate-200 px-2">
                  {list(c.items, "conflicts")}
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </Card>
  );
}
