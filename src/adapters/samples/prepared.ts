import type { Proposal } from "@/core/model";
import type { SampleInfo } from "@/core/ports";
import type { DraftCtx } from "./builders";

export const PREPARED_NOTICE =
  "Подготовленный разбор по описанию документа. Оригинал не сверялся: цитаты являются пересказом, номера страниц неизвестны.";

/** Prepared parse of a document described by the user (not read): quotes are paraphrases. */
export type PreparedSample = SampleInfo & { pages: string[]; build: (ctx: DraftCtx) => Proposal };
