import { handle } from "@/server/http";

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export async function POST(req: Request, ctx: RouteContext<"/api/profiles/[pid]/documents/[docId]/apply">) {
  const { pid, docId } = await ctx.params;
  return handle(async (s) => {
    const body = await req.json();
    return s.applyProposal(pid, docId, {
      acceptedStateChanges: strings(body?.acceptedStateChanges),
      postponedClarifications: strings(body?.postponedClarifications),
    });
  });
}
