import { TXLINE, TXLINE_API_TOKEN_COOKIE, TXLINE_JWT_COOKIE } from "./config";

export function readCookie(request: Request, name: string) {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return value.join("=");
      }
    }
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

async function startGuestSession() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(TXLINE.guestAuth, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const payload = await response.json() as { token?: string };
    return payload.token;
  } catch (err) {
    console.error("[startGuestSession] Failed or timed out:", err);
    return undefined;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function txlineFetch(request: Request, path: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s overall timeout

  try {
    const tokens = sessionTokens(request);
    if (!tokens.apiToken) {
      return Response.json(
        { error: "TxLINE devnet is not activated for this wallet.", code: "TXLINE_NOT_ACTIVATED" },
        { status: 401 },
      );
    }

    let jwt = tokens.jwt;
    let refreshed = false;
    if (!jwt) {
      jwt = await startGuestSession();
      refreshed = Boolean(jwt);
    }
    if (!jwt) return Response.json({ error: "Could not refresh the TxLINE guest session." }, { status: 502 });

    const upstreamRequest = (sessionJwt: string) => fetch(`${TXLINE.apiBase}${path}`, {
      headers: { Authorization: `Bearer ${sessionJwt}`, "X-Api-Token": tokens.apiToken!, Accept: request.headers.get("accept") ?? "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    let upstream = await upstreamRequest(jwt);
    if (upstream.status === 401) {
      const replacement = await startGuestSession();
      if (replacement) {
        jwt = replacement;
        refreshed = true;
        upstream = await upstreamRequest(jwt);
      }
    }
    const headers = new Headers();
    headers.set("content-type", upstream.headers.get("content-type") ?? "application/json");
    headers.set("cache-control", "no-store");
    if (refreshed) headers.append("set-cookie", txlineCookie(TXLINE_JWT_COOKIE, jwt, 60 * 55));
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return Response.json(
        { error: "Request to TxLINE server timed out.", code: "TXLINE_TIMEOUT" },
        { status: 504 }
      );
    }
    console.error("[txlineFetch] error:", err);
    return Response.json(
      { error: "Internal server error connecting to TxLINE." },
      { status: 500 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
