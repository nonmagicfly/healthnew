import "server-only";
import { connection } from "next/server";
import { ExternalServiceError, NotFoundError, ValidationError, type HealthService } from "@/core/service";
import { getService } from "./container";

/**
 * Wraps a route handler: request-time only (no prerendering or caching of personal data),
 * and errors mapped to short messages without document content.
 */
export async function handle(fn: (s: HealthService) => Promise<unknown>): Promise<Response> {
  await connection();
  try {
    const result = await fn(await getService());
    if (result instanceof Response) return result;
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof NotFoundError) return Response.json({ error: e.message }, { status: 404 });
    if (e instanceof ValidationError) return Response.json({ error: e.message }, { status: 400 });
    if (e instanceof ExternalServiceError) return Response.json({ error: e.message }, { status: 502 });
    if (e instanceof SyntaxError) return Response.json({ error: "Некорректный запрос" }, { status: 400 });
    console.error("API error", e instanceof Error ? e.name : "unknown");
    return Response.json({ error: "Внутренняя ошибка. Данные не изменены." }, { status: 500 });
  }
}

export async function fileFromForm(form: FormData, field = "file") {
  const file = form.get(field);
  if (!(file instanceof File)) throw new ValidationError("Файл не выбран");
  return { fileName: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) };
}

export const str = (form: FormData, k: string) => {
  const v = form.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
