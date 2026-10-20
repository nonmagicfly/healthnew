"use client";

import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Profile, SourceDocument } from "@/core/model";
import type { SampleInfo } from "@/core/ports";
import { useApi } from "./api";

interface DocumentListItem {
  document: SourceDocument;
  factCount: number;
  unverifiedCount: number;
}

interface Ctx {
  profiles: Profile[];
  profile: Profile | null;
  setProfileId: (id: string) => void;
  samples: SampleInfo[];
  /** Connected language model; null in demo mode. */
  liveModel: { provider: string; model: string } | null;
  documents: DocumentListItem[];
  docTitle: (id: string) => string;
  /** Incremented after every change so all views reload derived data. */
  version: number;
  bump: () => void;
  base: string;
}

const ProfileContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "health.profile";

// The selected profile is a per-browser convenience kept in localStorage.
const listeners = new Set<() => void>();
function readStoredProfile(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "me";
  } catch {
    return "me";
  }
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const profileId = useSyncExternalStore(subscribe, readStoredProfile, () => "me");
  const [version, setVersion] = useState(0);
  const meta = useApi<{ profiles: Profile[]; samples: SampleInfo[]; liveModel: { provider: string; model: string } | null }>("/api/profiles");

  const setProfileId = useCallback((id: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* storage unavailable */
    }
    listeners.forEach((l) => l());
  }, []);

  const base = `/api/profiles/${profileId}`;
  const docs = useApi<DocumentListItem[]>(`${base}/documents`, version);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const value = useMemo<Ctx>(() => {
    const profiles = meta.data?.profiles ?? [];
    const documents = docs.data ?? [];
    return {
      profiles,
      profile: profiles.find((p) => p.id === profileId) ?? null,
      setProfileId,
      samples: meta.data?.samples ?? [],
      liveModel: meta.data?.liveModel ?? null,
      documents,
      docTitle: (id) => documents.find((d) => d.document.id === id)?.document.title ?? "Документ",
      version,
      bump,
      base,
    };
  }, [meta.data, docs.data, profileId, setProfileId, version, bump, base]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): Ctx {
  const c = useContext(ProfileContext);
  if (!c) throw new Error("ProfileProvider missing");
  return c;
}
