import type { ChatMessage, ContentVersion, Encounter, Fact, Profile, Proposal, SourceDocument } from "@/core/model";
import type { FileStore, Repository } from "@/core/ports";

export interface DbShape {
  profiles: Profile[];
  documents: SourceDocument[];
  versions: ContentVersion[];
  facts: Fact[];
  encounters: Encounter[];
  proposals: (Proposal & { profileId: string })[];
  messages: ChatMessage[];
}

export const emptyDb = (): DbShape => ({
  profiles: [],
  documents: [],
  versions: [],
  facts: [],
  encounters: [],
  proposals: [],
  messages: [],
});

function upsert<T extends { id: string }>(list: T[], item: T) {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item;
  else list.push(item);
}

const clone = <T>(v: T): T => structuredClone(v);

/** In-memory repository. Also the base for the JSON-file repository, which persists after each write. */
export class MemoryRepository implements Repository {
  constructor(protected db: DbShape = emptyDb()) {}

  protected async persist(): Promise<void> {}

  async listProfiles() { return clone(this.db.profiles); }
  async getProfile(id: string) { return clone(this.db.profiles.find((p) => p.id === id) ?? null); }
  async saveProfile(p: Profile) { upsert(this.db.profiles, clone(p)); await this.persist(); }

  async listDocuments(profileId: string) { return clone(this.db.documents.filter((d) => d.profileId === profileId)); }
  async getDocument(profileId: string, id: string) {
    return clone(this.db.documents.find((d) => d.id === id && d.profileId === profileId) ?? null);
  }
  async saveDocument(d: SourceDocument) { upsert(this.db.documents, clone(d)); await this.persist(); }

  async listVersions(profileId: string, documentId: string) {
    return clone(this.db.versions.filter((v) => v.profileId === profileId && v.documentId === documentId));
  }
  async saveVersion(v: ContentVersion) { upsert(this.db.versions, clone(v)); await this.persist(); }

  async listFacts(profileId: string) { return clone(this.db.facts.filter((f) => f.profileId === profileId)); }
  async getFact(profileId: string, id: string) {
    return clone(this.db.facts.find((f) => f.id === id && f.profileId === profileId) ?? null);
  }
  async saveFact(f: Fact) { upsert(this.db.facts, clone(f)); await this.persist(); }

  async listEncounters(profileId: string) { return clone(this.db.encounters.filter((e) => e.profileId === profileId)); }
  async saveEncounter(e: Encounter) { upsert(this.db.encounters, clone(e)); await this.persist(); }

  async getProposal(profileId: string, documentId: string) {
    const p = this.db.proposals.find((x) => x.profileId === profileId && x.documentId === documentId);
    if (!p) return null;
    const { profileId: _pid, ...rest } = clone(p);
    void _pid;
    return rest;
  }
  async saveProposal(profileId: string, p: Proposal) {
    this.db.proposals = this.db.proposals.filter((x) => !(x.profileId === profileId && x.documentId === p.documentId));
    this.db.proposals.push({ ...clone(p), profileId });
    await this.persist();
  }

  async listMessages(profileId: string) { return clone(this.db.messages.filter((m) => m.profileId === profileId)); }
  async saveMessage(m: ChatMessage) { upsert(this.db.messages, clone(m)); await this.persist(); }
}

export class MemoryFileStore implements FileStore {
  private files = new Map<string, Uint8Array>();
  async put(sha256: string, bytes: Uint8Array) {
    if (!this.files.has(sha256)) this.files.set(sha256, new Uint8Array(bytes));
  }
  async get(sha256: string) { return this.files.get(sha256) ?? null; }
}
