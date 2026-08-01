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

MCP_AUTH_TOKEN = _require("MCP_AUTH_TOKEN")
MCP_HOST = os.environ.get("MCP_HOST", "0.0.0.0")
MCP_PORT = int(os.environ.get("MCP_PORT", "8811"))
