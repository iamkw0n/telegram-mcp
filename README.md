# telegram-mcp

내 텔레그램(개인 계정)의 채팅 폴더, 채널/그룹 목록, 최근 메시지를 **읽기 전용**으로 노출하는 원격 MCP 서버입니다. ChatGPT와 Claude에 "커스텀 커넥터"로 등록해서 사용합니다.

봇 API가 아니라 **텔레그램 사용자 계정으로 로그인**(MTProto, [Telethon](https://docs.telethon.dev/))하기 때문에, 봇을 초대하지 않은 채널이나 "채팅 폴더" 같은 개인 계정 전용 기능도 볼 수 있습니다. 대신 세션 문자열이 계정 전체에 대한 접근 권한과 동일하므로 보안에 각별히 주의하세요.

## 제공 도구 (전부 읽기 전용)

| 도구 | 설명 |
|---|---|
| `list_chat_folders()` | 채팅 폴더 목록(제목, 포함된 채팅 수) |
| `list_chats_in_folder(folder_title)` | 특정 폴더에 포함된 채팅/채널 목록 |
| `list_dialogs(query?, limit?)` | 전체 대화 목록 조회/검색 (채팅 이름 확인용) |
| `get_chat_info(chat)` | 특정 채팅의 기본 정보 |
| `get_recent_messages(chat, limit?)` | 특정 채팅의 최신 메시지 N개 |

메시지 발송 등 쓰기 기능은 의도적으로 구현하지 않았습니다.

## 1. 사전 준비: Telegram API 자격증명 발급

1. https://my.telegram.org 접속 → 본인 전화번호로 로그인.
2. **API development tools** 메뉴에서 새 앱 생성 (이름/플랫폼은 아무 값이나 가능).
3. 발급된 **api_id**, **api_hash** 를 기록해둡니다. (제3자에게 대행 불가 — 본인 인증 필요)

## 2. 설치

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e .
cp .env.example .env
```

`.env` 에 `TG_API_ID`, `TG_API_HASH` 를 채워 넣습니다.

`MCP_AUTH_TOKEN` 은 선택 사항입니다:
- **Claude Code CLI 등 커스텀 헤더를 지원하는 클라이언트**로 붙일 계획이면, 아래로 랜덤 토큰을 생성해 넣으세요. 모든 요청에 `Authorization: Bearer <토큰>` 이 필요해집니다.
  ```bash
  python -c "import secrets; print(secrets.token_urlsafe(32))"
  ```
- **Claude.ai의 "커스텀 커넥터 추가" 화면**은 고정 토큰을 넣는 칸이 없고 OAuth만 지원하므로, 이 값을 비워두면 서버가 인증 없이 동작합니다. 이 경우 접근 제어는 URL 자체의 비공개성(임시 trycloudflare.com URL) 또는 앞단의 Cloudflare Access(아래 5절)에 맡기게 됩니다.

## 3. 텔레그램 로그인 (최초 1회, 대화형)

```bash
source .venv/bin/activate
set -a; source .env; set +a
python scripts/login.py
```

전화번호 입력 → 텔레그램 앱(또는 SMS)으로 받은 로그인 코드 입력 → (2단계 인증을 켜둔 경우) 비밀번호 입력. 완료되면 세션 문자열이 출력됩니다. 이 값을 `.env`의 `TG_SESSION_STRING`에 저장하세요.

**세션 문자열은 비밀번호와 동일한 권한을 가집니다. 절대 커밋하거나 공유하지 마세요.** (`.gitignore`에 `.env`가 이미 포함되어 있습니다.)

## 4. 서버 실행

```bash
source .venv/bin/activate
set -a; source .env; set +a
python -m telegram_mcp.server
```

기본적으로 `http://0.0.0.0:8811/mcp` 에서 Streamable HTTP MCP 엔드포인트가 열립니다. `MCP_AUTH_TOKEN`을 설정했다면 모든 요청에 `Authorization: Bearer <MCP_AUTH_TOKEN>` 헤더가 필요하고, 비워뒀다면 인증 없이 열려 있습니다.

## 5. 외부에 공개하기 (Cloudflare Tunnel)

### 지금 당장 테스트용 (임시 URL)
```bash
cloudflared tunnel --url http://localhost:8811
```
콘솔에 출력되는 `https://xxxx.trycloudflare.com` 이 외부에서 접근 가능한 URL입니다. (프로세스를 끄면 URL도 사라짐 — 테스트/검증용)

### 나중에: 본인 서버 + 도메인으로 영구 운영
1. 이 저장소를 실제로 상시 켜둘 서버에 clone.
2. 위 2~4단계(설치, 로그인, 서버 실행)를 그 서버에서 동일하게 수행 (systemd 서비스 등으로 상시 구동 추천).
3. Cloudflare Zero Trust에서 [Named Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/) 생성 후 본인 도메인의 서브도메인(예: `telegram-mcp.example.com`)을 `http://localhost:8811` 로 라우팅.
4. **[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)로 그 서브도메인에 로그인(본인 이메일 등)을 요구하도록 설정** — 앱이 자체 OAuth 서버를 구현하지 않아도, 터널 앞단에서 본인만 접근하도록 막는 표준적인 방법입니다. (이 경우 `.env`의 `MCP_AUTH_TOKEN`은 비워둬도 되고, 이중 방어로 같이 써도 됩니다 — Claude Code CLI처럼 헤더를 지원하는 클라이언트에서만 유효.)
5. ChatGPT/Claude 커넥터 URL을 그 영구 도메인으로 교체.

## 6. ChatGPT / Claude에 커넥터로 등록

- **URL**: `https://<터널 또는 도메인>/mcp`
- **인증**:
  - Claude.ai "커스텀 커넥터 추가" 화면은 OAuth 클라이언트 ID/시크릿만 입력 가능하고 고정 토큰 입력 칸이 없습니다. `MCP_AUTH_TOKEN`을 비워둔 채로 URL만 입력하고 OAuth 필드는 비워두세요.
  - Claude Code CLI 등 커스텀 헤더 설정이 가능한 클라이언트라면 `MCP_AUTH_TOKEN`을 설정하고 `Authorization: Bearer <토큰>` 헤더로 붙이면 됩니다.

각 서비스의 "커스텀 커넥터/MCP 서버 추가" 설정 화면에서 위 URL을 입력하면 됩니다. (UI 경로는 두 서비스 모두 자주 바뀌므로, 설정 메뉴에서 "Connectors" 또는 "MCP" 항목을 찾으세요.)

## 보안 주의사항

- `TG_SESSION_STRING`, `MCP_AUTH_TOKEN`, `TG_API_HASH` 는 모두 비밀값입니다. `.env` 밖으로 노출/커밋하지 마세요.
- `MCP_AUTH_TOKEN` 인증은 정적 토큰 검증(개인 단일 사용자용 간이 방식)이며, Claude.ai 커넥터 UI에서는 애초에 사용할 수 없습니다. 그 경로에서는 URL 비공개성 또는 Cloudflare Access 같은 앞단 게이트에 의존하세요.
- 이 서버는 읽기 전용이지만, 텔레그램 계정 전체(모든 채팅)를 읽을 수 있는 자격증명을 사용하므로 토큰 유출 시 피해 범위가 큽니다. 터널 URL/토큰을 신뢰할 수 있는 곳에만 사용하세요.
