import { handle } from "@/server/http";

/** Focus areas with a card each: latest conclusion, key numbers with their course, next check. */
export async function GET(_req: Request, ctx: RouteContext<"/api/profiles/[pid]/focus">) {
  const { pid } = await ctx.params;
  return handle((s) => s.focus(pid));
}

/** Turns built-in areas off and sets the user's own areas: body { disabled: string[], custom: { id?, title, keywords }[] }. */
export async function PUT(req: Request, ctx: RouteContext<"/api/profiles/[pid]/focus">) {
  const { pid } = await ctx.params;
  return handle(async (s) => s.setFocusSettings(pid, (await req.json().catch(() => null)) ?? {}));
}
