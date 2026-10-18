"use client";

import { useRef, useState, type RefObject } from "react";

/**
 * File input with a Russian-labelled button. The native input stays in the form
 * (visually hidden) so FormData and keyboard/screen-reader access keep working.
 * `autoSubmit` submits the form right after a file is chosen from the dialog.
 */
export function FilePicker({ label, accept, inputRef, autoSubmit = false }: { label: string; accept: string; inputRef?: RefObject<HTMLInputElement | null>; autoSubmit?: boolean }) {
  const own = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? own;
  const [name, setName] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={ref}
        name="file"
        type="file"
        accept={accept}
        aria-label={label}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          setName(f?.name ?? null);
          if (f && autoSubmit) e.target.form?.requestSubmit();
        }}
      />
      <button type="button" onClick={() => ref.current?.click()} className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-100">
        Выбрать файл…
      </button>
      <span className="text-sm text-slate-600">{name ?? "Файл не выбран"}</span>
    </div>
  );
}

/** True when the form has a chosen file; otherwise opens the file dialog. */
export function ensureFileChosen(input: HTMLInputElement | null): boolean {
  if (input?.files?.length) return true;
  input?.click();
  return false;
}
