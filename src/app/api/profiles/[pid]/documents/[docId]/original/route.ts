import { fileFromForm, handle } from "@/server/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/profiles/[pid]/documents/[docId]/original">) {
  const { pid, docId } = await ctx.params;
  return handle(async (s) => {
    const f = await s.getOriginal(pid, docId);
    return new Response(f.bytes as BodyInit, {
      headers: {
        "Content-Type": f.mime.startsWith("text/") ? `${f.mime}; charset=utf-8` : f.mime,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

/** Attach the user's own original to an example opened without one. */
export async function POST(req: Request, ctx: RouteContext<"/api/profiles/[pid]/documents/[docId]/original">) {
  const { pid, docId } = await ctx.params;
  return handle(async (s) => s.attachOriginal(pid, docId, await fileFromForm(await req.formData())));
}
