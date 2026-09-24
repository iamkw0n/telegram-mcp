const encoder = new TextEncoder();

export async function verifyBearerToken(request, env) {
  const secret = env.MCP_AUTH_TOKEN;
  if (typeof secret !== "string" || secret.length < 32) return false;

  const authorization = request.headers.get("Authorization");
  if (!authorization || authorization.length > 520 || !authorization.startsWith("Bearer ")) return false;
  const provided = authorization.slice(7);
  if (!provided || provided.includes(" ")) return false;

  const [expectedHash, providedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(secret)),
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
  ]);
  const expected = new Uint8Array(expectedHash);
  const actual = new Uint8Array(providedHash);
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected[index] ^ actual[index];
  return difference === 0;
}
