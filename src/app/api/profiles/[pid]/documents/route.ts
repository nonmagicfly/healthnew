import { fileFromForm, handle, str } from "@/server/http";
import type { DocumentKind } from "@/core/model";

const KINDS: DocumentKind[] = ["lab_report", "consultation", "examination", "transcript", "note", "other"];

export async function GET(_req: Request, ctx: RouteContext<"/api/profiles/[pid]/documents">) {
  const { pid } = await ctx.params;
  return handle((s) => s.listDocuments(pid));
}

export async function POST(req: Request, ctx: RouteContext<"/api/profiles/[pid]/documents">) {
  const { pid } = await ctx.params;
  return handle(async (s) => {
    const form = await req.formData();
    const kind = str(form, "kind") as DocumentKind | null;
    return s.upload(pid, {
      ...(await fileFromForm(form)),
      kind: kind && KINDS.includes(kind) ? kind : undefined,
      title: str(form, "title") ?? undefined,
      documentDate: str(form, "documentDate"),
      specialist: str(form, "specialist"),
      area: str(form, "area"),
    });
  });
}
