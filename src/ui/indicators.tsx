"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { IndicatorSummary, IndicatorView, Series, TimelineMark } from "@/core/rules/series";
import { useApi } from "./api";
import { useProfile } from "./profile";
import { Badge, Card, Empty, ErrorState, formatIso, Loading } from "./common";

const COLORS = ["#0f766e", "#4338ca", "#b45309", "#be185d"];
const W = 680;
const H = 260;
const PAD = { l: 48, r: 16, t: 16, b: 56 };

const toTime = (d: string) => new Date(`${d}T00:00:00Z`).getTime();

function Chart({ view }: { view: IndicatorView }) {
  const points = view.series.flatMap((s) => s.points);
  if (!points.length) return null;
  const dates = [...points.map((p) => toTime(p.date)), ...view.marks.map((m) => toTime(m.date))];
  let x0 = Math.min(...dates);
  let x1 = Math.max(...dates);
  if (x0 === x1) {
    x0 -= 30 * 864e5;
    x1 += 30 * 864e5;
  }
  const refs = points.flatMap((p) => [p.reference?.low, p.reference?.high]).filter((v): v is number => typeof v === "number");
  const vals = [...points.map((p) => p.value), ...refs];
  const y0 = Math.min(0, ...vals);
  let y1 = Math.max(...vals) * 1.15 || 1;
  if (y0 === y1) y1 = y0 + 1;
  const x = (t: number) => PAD.l + ((t - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - ((v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
  const ticks = [y0, (y0 + y1) / 2, y1];
  // Treatment and symptom lines are numbered on the chart and named in the list below, so labels never overlap.
  const markGroups: { date: string; marks: { n: number; mark: TimelineMark }[] }[] = [];
  [...view.marks]
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((mark, i) => {
      const g = markGroups.find((x) => x.date === mark.date);
      if (g) g.marks.push({ n: i + 1, mark });
      else markGroups.push({ date: mark.date, marks: [{ n: i + 1, mark }] });
    });
  const sameRef = view.series.length === 1 && new Set(view.series[0].points.map((p) => p.reference?.raw ?? "")).size === 1 ? view.series[0].points[0].reference : null;

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="group" aria-label={`График: ${view.indicator.name}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#e5e7eb" />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#6b7280">
              {t >= 10 ? Math.round(t) : Math.round(t * 100) / 100}
            </text>
          </g>
        ))}
        {sameRef && (sameRef.low !== null || sameRef.high !== null) && (
          <rect
            x={PAD.l}
            width={W - PAD.l - PAD.r}
            y={y(sameRef.high ?? y1)}
            height={Math.max(0, y(sameRef.low ?? y0) - y(sameRef.high ?? y1))}
            fill="#0f766e"
            opacity="0.07"
          >
            <title>Референс лаборатории: {sameRef.raw}</title>
          </rect>
        )}
        {markGroups.map((g) => {
          const mx = x(toTime(g.date));
          const treatment = g.marks.some((m) => m.mark.kind === "treatment");
          const right = mx > W - 60;
          return (
            <g key={g.date}>
              <title>{g.marks.map((m) => `${m.n}. ${m.mark.label}, ${formatIso(g.date)}`).join("\n")}</title>
              <line x1={mx} x2={mx} y1={PAD.t} y2={H - PAD.b} stroke={treatment ? "#b45309" : "#64748b"} strokeDasharray="4 3" />
              <text x={right ? mx - 3 : mx + 3} y={PAD.t + 10} textAnchor={right ? "end" : "start"} fontSize="10" fill={treatment ? "#92400e" : "#475569"}>
                {g.marks.map((m) => m.n).join(",")}
              </text>
            </g>
          );
        })}
        {view.series.map((s: Series, si) => {
          const c = COLORS[si % COLORS.length];
          return (
            <g key={s.key}>
              {s.points.length > 1 && (
                <polyline fill="none" stroke={c} strokeWidth="2" points={s.points.map((p) => `${x(toTime(p.date))},${y(p.value)}`).join(" ")} />
              )}
              {s.points.map((p) => (
                <a
                  key={p.factId}
                  href={`/documents/${p.documentId}?fact=${p.factId}`}
                  aria-label={`${view.indicator.name} ${p.raw} ${s.unit ?? ""}, ${p.dateBasis === "document" ? `дата документа ${formatIso(p.date)}, дата забора неизвестна` : formatIso(p.date)}. Открыть источник`}
                >
                  <circle cx={x(toTime(p.date))} cy={y(p.value)} r="6" fill={p.dateBasis === "document" ? "white" : c} stroke={c} strokeWidth="2.5" />
                  <text x={x(toTime(p.date))} y={y(p.value) - 10} textAnchor="middle" fontSize="11" fill="#111827">
                    {p.raw}
                  </text>
                  <text x={x(toTime(p.date))} y={H - PAD.b + 16} textAnchor="middle" fontSize="11" fill="#6b7280">
                    {formatIso(p.date)}
                  </text>
                </a>
              ))}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {view.series.map((s, i) => (
          <span key={s.key}>
            <span className="mr-1 inline-block h-2 w-3 align-middle" style={{ background: COLORS[i % COLORS.length] }} />
            {s.unit ?? "единицы не указаны"}
            {s.method ? `, ${s.method}` : ""}
          </span>
        ))}
        {view.series.length > 1 && <span>Разные единицы или методы показаны отдельными линиями, без пересчёта.</span>}
        {points.some((p) => p.dateBasis === "document") && <span>Полый маркер: дата забора неизвестна, точка стоит по дате документа.</span>}
        {view.marks.length > 0 && <span>Пунктир: лечение и симптомы. Совпадение по времени не доказывает причинную связь.</span>}
        {sameRef && <span>Заливка: референс лаборатории {sameRef.raw}.</span>}
      </figcaption>
      {markGroups.length > 0 && (
        <ol className="mt-2 grid gap-x-4 text-xs text-slate-600 sm:grid-cols-2">
          {markGroups.flatMap((g) =>
            g.marks.map((m) => (
              <li key={m.mark.factId}>
                {m.n}. {m.mark.label}, {formatIso(g.date)} <span className="text-slate-400">({m.mark.kind === "treatment" ? "лечение" : "симптом"})</span>
              </li>
            )),
          )}
        </ol>
      )}
    </figure>
  );
}

const VALUE_TYPE: Record<string, string> = {
  numeric: "число",
  less_than: "меньше",
  greater_than: "больше",
  range: "диапазон",
  approximate: "приблизительно",
  qualitative: "качественный",
};

export function IndicatorDetail({ code, period }: { code: string; period: { from: string; to: string } }) {
  const { base, version } = useProfile();
  const q = new URLSearchParams({ from: period.from, to: period.to });
  const view = useApi<IndicatorView>(`${base}/indicators/${code}?${q}`, version);
  if (view.error) return <ErrorState message={view.error} onRetry={view.reload} />;
  if (!view.data) return <Loading />;
  const v = view.data;
  const plotted = v.series.reduce((n, s) => n + s.points.length, 0);
  return (
    <div className="space-y-4">
      {v.rows.length === 0 && v.qualitative.length === 0 ? (
        <Empty>
          Результатов для показателя «{v.indicator.name}» нет. Загрузите лабораторный бланк в разделе{" "}
          <Link className="text-teal-800 underline" href="/documents">
            «Документы»
          </Link>
          .
        </Empty>
      ) : plotted === 0 ? (
        <Empty>На графике нет точек: нет результатов лабораторных бланков с известной датой в выбранном периоде. Упоминания и качественные описания перечислены ниже.</Empty>
      ) : (
        <>
          <Chart view={v} />
          {plotted === 1 && <p className="text-sm text-slate-600">Пока одно измерение, динамики нет.</p>}
        </>
      )}

      {v.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Результаты: {v.indicator.name}</caption>
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1 pr-3">Значение</th>
                <th className="py-1 pr-3">Единицы</th>
                <th className="py-1 pr-3">Референс</th>
                <th className="py-1 pr-3">Метод</th>
                <th className="py-1 pr-3">Дата забора</th>
                <th className="py-1 pr-3">Дата документа</th>
                <th className="py-1 pr-3">Происхождение</th>
                <th className="py-1">Источник</th>
              </tr>
            </thead>
            <tbody>
              {v.rows.map((r) => (
                <tr key={r.factId} className="border-t border-slate-100 align-top">
                  <td className="py-1.5 pr-3 font-medium">
                    {r.raw} <span className="text-xs font-normal text-slate-500">({VALUE_TYPE[r.valueType]})</span>
                    {r.flag === "high" && <Badge tone="amber">выше референса</Badge>}
                    {r.flag === "low" && <Badge tone="amber">ниже референса</Badge>}
                  </td>
                  <td className="py-1.5 pr-3">{r.unit ?? <span className="text-slate-500">не указаны</span>}</td>
                  <td className="py-1.5 pr-3">{r.reference ?? "—"}</td>
                  <td className="py-1.5 pr-3">{r.method ?? "—"}</td>
                  <td className="py-1.5 pr-3">{r.collected}</td>
                  <td className="py-1.5 pr-3">{formatIso(r.documentDate)}</td>
                  <td className="py-1.5 pr-3">
                    {r.origin === "lab_report" ? <Badge tone="green">Бланк лаборатории</Badge> : <Badge tone="amber">Упоминание в консультации или разговоре</Badge>}
                    {r.notPlottedReason && <div className="text-xs text-slate-500">Не на графике: {r.notPlottedReason.toLowerCase()}</div>}
                  </td>
                  <td className="py-1.5">
                    <Link className="text-teal-800 underline" href={`/documents/${r.documentId}?fact=${r.factId}`}>
                      Открыть фрагмент
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {v.qualitative.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Качественные упоминания без числа</h3>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {v.qualitative.map((qf) => (
              <li key={qf.factId}>
                «{qf.text}», документ от {formatIso(qf.documentDate)}.{" "}
                <Link className="text-teal-800 underline" href={`/documents/${qf.documentId}?fact=${qf.factId}`}>
                  Источник
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function useIndicatorList() {
  const { base, version } = useProfile();
  return useApi<IndicatorSummary[]>(`${base}/indicators`, version);
}

export function IndicatorsView() {
  const list = useIndicatorList();
  const params = useSearchParams();
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const code = params.get("code") ?? list.data?.find((i) => i.results + i.mentions + i.qualitative > 0)?.code ?? "ferritin";

  if (list.error) return <ErrorState message={list.error} onRetry={list.reload} />;
  if (!list.data) return <Loading />;
  const groups = [...new Set(list.data.map((i) => i.group))];
  const current = list.data.find((i) => i.code === code);

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <Card title="Показатели">
        <label className="block text-sm text-slate-600" htmlFor="indicator-select">
          Показатель
        </label>
        <select
          id="indicator-select"
          value={code}
          onChange={(e) => router.replace(`/indicators?code=${e.target.value}`)}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
        >
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {list.data!.filter((i) => i.group === g).map((i) => (
                <option key={i.code} value={i.code}>
                  {i.name} ({i.results} рез., {i.mentions} упом.)
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <fieldset className="mt-4 space-y-2">
          <legend className="text-sm text-slate-600">Период</legend>
          <label className="block text-sm">
            с <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="ml-1 rounded border border-slate-300 px-1" />
          </label>
          <label className="block text-sm">
            по <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="ml-1 rounded border border-slate-300 px-1" />
          </label>
          {(from || to) && (
            <button type="button" className="text-sm text-teal-800 underline" onClick={() => (setFrom(""), setTo(""))}>
              Весь период
            </button>
          )}
        </fieldset>
        <p className="mt-4 text-xs text-slate-500">Приоритет: ферритин, липидный профиль, печёночные показатели. Показаны также все показатели, по которым есть данные.</p>
      </Card>
      <Card title={current ? `${current.name}` : "Показатель"}>
        <IndicatorDetail code={code} period={{ from, to }} />
      </Card>
    </div>
  );
}

/** Compact list for the main screen. */
export function IndicatorSummaryCard() {
  const list = useIndicatorList();
  if (list.error) return <ErrorState message={list.error} onRetry={list.reload} />;
  if (!list.data) return <Loading />;
  const withData = list.data.filter((i) => i.results + i.mentions + i.qualitative > 0);
  return (
    <Card title="Выбранные показатели" actions={<Link href="/indicators" className="text-sm text-teal-800 underline">Все показатели</Link>}>
      {withData.length === 0 ? (
        <Empty>Данных по показателям пока нет.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {withData.map((i) => (
            <li key={i.code} className="flex items-center justify-between py-1.5 text-sm">
              <Link href={`/indicators?code=${i.code}`} className="font-medium text-teal-800 underline">
                {i.name}
              </Link>
              <span className="text-slate-600">
                {counts(i)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** «1 результат», «3 результата», «5 результатов». */
function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  return `${n} ${m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many}`;
}

/** Only what there is: an empty count says nothing and reads like a problem. */
function counts(i: { results: number; mentions: number; qualitative: number }) {
  return [
    i.results > 0 && `${plural(i.results, "результат", "результата", "результатов")} в бланках`,
    i.mentions > 0 && `${plural(i.mentions, "упоминание", "упоминания", "упоминаний")} у врача`,
    i.qualitative > 0 && `${plural(i.qualitative, "запись", "записи", "записей")} без числа`,
  ]
    .filter(Boolean)
    .join(" · ");
}
