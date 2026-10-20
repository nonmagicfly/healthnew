import { handle } from "@/server/http";
import { samples } from "@/server/container";

export async function GET() {
  return handle(async (s) => ({ profiles: await s.ensureProfiles(), samples: samples.list(), liveModel: s.liveModel() }));
}

/** Creates a profile for a family member. */
export async function POST(req: Request) {
  return handle(async (s) => {
    const body = await req.json().catch(() => null);
    return s.createProfile(typeof body?.name === "string" ? body.name : "");
  });
}
