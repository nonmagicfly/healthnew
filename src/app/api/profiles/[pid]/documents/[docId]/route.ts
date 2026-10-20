import { handle } from "@/server/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/profiles/[pid]/documents/[docId]">) {
  const { pid, docId } = await ctx.params;
  return handle((s) => s.getDocument(pid, docId));
}

/**
 * Changes the document date: body { documentDate: "YYYY-MM-DD" | null },
 * or its labels: body { labels: { kind?, area?, specialist?, institution? } }.
 */
export async function PATCH(req: Request, ctx: RouteContext<"/api/profiles/[pid]/documents/[docId]">) {
  const { pid, docId } = await ctx.params;
  return handle(async (s) => {
    const body = await req.json().catch(() => null);
    if (body?.labels && typeof body.labels === "object") {
      const l = body.labels;
      const opt = (v: unknown) => (v === undefined ? undefined : typeof v === "string" ? v : null);
      return s.setDocumentLabels(pid, docId, { kind: typeof l.kind === "string" ? l.kind : undefined, area: opt(l.area), specialist: opt(l.specialist), institution: opt(l.institution) });
    }
    const date = typeof body?.documentDate === "string" && body.documentDate.trim() ? body.documentDate : null;
    return s.setDocumentDate(pid, docId, date);
  });
}
