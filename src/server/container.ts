import "server-only";
import path from "node:path";
import { HealthService } from "@/core/service";
import { FsFileStore, JsonFileRepository } from "@/adapters/storage/json-file";
import { LocalRecognizer } from "@/adapters/recognition/local";
import { PreparedExtractor } from "@/adapters/extraction/prepared";
import { BuiltInSamples } from "@/adapters/samples/catalog";
import { FIXTURE_SAMPLES } from "@/adapters/samples/fixtures";
import { DemoLlm } from "@/adapters/llm/demo";
import { ClaudeModel } from "@/adapters/llm/claude";
import { OpenAiModel } from "@/adapters/llm/openai";
import { liveModel } from "@/adapters/llm/live";
import type { LiveModel } from "@/core/ports";

// HEALTH_SAMPLES=fixtures swaps personal examples for invented ones (used by e2e tests).
export const samples = process.env.HEALTH_SAMPLES === "fixtures" ? new BuiltInSamples(FIXTURE_SAMPLES) : new BuiltInSamples();

/**
 * Connected model from the environment (.env.local). OpenAI first, Anthropic second;
 * HEALTH_LLM_PROVIDER=openai|anthropic|none picks explicitly, HEALTH_LLM_MODEL overrides the model.
 * Without a key the app stays in demo mode and sends nothing anywhere.
 */
function liveFromEnv(): LiveModel | null {
  const env = process.env;
  const provider = env.HEALTH_LLM_PROVIDER ?? (env.OPENAI_API_KEY ? "openai" : env.ANTHROPIC_API_KEY ? "anthropic" : "none");
  const model = env.HEALTH_LLM_MODEL || undefined;
  if (provider === "openai" && env.OPENAI_API_KEY) return liveModel(new OpenAiModel(model));
  if (provider === "anthropic" && env.ANTHROPIC_API_KEY) return liveModel(new ClaudeModel(model));
  return null;
}

const g = globalThis as unknown as { __health?: Promise<HealthService> };

/** Composition root: wires real and demo adapters. Data stays in HEALTH_DATA_DIR (default ./data, git-ignored). */
export function getService(): Promise<HealthService> {
  g.__health ??= (async () => {
    // Ignored by the bundler so the data directory is never traced into build output.
    const dir = path.resolve(/*turbopackIgnore: true*/ process.env.HEALTH_DATA_DIR ?? "data");
    const repo = await JsonFileRepository.open(dir);
    const service = new HealthService({
      repo,
      files: new FsFileStore(path.join(dir, "files")),
      recognizer: new LocalRecognizer(),
      extractor: new PreparedExtractor(samples),
      llm: new DemoLlm(),
      live: liveFromEnv(),
      samples,
      clock: { now: () => new Date() },
      ids: { next: (p) => `${p}_${crypto.randomUUID().slice(0, 12)}` },
    });
    await service.ensureProfiles();
    return service;
  })();
  return g.__health;
}
