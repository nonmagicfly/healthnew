import { handle } from "@/server/http";

/** Moves the document and everything extracted from it to another profile. */
export async function POST(req: Request, ctx: RouteContext<"/api/profiles/[pid]/documents/[docId]/move">) {
  const { pid, docId } = await ctx.params;
  return handle(async (s) => {
    const body = await req.json().catch(() => null);
    return s.moveDocument(pid, docId, typeof body?.targetProfileId === "string" ? body.targetProfileId : "");
  });
}
