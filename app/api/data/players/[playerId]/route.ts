import { ensureArchiveDatabase } from "@/db";
import { getPlayerPassport } from "@/lib/player-repository/repository";

export async function GET(request: Request, context: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await context.params;
  await ensureArchiveDatabase();
  
  const url = new URL(request.url);
  const competitionId = url.searchParams.get("competitionId") || "worldcup2026";
  const wallet = url.searchParams.get("wallet") || undefined;

  const passport = await getPlayerPassport(playerId, competitionId, wallet);
  
  if (!passport) {
    return Response.json({ error: "Player passport not found." }, { status: 404 });
  }

  return Response.json(passport);
}

