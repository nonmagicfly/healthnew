import { handle } from "@/server/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/profiles/[pid]/documents/[docId]">) {
  const { pid, docId } = await ctx.params;
  return handle((s) => s.getDocument(pid, docId));
}

/** Changes the document date: body { documentDate: "YYYY-MM-DD" | null }. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/profiles/[pid]/documents/[docId]">) {
  const { pid, docId } = await ctx.params;
  return handle(async (s) => {
    const body = await req.json().catch(() => null);
    const date = typeof body?.documentDate === "string" && body.documentDate.trim() ? body.documentDate : null;
    return s.setDocumentDate(pid, docId, date);
  });
}
