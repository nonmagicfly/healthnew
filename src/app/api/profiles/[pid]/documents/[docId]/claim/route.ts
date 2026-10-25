import { handle } from "@/server/http";

/** Confirms that a form printed for another name belongs to this profile. */
export async function POST(_req: Request, ctx: RouteContext<"/api/profiles/[pid]/documents/[docId]/claim">) {
  const { pid, docId } = await ctx.params;
  return handle((s) => s.claimDocument(pid, docId));
}
