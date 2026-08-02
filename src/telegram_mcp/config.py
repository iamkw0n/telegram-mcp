import os

from dotenv import load_dotenv

load_dotenv()


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


TG_API_ID = int(_require("TG_API_ID"))
TG_API_HASH = _require("TG_API_HASH")
TG_SESSION_STRING = _require("TG_SESSION_STRING")

# Optional: if unset, the server runs with no auth (fine only when access is
# already gated elsewhere, e.g. Cloudflare Access in front of a named tunnel,
# or a short-lived unguessable quick-tunnel URL used for local testing).
MCP_AUTH_TOKEN = os.environ.get("MCP_AUTH_TOKEN") or None
MCP_HOST = os.environ.get("MCP_HOST", "0.0.0.0")
MCP_PORT = int(os.environ.get("MCP_PORT", "8811"))
