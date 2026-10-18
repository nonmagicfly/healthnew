import { expect, test, type Page } from "@playwright/test";

// Each test runs against a fresh data directory (see playwright.config.ts), in its own profile state.
// The user's profile shows invented prepared examples here (HEALTH_SAMPLES=fixtures), never personal ones.

async function useProfile(page: Page, id: "me" | "demo") {
  await page.goto("/");
  await page.evaluate((v) => localStorage.setItem("health.profile", v), id);
}

/** Presses Tab until an element whose accessible text matches is focused. */
async function tabTo(page: Page, text: RegExp, max = 120) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const label = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? `${el.getAttribute("aria-label") ?? ""} ${el.textContent ?? ""} ${(el as HTMLInputElement).placeholder ?? ""}` : "";
    });
    if (text.test(label)) return;
  }
  throw new Error(`Could not reach ${text} with Tab`);
}

async function expectVisibleFocus(page: Page) {
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle);
  expect(outline).not.toBe("none");
}

test("key scenario on a prepared example in the user's profile", async ({ page }) => {
  await useProfile(page, "me");
  await page.goto("/documents");
  await page.getByRole("listitem").filter({ hasText: "Консультация терапевта" }).getByRole("button", { name: "Открыть пример" }).click();

  // Extracted data next to the source, clearly marked as prepared.
  await expect(page.getByRole("heading", { name: "Консультация терапевта" })).toBeVisible();
  await expect(page.getByText(/Оригинал не сверялся/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Предлагается изменить текущее состояние/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Нужно уточнить/ })).toBeVisible();

  // Confirm one proposed change and apply.
  await page.getByRole("checkbox", { name: /Аторвастатин/ }).check();
  await page.getByRole("button", { name: "Применить" }).click();
  await expect(page.getByRole("heading", { name: /Извлечённые факты/ })).toBeVisible();

  // State updated: confirmed medication; prescriptions are not intake; old complaints are not current.
  await page.getByRole("link", { name: "Моё состояние", exact: true }).click();
  const taking = page.locator("div").filter({ has: page.getByRole("heading", { name: "Подтверждённые принимаемые препараты" }) }).last();
  await expect(taking.getByText("Аторвастатин", { exact: true })).toBeVisible();
  await expect(taking.getByText("Омепразол")).toHaveCount(0);
  await expect(page.getByText("Нет жалоб, подтверждённых вами как актуальные.")).toBeVisible();
  await page.getByRole("group", { name: "Действия: Изжога" }).getByRole("button", { name: "Актуально сейчас" }).click();
  await expect(page.getByText("Нет жалоб, подтверждённых вами как актуальные.")).toHaveCount(0);
  await expect(page.getByText("Сведений нет. Это не означает, что аллергий нет.")).toBeVisible();

  // History shows the 2023 examinations in 2023.
  await page.getByRole("link", { name: "История", exact: true }).click();
  await expect(page.getByRole("heading", { name: "2023 год" })).toBeVisible();
  await expect(page.getByText("Из документа от 22.09.2025").first()).toBeVisible();

  // Indicator and its source: ferritin is mentioned only, no invented points.
  await page.getByRole("link", { name: "Показатели", exact: true }).click();
  await page.getByLabel("Показатель").selectOption("ferritin");
  await expect(page.getByText(/На графике нет точек/)).toBeVisible();
  await expect(page.getByRole("cell", { name: /около 400/ })).toBeVisible();
  await page.getByRole("link", { name: "Открыть фрагмент" }).first().click();
  await expect(page.getByTestId("source-fragment")).toBeVisible();
  await expect(page.locator("[data-focused]")).toContainText("Ферритин около 400");

  // Ask a question and get a demo answer with sources and used context.
  await page.getByRole("link", { name: "Чат", exact: true }).click();
  await page.getByRole("button", { name: "Какие препараты мне назначали?" }).click();
  await expect(page.getByText("Демонстрационный ответ: LLM не подключена")).toBeVisible();
  await expect(page.getByText(/Омепразол, дозировка не указана: назначен врачом, приём не подтверждён/)).toBeVisible();
  await expect(page.getByText(/не означают, что препарат нужно принимать сейчас/)).toBeVisible();
  await page.getByText(/Какой контекст учтён/).click();
  await expect(page.getByText("Вопрос о препаратах").first()).toBeVisible();
  await page.getByRole("link", { name: /Консультация терапевта/ }).first().click();
  await expect(page.getByTestId("source-fragment")).toBeVisible();
});

test("keyboard-only walkthrough in the demo profile", async ({ page }) => {
  await useProfile(page, "demo");
  await page.goto("/documents");
  await expect(page.getByText("Демо-профиль: синтетические данные.")).toBeVisible();

  for (const title of ["Биохимия, январь", "Биохимия, апрель"]) {
    await page.goto("/documents");
    await expect(page.getByText(title)).toBeVisible();
    const index = title.includes("январь") ? 0 : 1;
    for (let i = 0; i <= index; i++) await tabTo(page, /Открыть пример/);
    await expectVisibleFocus(page);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Применить" })).toBeVisible();
    await tabTo(page, /^ ?Применить/);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: /Извлечённые факты/ })).toBeVisible();
  }

  // Transcript: accept the state change with Space, postpone nothing, apply with Enter.
  await page.goto("/documents");
  await expect(page.getByText("Расшифровка приёма терапевта")).toBeVisible();
  for (let i = 0; i < 3; i++) await tabTo(page, /Открыть пример/);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Говорящий неясен").first()).toBeVisible();
  await tabTo(page, /Изжога по вечерам/);
  await page.keyboard.press("Space");
  await tabTo(page, /^ ?Применить/);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /Извлечённые факты/ })).toBeVisible();

  // Navigate to indicators with the keyboard and open a chart point's source.
  await page.goto("/indicators?code=ferritin");
  await expect(page.getByRole("group", { name: "График: Ферритин" })).toBeVisible();
  await tabTo(page, /Ферритин 310 нг\/мл/);
  await expectVisibleFocus(page);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/documents\/.+fact=/);
  await expect(page.getByTestId("source-fragment")).toBeVisible();

  // Chat with the keyboard, then expand the used context.
  await page.goto("/chat");
  await tabTo(page, /какие препараты мне назначали/);
  await page.keyboard.type("Как менялся ферритин?");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Ферритин изменился с 310 до 180/)).toBeVisible();
  await tabTo(page, /Какой контекст учтён/);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Относится к показателю из вопроса").first()).toBeVisible();

  // Keyboard navigation between sections.
  await page.goto("/");
  await tabTo(page, /^ ?История ?$/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/history$/);
});

test("arbitrary upload is stored honestly, duplicates and errors are explained", async ({ page }) => {
  await useProfile(page, "me");
  await page.goto("/documents");
  const file = { name: "Консультация терапевта_1792324836952.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 not really a pdf") };
  // "Загрузить" without a file opens the file dialog; choosing a file uploads it.
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Загрузить" }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByText("Не удалось прочитать PDF.", { exact: false })).toBeVisible();
  await expect(page.getByText(/Извлечение фактов для этого файла не подключено/)).toBeVisible();
  await expect(page.getByText(/Подготовленный разбор/).filter({ visible: true })).toHaveCount(0);

  await page.goto("/documents");
  await page.getByLabel(/Файл \(PDF/).setInputFiles(file);
  await expect(page.getByText(/Этот файл уже был загружен/)).toBeVisible();

  await page.goto("/documents");
  await page.getByLabel(/Файл \(PDF/).setInputFiles({ name: "empty.txt", mimeType: "text/plain", buffer: Buffer.from("") });
  await expect(page.getByRole("alert").filter({ hasText: "Файл пустой" })).toBeVisible();
});
