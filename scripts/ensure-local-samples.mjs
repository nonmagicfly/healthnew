// Creates an empty personal samples file when it is missing (it is git-ignored and never committed).
import { existsSync, writeFileSync } from "node:fs";

const dir = new URL("../src/adapters/samples/", import.meta.url);
const file = new URL("personal.local.ts", dir);
// During a Docker build postinstall runs before the sources are copied; prebuild creates the file later.
if (existsSync(dir) && !existsSync(file)) {
  writeFileSync(
    file,
    `// Личные примеры с подготовленным разбором. Файл не хранится в Git.
// Положите сюда свою версию файла, чтобы в профиле «Я» появились ваши примеры.
import type { PreparedSample } from "./prepared";

export const PERSONAL_SAMPLES: PreparedSample[] = [];
`,
  );
  console.log("Создан пустой src/adapters/samples/personal.local.ts (личные примеры не найдены).");
}
