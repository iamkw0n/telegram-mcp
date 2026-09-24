const encoder = new TextEncoder();
let jwksPromise;

function decodeBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function decodeJson(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function getKeys(teamDomain) {
  const response = await fetch(`${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error("Cloudflare Access key retrieval failed");
  const data = await response.json();
  if (!Array.isArray(data.keys)) throw new Error("Invalid Cloudflare Access key response");
  return data.keys;
}

export async function verifyAccess(request, env) {
  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD || !env.ALLOWED_EMAIL) {
    throw new Error("Cloudflare Access configuration is incomplete");
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return false;
  const segments = token.split(".");
  if (segments.length !== 3) return false;
  try {
    const [headerPart, payloadPart, signaturePart] = segments;
    const header = decodeJson(headerPart);
    const payload = decodeJson(payloadPart);
    if (header.alg !== "RS256" || typeof header.kid !== "string") return false;
    const teamDomain = new URL(env.CF_ACCESS_TEAM_DOMAIN).origin;
    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== teamDomain ||
        !Array.isArray(payload.aud) || !payload.aud.includes(env.CF_ACCESS_AUD) ||
        !Number.isFinite(payload.exp) || payload.exp <= now ||
        (payload.nbf !== undefined && payload.nbf > now) ||
        String(payload.email ?? "").toLowerCase() !== env.ALLOWED_EMAIL.toLowerCase()) return false;
    jwksPromise ??= getKeys(teamDomain).catch((error) => { jwksPromise = undefined; throw error; });
    const keys = await jwksPromise;
    const jwk = keys.find((key) => key.kid === header.kid && key.kty === "RSA");
    if (!jwk) return false;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decodeBase64Url(signaturePart), encoder.encode(`${headerPart}.${payloadPart}`));
  } catch {
    return false;
  }
}
