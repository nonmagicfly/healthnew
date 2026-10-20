import { handle } from "@/server/http";

/** Parses the document with the local lab-form parser; nothing is sent to external services. */
export async function POST(_req: Request, ctx: RouteContext<"/api/profiles/[pid]/documents/[docId]/parse">) {
  const { pid, docId } = await ctx.params;
  return handle((s) => s.parseLocally(pid, docId));
}
