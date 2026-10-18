# Проверка критериев приёмки

Прогон 2026-10-18: `npm run check` (типы, линтер, 34 модульных теста), `npm run test:e2e` (3 браузерных теста, включая сборку), `npm run spec:validate`.

| Критерий | Чем проверено |
|---|---|
| Неизвестная дата не подменяется датой документа | `scenario.test.ts` «keeps the collection date unknown for the blood test»; `rules.test.ts` «dates», «places a point with unknown collection date by document date, marked as such» |
| Назначение не становится подтверждённым приёмом | `rules.test.ts` «a prescription is not confirmed intake…»; `scenario.test.ts` ключевой сценарий; e2e «key scenario» |
| Историческая жалоба не становится текущей автоматически | `rules.test.ts` «a complaint from a document is not current until confirmed»; e2e «key scenario» |
| Качественное описание не превращается в число | `rules.test.ts` «does not plot qualitative findings or mentions»; `scenario.test.ts` (АЛТ без точек) |
| Повторная загрузка не создаёт дубли | `scenario.test.ts` «does not create duplicates…», «does not duplicate an uploaded file»; e2e «arbitrary upload…» |
| Исправление обновляет состояние и историю | `scenario.test.ts` «a correction updates state, history and later answers», «corrections of lab results» |
| Источник доступен из факта, результата и ответа | e2e «key scenario» (строка таблицы и ответ чата открывают фрагмент), e2e «keyboard-only» (точка графика) |
| Демонстрационные данные не смешиваются с реальными | `scenario.test.ts` «synthetic examples open only in the demo profile…», «every fact from prepared examples is marked as a paraphrase…», «does not show a prepared parse for an arbitrary file» |
| Профили не смешивают данные | `scenario.test.ts` «demo data never appears in the user's profile» |
| Основные взаимодействия работают с клавиатуры | e2e «keyboard-only walkthrough in the demo profile» (включая видимый фокус) |
| Понятные состояния загрузки, пустоты и ошибок | e2e «arbitrary upload…» (ошибки и статусы), проверка в браузере пустого профиля и состояния загрузки |
| Инструкции внутри документов не меняют поведение | `rules.test.ts` «keeps instructions from documents inside the escaped data block» |
| Расшифровки: говорящие, вариант против назначения, неразборчивое, повтор, связь с PDF | `scenario.test.ts` «distinguishes speakers, options, illegible names, repeats and conflicts»; `adapters.test.ts` |
| Несопоставимые единицы не объединяются; упоминание связано с бланком без дубля точки | `scenario.test.ts` «keeps ALT in different units…», «links mentions to lab forms…» |

Не проверено: сверка подготовленного разбора с реальными PDF пользователя (файлы недоступны в среде разработки).
