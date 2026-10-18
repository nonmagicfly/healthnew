import { handle } from "@/server/http";

export async function POST(_req: Request, ctx: RouteContext<"/api/profiles/[pid]/samples/[key]">) {
  const { pid, key } = await ctx.params;
  return handle((s) => s.openSample(pid, key));
}
