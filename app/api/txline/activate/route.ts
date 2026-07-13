import { TXLINE, TXLINE_API_TOKEN_COOKIE, TXLINE_JWT_COOKIE } from "@/lib/txline/config";
import { readCookie, txlineCookie } from "@/lib/txline/server";

export async function POST(request: Request) {
  const jwt = readCookie(request, TXLINE_JWT_COOKIE);
  if (!jwt) return Response.json({ error: "Start a TxLINE session first." }, { status: 401 });
  const body = await request.json() as { txSig?: string; walletSignature?: string };
  if (!body.txSig || !body.walletSignature) {
    return Response.json({ error: "txSig and walletSignature are required" }, { status: 400 });
  }
  const upstream = await fetch(`${TXLINE.apiBase}/token/activate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ txSig: body.txSig, walletSignature: body.walletSignature, leagues: TXLINE.leagues }),
  });
  const text = await upstream.text();
  if (!upstream.ok) return Response.json({ error: text || "TxLINE activation failed" }, { status: upstream.status });
  let token = text;
  try { const parsed = JSON.parse(text) as { token?: string }; token = parsed.token ?? text; } catch { /* plain token */ }
  token = token.replace(/^"|"$/g, "");
  return Response.json(
    { activated: true, network: "devnet" },
    { headers: { "Set-Cookie": txlineCookie(TXLINE_API_TOKEN_COOKIE, token, 60 * 60 * 24 * 120) } },
  );
}

