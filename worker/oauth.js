import { verifyBearerToken } from "./auth.js";

export const RESOURCE = "https://verdian.io.kr/mcp/telegram";
export const SCOPE = "telegram:read";
export const AUTHORIZE_PATH = "/oauth/telegram/authorize";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function page(clientName, csrf, error = "") {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Telegram MCP 연결 승인</title>
<style>body{font:16px system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1.25rem;color:#17202a}h1{font-size:1.5rem}p{line-height:1.6}input,button{font:inherit;box-sizing:border-box;width:100%;padding:.8rem;margin:.4rem 0 1rem}button{background:#1455a2;color:#fff;border:0;border-radius:.35rem;cursor:pointer}.error{color:#a21b1b}</style>
</head><body><h1>Telegram MCP 연결 승인</h1>
<p><strong>${escapeHtml(clientName)}</strong>에서 개인 Telegram 채팅을 읽는 도구를 사용하려고 합니다. 이 서버는 메시지를 보내는 도구를 제공하지 않습니다.</p>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<form method="post" autocomplete="off"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<label for="owner-token">소유자 토큰</label><input id="owner-token" name="owner_token" type="password" required autocomplete="off">
<button type="submit">이 클라이언트에 읽기 권한 허용</button></form>
<p>토큰은 이 페이지에서만 확인하며 클라이언트에 전달되지 않습니다.</p></body></html>`;
}

function response(html, csrf) {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "Set-Cookie": `__Host-telegram-csrf=${csrf}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`,
    },
  });
}

function cookie(request, name) {
  const match = request.headers.get("Cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1];
}

function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const authHandler = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== AUTHORIZE_PATH) return new Response("Not found", { status: 404 });
    if (request.method !== "GET" && request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    let oauthRequest;
    try {
      oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    } catch (error) {
      if (error?.name !== "AuthorizationError") throw error;
      if (!error.redirectUri) return new Response(error.description, { status: 400 });
      const redirect = new URL(error.redirectUri);
      redirect.searchParams.set("error", error.code);
      redirect.searchParams.set("error_description", error.description);
      if (error.state) redirect.searchParams.set("state", error.state);
      if (error.issuer) redirect.searchParams.set("iss", error.issuer);
      return Response.redirect(redirect, 302);
    }

    const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
    if (!client || !oauthRequest.scope.includes(SCOPE)) return new Response("Invalid client or scope", { status: 400 });
    const clientName = client.clientName || client.clientId;
    if (request.method === "GET") {
      const csrf = randomToken();
      return response(page(clientName, csrf), csrf);
    }

    if (!request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded") ||
        Number(request.headers.get("Content-Length") || 0) > 4096) {
      return new Response("Invalid form", { status: 400 });
    }
    const form = await request.formData();
    const csrf = cookie(request, "__Host-telegram-csrf");
    if (!csrf || form.get("csrf") !== csrf) return new Response("Invalid form", { status: 403 });
    const token = form.get("owner_token");
    const tokenRequest = new Request(RESOURCE, { headers: { Authorization: `Bearer ${typeof token === "string" ? token : ""}` } });
    if (!(await verifyBearerToken(tokenRequest, env))) {
      const nextCsrf = randomToken();
      return response(page(clientName, nextCsrf, "토큰이 올바르지 않습니다."), nextCsrf);
    }

    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthRequest,
      userId: "telegram-owner",
      metadata: { clientName },
      scope: [SCOPE],
      props: { userId: "telegram-owner" },
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: redirectTo,
        "Set-Cookie": "__Host-telegram-csrf=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  },
};
