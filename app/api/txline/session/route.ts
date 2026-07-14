import { TXLINE, TXLINE_JWT_COOKIE } from "@/lib/txline/config";
import { txlineCookie } from "@/lib/txline/server";

export async function POST() {
  const upstream = await fetch(TXLINE.guestAuth, { method: "POST", cache: "no-store" });
  if (!upstream.ok) {
    return Response.json({ error: "Could not start a TxLINE guest session." }, { status: upstream.status });
  }
  const payload = await upstream.json() as { token?: string };
  if (!payload.token) return Response.json({ error: "TxLINE returned no guest token." }, { status: 502 });
  return Response.json(
    { jwt: payload.token, network: "devnet", programId: TXLINE.programId },
    { headers: { "Set-Cookie": txlineCookie(TXLINE_JWT_COOKIE, payload.token, 60 * 55) } },
  );
}
