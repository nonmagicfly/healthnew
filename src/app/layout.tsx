import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { AppShell } from "@/ui/app-shell";

export const metadata: Metadata = {
  title: "История здоровья",
  description: "Личная история здоровья: документы, показатели, состояние и вопросы с источниками.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="min-h-full">
        <Suspense fallback={<p className="p-6 text-slate-500">Загрузка…</p>}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
