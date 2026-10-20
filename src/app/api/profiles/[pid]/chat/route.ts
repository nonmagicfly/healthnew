import { handle } from "@/server/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/profiles/[pid]/chat">) {
  const { pid } = await ctx.params;
  return handle((s) => s.messages(pid));
}

export async function POST(req: Request, ctx: RouteContext<"/api/profiles/[pid]/chat">) {
  const { pid } = await ctx.params;
  return handle(async (s) => {
    const body = await req.json();
    return s.ask(pid, String(body?.question ?? ""), { useModel: body?.useModel === true });
  });
}
