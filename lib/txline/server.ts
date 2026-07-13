import { TXLINE, TXLINE_API_TOKEN_COOKIE, TXLINE_JWT_COOKIE } from "./config";

export function readCookie(request: Request, name: string) {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

export function sessionTokens(request: Request) {
  return {
    jwt: readCookie(request, TXLINE_JWT_COOKIE),
    apiToken: readCookie(request, TXLINE_API_TOKEN_COOKIE),
  };
}

export function txlineCookie(name: string, value: string, maxAge: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function txlineFetch(request: Request, path: string) {
  const { jwt, apiToken } = sessionTokens(request);
  if (!jwt || !apiToken) {
    return Response.json(
      { error: "TxLINE devnet is not activated for this wallet.", code: "TXLINE_NOT_ACTIVATED" },
      { status: 401 },
    );
  }

  const upstream = await fetch(`${TXLINE.apiBase}${path}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      "X-Api-Token": apiToken,
      Accept: request.headers.get("accept") ?? "application/json",
    },
    cache: "no-store",
  });
  const headers = new Headers();
  headers.set("content-type", upstream.headers.get("content-type") ?? "application/json");
  headers.set("cache-control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers });
}

