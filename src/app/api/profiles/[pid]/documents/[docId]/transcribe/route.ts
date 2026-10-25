import { handle } from "@/server/http";

/** Transcribes a recording again on this computer, e.g. after the model could not be downloaded. */
export async function POST(_req: Request, ctx: RouteContext<"/api/profiles/[pid]/documents/[docId]/transcribe">) {
  const { pid, docId } = await ctx.params;
  return handle((s) => s.retranscribe(pid, docId));
}
