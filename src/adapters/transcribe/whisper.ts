import "server-only";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SpeechTranscriber, TranscriptionResult } from "@/core/ports";

const SAMPLE_RATE = 16_000;

/** Runs a command and returns its stdout; stderr is dropped so no content reaches logs. */
function run(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    const out: Buffer[] = [];
    p.stdout.on("data", (b: Buffer) => out.push(b));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

/** Any audio format ffmpeg reads → 16 kHz mono float samples, as Whisper expects. */
async function decode(file: string): Promise<Float32Array> {
  const raw = await run("ffmpeg", ["-v", "quiet", "-i", file, "-f", "f32le", "-ac", "1", "-ar", String(SAMPLE_RATE), "pipe:1"]);
  // Copied so the samples start on a 4-byte boundary whatever buffer Node handed back.
  return new Float32Array(new Uint8Array(raw.subarray(0, raw.byteLength - (raw.byteLength % 4))).buffer);
}

/** When the recording was made, from the file's own tags (phones and the Voice Memos app write it). */
async function recordedAt(file: string): Promise<string | null> {
  try {
    const out = await run("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_entries", "format_tags=creation_time,date", file]);
    const tags = JSON.parse(out.toString("utf8"))?.format?.tags ?? {};
    const value = tags.creation_time ?? tags.date ?? null;
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value : null;
  } catch {
    return null;
  }
}

type Asr = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string; chunks?: { timestamp: [number, number | null]; text: string }[] }>;

/**
 * Speech-to-text on this computer with Whisper (transformers.js + onnxruntime). The model is downloaded
 * once into the data directory on first use; after that recordings never leave the machine.
 */
export class WhisperTranscriber implements SpeechTranscriber {
  private asr: Promise<Asr> | null = null;

  constructor(
    private dataDir: string,
    readonly model = process.env.HEALTH_WHISPER_MODEL || "onnx-community/whisper-small",
  ) {}

  private load(): Promise<Asr> {
    this.asr ??= (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = path.join(this.dataDir, "models");
      return (await pipeline("automatic-speech-recognition", this.model, { dtype: "q8" })) as unknown as Asr;
    })().catch((e) => {
      this.asr = null;
      throw e;
    });
    return this.asr;
  }

  async transcribe(bytes: Uint8Array): Promise<TranscriptionResult> {
    // m4a keeps its index at the end of the file, so ffmpeg reads a file rather than a pipe. It stays in the data directory.
    const dir = path.join(this.dataDir, "tmp");
    const file = path.join(dir, `audio-${crypto.randomUUID()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(file, bytes);
    try {
      return await this.transcribeFile(file);
    } finally {
      await rm(file, { force: true });
    }
  }

  private async transcribeFile(file: string): Promise<TranscriptionResult> {
    let audio: Float32Array;
    try {
      audio = await decode(file);
    } catch {
      return { ok: false, message: "Не удалось прочитать запись: формат не поддерживается или нет ffmpeg." };
    }
    if (!audio.length) return { ok: false, message: "Запись пустая." };
    let asr: Asr;
    try {
      asr = await this.load();
    } catch {
      return { ok: false, message: "Модель расшифровки не загрузилась. Нужен интернет один раз, чтобы скачать её." };
    }
    const out = await asr(audio, { language: "russian", task: "transcribe", return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 });
    const segments = (out.chunks ?? [{ timestamp: [0, null] as [number, null], text: out.text }]).map((c) => ({ start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? null, text: c.text }));
    return { ok: true, segments, recordedAt: await recordedAt(file), model: this.model.split("/").pop() ?? this.model };
  }
}
