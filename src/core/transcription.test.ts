import { describe, expect, it } from "vitest";
import { createTestService } from "@/adapters/testing";
import type { SpeechTranscriber, TranscriptionResult } from "./ports";
import { mimeFor, timecodeOf } from "./service";

// An invented conversation; the bytes stand in for a recording and are never decoded.
const RECORDING = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
const SPOKEN: TranscriptionResult = {
  ok: true,
  model: "whisper-test",
  recordedAt: "2026-03-14T09:30:00.000000Z",
  segments: [
    { start: 0, end: 4.2, text: " Здравствуйте, что вас беспокоит?" },
    { start: 4.2, end: 9, text: " Иногда колет в боку после бега." },
    { start: 65.4, end: 70, text: " Сделаем УЗИ и посмотрим." },
    { start: 70, end: 71, text: "   " },
  ],
};

const fake = (result: TranscriptionResult | (() => Promise<TranscriptionResult>)): SpeechTranscriber & { calls: number } => {
  const t = {
    calls: 0,
    async transcribe() {
      t.calls++;
      return typeof result === "function" ? result() : result;
    },
  };
  return t;
};

describe("recorded conversations", () => {
  it("stores the recording unchanged and turns it into text in the background", async () => {
    const transcriber = fake(SPOKEN);
    const { service } = await createTestService({ transcriber });
    const { document } = await service.upload("me", { fileName: "Приём.m4a", mime: "", bytes: RECORDING });
    expect(document.kind).toBe("transcript");
    expect(document.original?.mime).toBe("audio/mp4");
    expect(document.status).toBe("transcribing");

    await service.transcriptionsIdle();
    const detail = await service.getDocument("me", document.id);
    expect(transcriber.calls).toBe(1);
    expect(detail.document.status).not.toBe("transcribing");
    expect(detail.document.documentDate).toBe("2026-03-14");
    const v = detail.versions.find((x) => x.method === "speech_to_text")!;
    expect(v.segments.map((s) => [s.timecode, s.speaker, s.text])).toEqual([
      ["0:00", "unclear", "Здравствуйте, что вас беспокоит?"],
      ["0:04", "unclear", "Иногда колет в боку после бега."],
      ["1:05", "unclear", "Сделаем УЗИ и посмотрим."],
    ]);
    expect(v.note).toContain("говорящие не размечены");
    expect((await service.getOriginal("me", document.id)).bytes).toEqual(RECORDING);
  });

  it("keeps a date the user entered over the one in the file", async () => {
    const { service } = await createTestService({ transcriber: fake(SPOKEN) });
    const { document } = await service.upload("me", { fileName: "visit.mp3", mime: "audio/mpeg", bytes: RECORDING, documentDate: "2026-03-10" });
    await service.transcriptionsIdle();
    expect((await service.getDocument("me", document.id)).document.documentDate).toBe("2026-03-10");
  });

  it("only stores the recording when speech-to-text is off", async () => {
    const { service } = await createTestService();
    const { document } = await service.upload("me", { fileName: "visit.wav", mime: "audio/wav", bytes: RECORDING });
    expect(document.status).toBe("recognition_unavailable");
    expect(document.statusMessage).toMatch(/не подключена/);
  });

  it("reports a failed transcription without the recording's words and keeps the original", async () => {
    const { service } = await createTestService({ transcriber: fake(async () => Promise.reject(new Error("Иногда колет в боку"))) });
    const { document } = await service.upload("me", { fileName: "visit.ogg", mime: "", bytes: RECORDING });
    await service.transcriptionsIdle();
    const detail = await service.getDocument("me", document.id);
    expect(detail.document.status).toBe("recognition_unavailable");
    expect(detail.document.statusMessage).not.toMatch(/колет/);
    expect(detail.versions).toHaveLength(0);
    expect((await service.getOriginal("me", document.id)).bytes).toEqual(RECORDING);
  });

  it("transcribes again on request after a failure", async () => {
    let fail = true;
    const transcriber = fake(async () => (fail ? { ok: false, message: "Модель не загрузилась." } : SPOKEN));
    const { service } = await createTestService({ transcriber });
    const { document } = await service.upload("me", { fileName: "visit.m4a", mime: "", bytes: RECORDING });
    await service.transcriptionsIdle();
    expect((await service.getDocument("me", document.id)).document.statusMessage).toBe("Модель не загрузилась.");
    fail = false;
    expect((await service.retranscribe("me", document.id)).status).toBe("transcribing");
    await service.transcriptionsIdle();
    const detail = await service.getDocument("me", document.id);
    expect(detail.versions.some((v) => v.method === "speech_to_text")).toBe(true);
    await expect(service.retranscribe("me", document.id)).rejects.toThrow(/уже расшифрована/);
  });

  it("does not transcribe the same recording twice", async () => {
    const transcriber = fake(SPOKEN);
    const { service } = await createTestService({ transcriber });
    await service.upload("me", { fileName: "a.m4a", mime: "", bytes: RECORDING });
    const again = await service.upload("me", { fileName: "copy.m4a", mime: "", bytes: RECORDING });
    await service.transcriptionsIdle();
    expect(again.duplicate).toBe(true);
    expect(transcriber.calls).toBe(1);
  });

  it("recognizes audio by extension and writes timecodes", () => {
    expect(mimeFor("Запись.M4A", "")).toBe("audio/mp4");
    expect(mimeFor("x.webm", "")).toBe("audio/webm");
    expect(timecodeOf(5.9)).toBe("0:05");
    expect(timecodeOf(3725)).toBe("1:02:05");
  });
});
