"use client";

import Link from "next/link";
import type { DoctorFolder, Visit, VisitLine } from "@/core/rules/doctors";
import { useApi } from "./api";
import { useProfile } from "./profile";
import {
  AskSelected,
  SelectDocument,
  useDocumentSelection,
} from "./ask-documents";
import { Badge, Card, Empty, ErrorState, formatIso, Loading } from "./common";

function Lines({ title, items }: { title: string; items: VisitLine[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-1 text-sm">
      <span className="text-slate-500">{title}: </span>
      {items.map((i) => i.label).join("; ")}
    </div>
  );
}

function VisitCard({
  v,
  selection,
}: {
  v: Visit;
  selection: ReturnType<typeof useDocumentSelection>;
}) {
  const d = v.document;
  const empty =
    !v.complaints.length &&
    !v.diagnoses.length &&
    !v.prescriptions.length &&
    !v.examinations.length &&
    !v.nextVisit;
  return (
    <li className="flex gap-2 py-2">
      <SelectDocument
        id={d.id}
        title={d.title}
        selected={selection.selected}
        toggle={selection.toggle}
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-600">
            {formatIso(d.documentDate)}
          </span>
          <Link
            href={`/documents/${d.id}`}
            className="font-medium text-teal-800 underline"
          >
            {d.title}
          </Link>
          {d.kind === "transcript" && (
            <Badge tone="blue">Запись разговора</Badge>
          )}
          {d.institution && (
            <span className="text-xs text-slate-500">{d.institution}</span>
          )}
        </div>
        <Lines title="Жалобы" items={v.complaints} />
        <Lines title="Диагнозы" items={v.diagnoses} />
        <Lines title="Назначения" items={v.prescriptions} />
        <Lines title="Обследования" items={v.examinations} />
        {v.nextVisit && (
          <div className="mt-1 text-sm">
            <span className="text-slate-500">Повторная явка: </span>
            {formatIso(v.nextVisit)}
          </div>
        )}
        {empty && (
          <p className="mt-1 text-sm text-slate-500">
            {v.factCount
              ? "Заключений в фактах нет."
              : "Факты из документа ещё не добавлены в историю."}
          </p>
        )}
      </div>
    </li>
  );
}

function Folder({
  f,
  selection,
}: {
  f: DoctorFolder;
  selection: ReturnType<typeof useDocumentSelection>;
}) {
  const all = f.visits.every((v) => selection.selected.has(v.document.id));
  const selectAll = () => {
    for (const v of f.visits)
      if (all === selection.selected.has(v.document.id))
        selection.toggle(v.document.id, v.document.title);
  };
  return (
    <Card
      title={`${f.label} · ${f.visits.length} ${f.visits.length === 1 ? "документ" : f.visits.length < 5 ? "документа" : "документов"}`}
      actions={
        <button
          type="button"
          onClick={selectAll}
          className="text-sm text-teal-800 underline"
        >
          {all ? "Снять выбор" : "Выбрать все"}
        </button>
      }
    >
      {(f.latestDiagnoses.length > 0 ||
        f.latestPrescriptions.length > 0 ||
        f.nextVisit ||
        f.institutions.length > 0) && (
        <div className="mb-2 rounded bg-slate-50 p-2">
          <div className="text-sm font-semibold text-slate-700">
            Последнее заключение
          </div>
          <Lines title="Диагнозы" items={f.latestDiagnoses} />
          <Lines title="Назначения" items={f.latestPrescriptions} />
          {f.nextVisit && (
            <div className="mt-1 text-sm">
              <span className="text-slate-500">Следующая явка: </span>
              {formatIso(f.nextVisit)}
            </div>
          )}
          {f.institutions.length > 0 && (
            <div className="mt-1 text-sm">
              <span className="text-slate-500">Клиники: </span>
              {f.institutions.join(", ")}
            </div>
          )}
        </div>
      )}
      <ul className="divide-y divide-slate-100">
        {f.visits.map((v) => (
          <VisitCard key={v.document.id} v={v} selection={selection} />
        ))}
      </ul>
    </Card>
  );
}

/** Consultations and recorded conversations by specialty, each summed up from its stored facts. */
export function DoctorsView() {
  const { base, version } = useProfile();
  const data = useApi<DoctorFolder[]>(`${base}/doctors`, version);
  const selection = useDocumentSelection();
  if (data.error)
    return <ErrorState message={data.error} onRetry={data.reload} />;
  if (!data.data) return <Loading />;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Врачи</h1>
        <p className="mt-1 max-w-prose text-sm text-slate-600">
          Консультации и записи разговоров по специальностям. Выжимка каждого
          приёма собрана из фактов, разобранных из документа, без модели.
          Отметьте документы, чтобы задать по ним вопрос.
        </p>
      </div>
      {data.data.length === 0 ? (
        <Empty>Консультаций пока нет.</Empty>
      ) : (
        data.data.map((f) => <Folder key={f.key} f={f} selection={selection} />)
      )}
      <AskSelected selected={selection.selected} onClear={selection.clear} />
    </div>
  );
}
