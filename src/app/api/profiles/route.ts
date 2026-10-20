import { handle } from "@/server/http";
import { samples } from "@/server/container";

export async function GET() {
  return handle(async (s) => ({ profiles: await s.ensureProfiles(), samples: samples.list(), liveModel: s.liveModel() }));
}
