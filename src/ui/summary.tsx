"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { DoctorSummary, SummaryLab } from "@/core/rules/summary";
import type { StateItem } from "@/core/rules/state";
import { useApi } from "./api";
import { useProfile } from "./profile";
import { Badge, Card, ErrorState, formatIso, Loading } from "./common";

const CHANGE: Record<NonNullable<SummaryLab["change"]>, string> = { up: "↑ выше прошлого", down: "↓ ниже прошлого", same: "= как в прошлый раз" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="break-inside-avoid">
      <h3 className="border-b border-slate-200 pb-1 text-sm font-semibold uppercase tracking-wide text-slate-600">{title}</h3>
      <div className="mt-1.5 text-sm">{children}</div>
    </section>
  );
}

function Items({ items, empty, doc }: { items: StateItem[]; empty: string; doc: (id: string) => string }) {
  if (!items.length) return <p className="text-slate-500">{empty}</p>;
  return (
    <ul className="space-y-0.5">
      {items.map((i) => (
        <li key={i.factId}>
          <span className="font-medium">{i.label}</span>
          {i.detail && <span className="text-slate-600">; {i.detail}</span>}
          <span className="text-slate-500">; {i.date}</span>
          {i.documentIds[0] && (
            <Link href={`/documents/${i.documentIds[0]}`} className="ml-1 text-teal-800 underline print:no-underline">
              [{doc(i.documentIds[0])}]
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Overview to show or print for a doctor; assembled locally from stored facts. */
export function DoctorSummaryView() {
  const { base, version, profile, docTitle } = useProfile();
  const s = useApi<DoctorSummary>(`${base}/summary`, version);
  if (s.error) return <ErrorState message={s.error} onRetry={s.reload} />;
  if (!s.data) return <Loading />;
  const d = s.data;
  const today = new Date().toLocaleDateString("ru-RU");
  return (
    <Card
      title={`Сводка для врача: ${profile?.name ?? ""}`}
      actions={
        <button type="button" onClick={() => window.print()} className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-100 print:hidden">
          Печать или PDF
        </button>
      }
    >
      <p className="mb-4 text-xs text-slate-500">
        Составлено {today} из документов в приложении ({d.documentCount}). Только сведения из документов и ваши отметки, без интерпретации; рекомендаций не содержит.
      </p>
      <div className="grid gap-5">
        <Section title="Принимаемые препараты (подтверждено пациентом)">
          <Items items={d.takingMedications} empty="Приём препаратов не подтверждён." doc={docTitle} />
        </Section>
        <Section title="Аллергии">
          {d.allergiesUnknown ? <p className="text-slate-500">Сведений нет. Это не означает, что аллергий нет.</p> : <Items items={d.allergies} empty="" doc={docTitle} />}
        </Section>
        <Section title="Актуальные жалобы">
          <Items items={d.currentComplaints} empty="Нет жалоб, подтверждённых как актуальные." doc={docTitle} />
        </Section>
        <Section title="Диагнозы и проблемы (формулировки врачей)">
          {d.conditions.length ? (
            <ul className="space-y-0.5">
              {d.conditions.map((c) => (
                <li key={c.factId}>
                  <span className="font-medium">{c.label}</span>
                  <span className="text-slate-500">; {c.date}</span> {!c.confirmed && <span className="text-xs text-amber-800">актуальность не подтверждена</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-500">В документах нет формулировок диагнозов.</p>
          )}
        </Section>
        <Section title="Анализы: последние результаты">
          {d.labs.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm tabular-nums">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Показатель</th>
                    <th className="py-1 pr-3 font-medium">Результат</th>
                    <th className="py-1 pr-3 font-medium">Референс лаборатории</th>
                    <th className="py-1 pr-3 font-medium">Дата</th>
                    <th className="py-1 font-medium">Предыдущий</th>
                  </tr>
                </thead>
                <tbody>
                  {d.labs.map((l) => (
                    <tr key={l.code} className="border-t border-slate-100 align-top">
                      <td className="py-1 pr-3">
                        <Link href={`/documents/${l.documentId}?fact=${l.factId}`} className="text-teal-900 underline decoration-slate-300 print:no-underline">
                          {l.name}
                        </Link>
                      </td>
                      <td className="py-1 pr-3 font-medium">
                        {l.raw} {l.unit ?? ""}{" "}
                        {l.flag === "high" && <Badge tone="red">выше референса</Badge>}
                        {l.flag === "low" && <Badge tone="amber">ниже референса</Badge>}
                      </td>
                      <td className="py-1 pr-3 text-slate-600">{l.reference ?? "не указан"}</td>
                      <td className="py-1 pr-3">{formatIso(l.date)}</td>
                      <td className="py-1 text-slate-600">{l.previous ? `${l.previous.raw} от ${formatIso(l.previous.date)}${l.change ? `, ${CHANGE[l.change]}` : ""}` : "нет"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-slate-500">Результатов лабораторных бланков с датой нет.</p>
          )}
        </Section>
        <Section title="Последние визиты и обследования">
          {d.recentVisits.length ? (
            <ul className="space-y-0.5">
              {d.recentVisits.map((v) => (
                <li key={v.documentId}>
                  {formatIso(v.date)}: <Link href={`/documents/${v.documentId}`} className="underline print:no-underline">{v.label}</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-500">Нет визитов с известной датой.</p>
          )}
        </Section>
        {d.upcoming.length > 0 && (
          <Section title="Запланировано">
            <ul className="space-y-0.5">
              {d.upcoming.map((v, i) => (
                <li key={i}>
                  {formatIso(v.date)}: {v.label}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </Card>
  );
}
