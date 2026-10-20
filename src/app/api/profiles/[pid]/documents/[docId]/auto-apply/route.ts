import { handle } from "@/server/http";

export async function POST(_req: Request, ctx: RouteContext<"/api/profiles/[pid]/documents/[docId]/auto-apply">) {
  const { pid, docId } = await ctx.params;
  return handle((s) => s.autoApply(pid, docId));
}
