import { handle } from "@/server/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/profiles/[pid]/state">) {
  const { pid } = await ctx.params;
  return handle((s) => s.state(pid));
}
