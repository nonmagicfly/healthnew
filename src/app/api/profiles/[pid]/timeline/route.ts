import type { NextRequest } from "next/server";
import { handle } from "@/server/http";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/profiles/[pid]/timeline">) {
  const { pid } = await ctx.params;
  const g = req.nextUrl.searchParams.get("groupBy");
  return handle((s) => s.timeline(pid, g === "problem" || g === "specialist" ? g : "date"));
}
