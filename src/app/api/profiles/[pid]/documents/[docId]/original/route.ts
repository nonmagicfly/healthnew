import { fileFromForm, handle } from "@/server/http";

export async function GET(req: Request, ctx: RouteContext<"/api/profiles/[pid]/documents/[docId]/original">) {
  const { pid, docId } = await ctx.params;
  return handle(async (s) => {
    const f = await s.getOriginal(pid, docId);
    // Audio players (Safari in particular) ask for byte ranges to play and seek.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
    const size = f.bytes.length;
    let start = 0;
    let end = size - 1;
    if (range && (range[1] || range[2])) {
      start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const partial = start > 0 || end < size - 1;
    return new Response(f.bytes.subarray(start, end + 1) as BodyInit, {
      status: partial ? 206 : 200,
      headers: {
        "Accept-Ranges": "bytes",
        ...(partial ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
        "Content-Type": f.mime.startsWith("text/") ? `${f.mime}; charset=utf-8` : f.mime,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

/** Attach the user's own original to an example opened without one. */
export async function POST(req: Request, ctx: RouteContext<"/api/profiles/[pid]/documents/[docId]/original">) {
  const { pid, docId } = await ctx.params;
  return handle(async (s) => s.attachOriginal(pid, docId, await fileFromForm(await req.formData())));
}
