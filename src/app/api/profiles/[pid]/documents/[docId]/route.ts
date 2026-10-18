import { handle } from "@/server/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/profiles/[pid]/documents/[docId]">) {
  const { pid, docId } = await ctx.params;
  return handle((s) => s.getDocument(pid, docId));
}
