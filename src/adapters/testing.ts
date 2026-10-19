import { HealthService } from "@/core/service";
import { MemoryFileStore, MemoryRepository } from "./storage/memory";
import { LocalRecognizer } from "./recognition/local";
import { PreparedExtractor } from "./extraction/prepared";
import { BuiltInSamples } from "./samples/catalog";
import { FIXTURE_SAMPLES } from "./samples/fixtures";
import { DemoLlm } from "./llm/demo";
import type { LiveModel, Repository } from "@/core/ports";

/** Service wired with in-memory storage, a fixed clock and invented examples instead of personal ones, for tests. */
export async function createTestService(opts: { repo?: Repository; now?: string; live?: LiveModel | null } = {}) {
  let n = 0;
  const repo = opts.repo ?? new MemoryRepository();
  const samples = new BuiltInSamples(FIXTURE_SAMPLES);
  const service = new HealthService({
    repo,
    files: new MemoryFileStore(),
    recognizer: new LocalRecognizer(),
    extractor: new PreparedExtractor(samples),
    llm: new DemoLlm(),
    live: opts.live ?? null,
    samples,
    clock: { now: () => new Date(opts.now ?? "2026-10-18T10:00:00Z") },
    ids: { next: (p) => `${p}_${++n}` },
  });
  await service.ensureProfiles();
  return { service, repo, samples };
}
