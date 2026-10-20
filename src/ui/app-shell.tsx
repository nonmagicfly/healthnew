"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { Profile } from "@/core/model";
import { ProfileProvider, useProfile } from "./profile";
import { postJson, useApi } from "./api";
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

const NEW_PROFILE = "__new__";

/** Profile switcher; the last option adds a profile for a family member. */
function ProfilePicker() {
  const { profiles, profile, setProfileId, bump } = useProfile();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (adding)
    return (
      <form
        className="ml-auto flex flex-wrap items-center gap-2 text-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const p = await postJson<Profile>("/api/profiles", { name });
            setAdding(false);
            setName("");
            setError(null);
            bump();
            setProfileId(p.id);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <label className="flex items-center gap-2 text-slate-600">
          Имя нового профиля
          <input id="new-profile-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Алиса" className="rounded-md border border-slate-300 px-2 py-1 text-slate-900" />
        </label>
        <button type="submit" className="rounded-md bg-teal-700 px-3 py-1 text-white">Создать</button>
        <button type="button" onClick={() => setAdding(false)} className="rounded-md border border-slate-300 px-3 py-1">Отмена</button>
        {error && <span role="alert" className="text-red-700">{error}</span>}
      </form>
    );
  return (
    <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
      Профиль
      <select
        value={profile?.id ?? "me"}
        onChange={(e) => (e.target.value === NEW_PROFILE ? setAdding(true) : setProfileId(e.target.value))}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-900"
      >
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.isDemo ? " (синтетические данные)" : ""}
          </option>
        ))}
        <option value={NEW_PROFILE}>+ Новый профиль…</option>
      </select>
    </label>
  );
}

function Header() {
  const { profile, liveModel, base, version } = useProfile();
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
        <ProfilePicker />
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
