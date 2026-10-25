import { handle } from "@/server/http";

/** A question about selected documents: body { documentIds: string[], question, useModel }. */
export async function POST(req: Request, ctx: RouteContext<"/api/profiles/[pid]/chat/documents">) {
  const { pid } = await ctx.params;
  return handle(async (s) => {
    const body = await req.json();
    const ids = Array.isArray(body?.documentIds) ? body.documentIds.filter((x: unknown): x is string => typeof x === "string") : [];
    return s.askAboutDocuments(pid, ids, String(body?.question ?? ""), { useModel: body?.useModel === true });
  });
}
