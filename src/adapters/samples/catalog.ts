import type { Proposal } from "@/core/model";
import type { SampleCatalog, SampleContent, SampleInfo } from "@/core/ports";
import type { DraftCtx } from "./builders";
import { PERSONAL_SAMPLES } from "./personal.local";
import type { PreparedSample } from "./prepared";
import { SYNTHETIC_SAMPLES } from "./synthetic";

type Builder = (ctx: DraftCtx) => Proposal;

const strip = <T extends SampleInfo>(s: T): SampleInfo => ({
  key: s.key,
  title: s.title,
  kind: s.kind,
  documentDate: s.documentDate,
  specialist: s.specialist,
  area: s.area,
  synthetic: s.synthetic,
  description: s.description,
  preparedNotice: s.preparedNotice,
});

/** Built-in examples: personal prepared samples (kept out of Git) and synthetic demo documents. */
export class BuiltInSamples implements SampleCatalog {
  constructor(private readonly personal: PreparedSample[] = PERSONAL_SAMPLES) {}

  list(): SampleInfo[] {
    return [...this.personal, ...SYNTHETIC_SAMPLES].map(strip);
  }

  get(key: string): SampleContent | null {
    const real = this.personal.find((s) => s.key === key);
    if (real) return { info: strip(real), originalText: null, preparedPages: real.pages };
    const syn = SYNTHETIC_SAMPLES.find((s) => s.key === key);
    if (syn) return { info: strip(syn), originalText: syn.text, preparedPages: null };
    return null;
  }

  builder(key: string): { build: Builder; paraphrase: boolean } | null {
    const real = this.personal.find((s) => s.key === key);
    if (real) return { build: real.build, paraphrase: true };
    const syn = SYNTHETIC_SAMPLES.find((s) => s.key === key);
    if (syn) return { build: syn.build, paraphrase: false };
    return null;
  }
}
