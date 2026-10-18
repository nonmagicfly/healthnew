import type { NextRequest } from "next/server";
import { handle } from "@/server/http";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/profiles/[pid]/indicators/[code]">) {
  const { pid, code } = await ctx.params;
  const q = req.nextUrl.searchParams;
  return handle((s) => s.indicator(pid, code, { from: q.get("from") || null, to: q.get("to") || null }));
}
