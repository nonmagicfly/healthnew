import { handle } from "@/server/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/profiles/[pid]/chat">) {
  const { pid } = await ctx.params;
  return handle((s) => s.messages(pid));
}

export async function POST(req: Request, ctx: RouteContext<"/api/profiles/[pid]/chat">) {
  const { pid } = await ctx.params;
  return handle(async (s) => s.ask(pid, String((await req.json())?.question ?? "")));
}
