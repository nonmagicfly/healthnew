import { handle } from "@/server/http";

export async function POST(req: Request, ctx: RouteContext<"/api/profiles/[pid]/notes">) {
  const { pid } = await ctx.params;
  return handle(async (s) => {
    const b = await req.json();
    const kind = ["complaint", "medication", "event"].includes(b?.kind) ? b.kind : "event";
    return s.addNote(pid, { kind, text: String(b?.text ?? ""), current: Boolean(b?.current), date: typeof b?.date === "string" && b.date ? b.date : null });
  });
}
