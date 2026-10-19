import { handle } from "@/server/http";

/** Sends the document to the connected model. The body must carry { consent: true }. */
export async function POST(req: Request, ctx: RouteContext<"/api/profiles/[pid]/documents/[docId]/extract">) {
  const { pid, docId } = await ctx.params;
  return handle(async (s) => s.extractWithModel(pid, docId, (await req.json())?.consent === true));
}
