"""One-time interactive Telegram login.

Prompts for your phone number and the login code Telegram sends you, then
prints a Telethon StringSession to store as TG_SESSION_STRING in .env.

This session string grants full access to your Telegram account — never
share it or commit it to git.

Usage:
    TG_API_ID=... TG_API_HASH=... python scripts/login.py
"""

import asyncio
import os
import sys

from telethon import TelegramClient
from telethon.sessions import StringSession


async def main() -> None:
    api_id = os.environ.get("TG_API_ID") or input("TG_API_ID: ").strip()
    api_hash = os.environ.get("TG_API_HASH") or input("TG_API_HASH: ").strip()

    client = TelegramClient(StringSession(), int(api_id), api_hash)
    await client.start(
        phone=lambda: input("전화번호 (+국가코드 포함, 예: +821012345678): ").strip(),
        code_callback=lambda: input("텔레그램으로 받은 로그인 코드: ").strip(),
        password=lambda: input("2단계 인증 비밀번호(설정한 경우): ").strip(),
    )

    me = await client.get_me()
    session_string = client.session.save()

    print("\n로그인 성공:", me.first_name, f"(@{me.username})" if me.username else "")
    print("\n아래 값을 .env 의 TG_SESSION_STRING 에 저장하세요 (절대 공유/커밋 금지):\n")
    print(session_string)

    await client.disconnect()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(1)
