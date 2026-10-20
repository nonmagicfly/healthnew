"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ProfileProvider, useProfile } from "./profile";
import { useApi } from "./api";
import type { Decisions } from "@/core/rules/decisions";

const NAV = [
  { href: "/", label: "Моё состояние" },
  { href: "/indicators", label: "Показатели" },
  { href: "/documents", label: "Документы" },
  { href: "/decisions", label: "Решения" },
  { href: "/history", label: "История" },
  { href: "/chat", label: "Чат" },
  { href: "/summary", label: "Сводка для врача" },
];

function Header() {
  const { profiles, profile, setProfileId, liveModel, base, version } = useProfile();
  const pending = useApi<Decisions>(`${base}/decisions`, version).data?.total ?? 0;
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <header className="border-b border-slate-200 bg-white print:hidden">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-semibold text-slate-900">
          История здоровья
        </Link>
        <nav aria-label="Разделы" className="flex flex-wrap gap-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm ${active(n.href) ? "bg-teal-700 text-white" : "text-slate-700 hover:bg-slate-100"}`}
            >
              {n.label}
              {n.href === "/decisions" && pending > 0 && (
                <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white" aria-label={`ждут решения: ${pending}`}>
                  {pending}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
          Профиль
          <select
            value={profile?.id ?? "me"}
            onChange={(e) => setProfileId(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-900"
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isDemo ? " (синтетические данные)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="border-t border-amber-200 bg-amber-50 text-sm text-amber-900">
        <p className="mx-auto max-w-7xl px-4 py-1.5">
          {profile?.isDemo ? (
            <strong>Демо-профиль: синтетические данные. </strong>
          ) : null}
          {liveModel
            ? `Подключена модель ${liveModel.provider} (${liveModel.model}). Документы и вопросы отправляются ей только по вашему явному действию; остальные данные хранятся только на этом компьютере.`
            : "Прототип в демонстрационном режиме: разбор документов подготовлен заранее только для встроенных примеров, ответы чата собираются по шаблону, LLM и OCR не подключены. Данные хранятся только на этом компьютере."}
        </p>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ProfileProvider>
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-5">{children}</main>
    </ProfileProvider>
  );
}
