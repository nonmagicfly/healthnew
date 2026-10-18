import { handle } from "@/server/http";
import { ValidationError, type FactAction } from "@/core/service";

const TYPES = ["correct", "confirm_current", "mark_historical", "end", "medication_status", "resolve", "appointment_attended", "reject"];

export async function POST(req: Request, ctx: RouteContext<"/api/profiles/[pid]/facts/[factId]">) {
  const { pid, factId } = await ctx.params;
  return handle(async (s) => {
    const action = (await req.json()) as FactAction;
    if (!action || !TYPES.includes(action.type)) throw new ValidationError("Неизвестное действие");
    return s.factAction(pid, factId, action);
  });
}
