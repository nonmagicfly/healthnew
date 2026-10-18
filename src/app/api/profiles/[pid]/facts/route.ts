import { handle } from "@/server/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/profiles/[pid]/facts">) {
  const { pid } = await ctx.params;
  return handle((s) => s.listFacts(pid));
}
