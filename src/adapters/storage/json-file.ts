import { promises as fs } from "node:fs";
import path from "node:path";
import type { FileStore } from "@/core/ports";
import { emptyDb, MemoryRepository, type DbShape } from "./memory";

async function atomicWrite(file: string, data: string | Uint8Array) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

/**
 * Local persistent repository: one JSON file in the data directory.
 * Suitable for a single user and a single process (prototype); replace via the Repository port.
 */
export class JsonFileRepository extends MemoryRepository {
  private writing: Promise<void> = Promise.resolve();

  private constructor(private file: string, db: DbShape) {
    super(db);
  }

  static async open(dataDir: string): Promise<JsonFileRepository> {
    await fs.mkdir(dataDir, { recursive: true });
    const file = path.join(dataDir, "db.json");
    let db = emptyDb();
    try {
      db = { ...emptyDb(), ...JSON.parse(await fs.readFile(file, "utf8")) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Не удалось прочитать хранилище данных");
    }
    return new JsonFileRepository(file, db);
  }

  protected async persist() {
    const snapshot = JSON.stringify(this.db, null, 1);
    this.writing = this.writing.then(() => atomicWrite(this.file, snapshot));
    await this.writing;
  }
}

/** Originals by SHA-256. Written once; existing files are never overwritten. */
export class FsFileStore implements FileStore {
  constructor(private dir: string) {}

  private pathFor(sha256: string) {
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("Invalid file id");
    return path.join(this.dir, sha256);
  }

  async put(sha256: string, bytes: Uint8Array) {
    await fs.mkdir(this.dir, { recursive: true });
    const p = this.pathFor(sha256);
    try {
      await fs.access(p);
      return;
    } catch {
      await atomicWrite(p, bytes);
    }
  }

  async get(sha256: string) {
    try {
      return new Uint8Array(await fs.readFile(this.pathFor(sha256)));
    } catch {
      return null;
    }
  }
}
