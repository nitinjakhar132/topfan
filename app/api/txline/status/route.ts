import { TXLINE } from "@/lib/txline/config";
import { sessionTokens } from "@/lib/txline/server";

export async function GET(request: Request) {
  const tokens = sessionTokens(request);
  return Response.json({
    network: "devnet",
    connected: Boolean(tokens.jwt && tokens.apiToken),
    programId: TXLINE.programId,
    rpc: TXLINE.rpc,
    coverage: {
      fixtures: true,
      odds: true,
      scores: true,
      lineups: true,
      playerIdentity: true,
      goals: true,
      shots: true,
      cards: true,
      penalties: true,
      substitutions: true,
      assists: false,
      tackles: false,
      passing: false,
      chancesCreated: false,
      saves: false,
      playerRating: false,
    },
  });
}

