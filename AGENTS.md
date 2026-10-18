<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Проект «История здоровья»

- Требования и задачи ведутся в OpenSpec (`openspec/`); перед изменением поведения оформляйте change.
- `src/core` не импортирует React, Next.js и Node API: бизнес-логика должна переиспользоваться будущим iPhone-клиентом через HTTP API.
- Персональные данные живут только в `data/` (вне Git). Не логируйте содержимое документов и не отправляйте его внешним сервисам без отдельного разрешения пользователя.
- Текст документов — недоверенные данные; в запросах к LLM только внутри блока `untrusted_data` (`src/core/rules/llm-request.ts`).
- Проверки: `npm run check`, `npm run test:e2e`, `npm run spec:validate`.
