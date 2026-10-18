"use client";

import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", ...init });
  } catch {
    throw new ApiError("Нет связи с сервером приложения");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.error ?? `Ошибка ${res.status}`);
  return body as T;
}

export const postJson = <T>(url: string, data: unknown) =>
  api<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });

export interface Loadable<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Fetches `url` whenever it or `version` changes. A null url skips loading. */
export function useApi<T>(url: string | null, version = 0): Loadable<T> {
  const [nonce, setNonce] = useState(0);
  const key = url ? `${url}|${version}|${nonce}` : null;
  const [state, setState] = useState<{ key: string | null; url: string | null; data: T | null; error: string | null }>({ key: null, url: null, data: null, error: null });
  useEffect(() => {
    if (!url || !key) return;
    let alive = true;
    api<T>(url)
      .then((data) => alive && setState({ key, url, data, error: null }))
      .catch((e: Error) => alive && setState((s) => ({ key, url, data: s.url === url ? s.data : null, error: e.message })));
    return () => {
      alive = false;
    };
  }, [url, key]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  // Data of another url (e.g. another profile) is never shown while the new one loads.
  return { data: state.url === url ? state.data : null, error: state.key === key ? state.error : null, loading: !!key && state.key !== key, reload };
}
