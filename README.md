# telegram-mcp

Cloudflare Workers 배포 및 `https://verdian.io.kr/mcp/telegram` 토큰 인증 설정은 [WORKER_DEPLOYMENT.md](WORKER_DEPLOYMENT.md)를 참고하세요. 아래 터널과 GitHub OAuth 안내는 로컬 Python 서버용입니다.

내 텔레그램(개인 계정)의 채팅 폴더, 채널/그룹 목록, 최근 메시지를 **읽기 전용**으로 노출하는 원격 MCP 서버입니다. ChatGPT와 Claude에 "커스텀 커넥터"로 등록해서 사용합니다.

봇 API가 아니라 **텔레그램 사용자 계정으로 로그인**(MTProto, [Telethon](https://docs.telethon.dev/))하기 때문에, 봇을 초대하지 않은 채널이나 "채팅 폴더" 같은 개인 계정 전용 기능도 볼 수 있습니다. 대신 세션 문자열이 계정 전체에 대한 접근 권한과 동일하므로 보안에 각별히 주의하세요.

## 제공 도구 (전부 읽기 전용)

| 도구 | 설명 |
|---|---|
| `list_chat_folders()` | 채팅 폴더 목록(제목, 포함된 채팅 수) |
| `list_chats_in_folder(folder_title)` | 특정 폴더에 포함된 채팅/채널 목록 |
| `list_dialogs(query?, limit?)` | 전체 대화 목록 조회/검색 (채팅 이름 확인용) |
| `get_chat_info(chat)` | 특정 채팅의 기본 정보 |
| `list_topics(chat)` | 채팅 내부의 포럼 토픽(주제별 하위방) 목록 |
| `get_recent_messages(chat, limit?, topic?)` | 특정 채팅(또는 토픽)의 최신 메시지 N개 |
| `search_messages(chat, query, topic?, limit?)` | 특정 채팅(또는 토픽)에서 키워드로 메시지 검색 |
| `get_message_photo(chat, message_id)` | 메시지에 첨부된 사진을 다운로드해서 이미지로 반환 |

일부 슈퍼그룹은 "포럼 토픽" 기능으로 하나의 방 안에 "차트 스쿨", "공지방" 같은 하위 주제방이 나뉘어 있습니다. 이런 하위 주제방은 별도의 대화(dialog)가 아니라서 `list_dialogs`/`list_chats_in_folder`에는 안 보입니다 — `list_topics`로 먼저 목록을 확인하고, `get_recent_messages`/`search_messages`의 `topic` 인자로 주제명을 넘겨서 읽으세요.

`get_recent_messages`/`search_messages`가 반환하는 각 메시지에는 `has_media`/`media_type`이 포함됩니다. `media_type`이 `"photo"`인 메시지를 실제로 보려면 그 메시지의 `id`를 `get_message_photo(chat, message_id)`에 넘기세요 (문서/동영상 등 다른 첨부파일은 아직 다운로드를 지원하지 않습니다).

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

`.env` 에 `TG_API_ID`, `TG_API_HASH` 를 채워 넣습니다. (인증/`MCP_*` 값은 4단계에서 채웁니다.)

## 3. 텔레그램 로그인 (최초 1회, 대화형)

```bash
source .venv/bin/activate
set -a; source .env; set +a
python scripts/login.py
```

전화번호 입력 → 텔레그램 앱(또는 SMS)으로 받은 로그인 코드 입력 → (2단계 인증을 켜둔 경우) 비밀번호 입력. 완료되면 세션 문자열이 출력됩니다. 이 값을 `.env`의 `TG_SESSION_STRING`에 저장하세요.

**세션 문자열은 비밀번호와 동일한 권한을 가집니다. 절대 커밋하거나 공유하지 마세요.** (`.gitignore`에 `.env`가 이미 포함되어 있습니다.)

## 4. 외부 공개 URL 먼저 확보 (Cloudflare Tunnel)

인증 방식(특히 GitHub OAuth)을 설정하려면 외부에서 접근 가능한 URL이 먼저 필요하므로, 서버를 켜기 전에 터널부터 열어 URL을 확보합니다.

### 지금 당장 테스트용 (임시 URL)
```bash
cloudflared tunnel --url http://localhost:8811
```
콘솔에 출력되는 `https://xxxx.trycloudflare.com` 을 기록해두세요. (아직 서버가 안 떠 있어서 502가 떠도 정상 — URL만 먼저 확보하는 단계입니다. 프로세스를 끄면 URL도 사라짐 — 테스트/검증용.)

### 나중에: 본인 서버 + 도메인으로 영구 운영
1. 이 저장소를 실제로 상시 켜둘 서버에 clone.
2. Cloudflare Zero Trust에서 [Named Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/) 생성 후 본인 도메인의 서브도메인(예: `telegram-mcp.example.com`)을 `http://localhost:8811` 로 라우팅. 이 고정 도메인을 아래 단계들의 URL로 사용하면 됩니다.
3. 선택: [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)로 그 서브도메인 자체에도 로그인을 요구하도록 설정하면 이중 방어가 됩니다.

## 5. 인증 설정

`.env`에서 아래 **둘 중 하나**를 선택해 채웁니다 (둘 다 설정하면 GitHub OAuth가 우선됩니다).

### 옵션 A — GitHub OAuth (Claude.ai 커넥터용, 권장)

Claude.ai의 "커스텀 커넥터 추가" 화면은 OAuth만 지원하고 고정 토큰 입력 칸이 없습니다. GitHub 로그인으로 게이트를 걸고, 로그인에 성공해도 **본인 GitHub 계정이 아니면 도구 호출 자체를 거부**하도록 서버에 이미 구현되어 있습니다.

1. https://github.com/settings/developers → **OAuth Apps** → **New OAuth App**
2. Homepage URL: 4단계에서 받은 터널 URL (예: `https://xxxx.trycloudflare.com`)
3. Authorization callback URL: 그 URL + `/auth/callback` (예: `https://xxxx.trycloudflare.com/auth/callback`)
4. 생성 후 **Client ID** 확인, **Generate a new client secret** 로 시크릿 발급
5. `.env`에 입력:
   ```
   PUBLIC_BASE_URL=https://xxxx.trycloudflare.com   # 터널 URL, 끝에 슬래시 없이
   GITHUB_OAUTH_CLIENT_ID=...
   GITHUB_OAUTH_CLIENT_SECRET=...
   GITHUB_ALLOWED_USERNAME=본인의-github-아이디
   ```

⚠️ 임시 터널(`trycloudflare.com`)은 `cloudflared`를 재시작할 때마다 URL이 바뀝니다. URL이 바뀌면 GitHub OAuth App의 Homepage/Callback URL과 `.env`의 `PUBLIC_BASE_URL`을 다시 맞춰줘야 합니다. 검증하는 동안은 cloudflared를 끄지 말고 계속 켜두세요.

### 옵션 B — 고정 토큰 (Claude Code CLI 등 커스텀 헤더 지원 클라이언트용)

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```
결과를 `.env`의 `MCP_AUTH_TOKEN`에 저장. 모든 요청에 `Authorization: Bearer <토큰>` 헤더가 필요해집니다.

### 아무것도 설정하지 않으면

서버가 인증 없이 열립니다. Cloudflare Access 등으로 앞단이 이미 보호되고 있을 때만 사용하세요.

## 6. 서버 실행

```bash
source .venv/bin/activate
set -a; source .env; set +a
python -m telegram_mcp.server
```

`http://0.0.0.0:8811/mcp` 에서 Streamable HTTP MCP 엔드포인트가 열립니다 (4단계에서 이미 열어둔 터널이 그대로 이 포트를 가리키고 있어야 합니다).

## 7. ChatGPT / Claude에 커넥터로 등록

- **URL**: `https://<터널 또는 도메인>/mcp`
- GitHub OAuth(옵션 A)를 설정했다면 Claude.ai 쪽 "OAuth 클라이언트 ID/시크릿" 칸은 **비워둔 채** URL만 입력하고 추가하면 됩니다 — Claude가 자동으로 클라이언트를 등록하고 GitHub 로그인 화면으로 안내합니다.
- 고정 토큰(옵션 B)을 설정했다면, 헤더 설정이 가능한 클라이언트에서 `Authorization: Bearer <토큰>` 으로 붙이세요.

각 서비스의 "커스텀 커넥터/MCP 서버 추가" 설정 화면에서 위 URL을 입력하면 됩니다. (UI 경로는 두 서비스 모두 자주 바뀌므로, 설정 메뉴에서 "Connectors" 또는 "MCP" 항목을 찾으세요.)

## 보안 주의사항

- `TG_SESSION_STRING`, `TG_API_HASH`, `GITHUB_OAUTH_CLIENT_SECRET`, `MCP_AUTH_TOKEN` 은 모두 비밀값입니다. `.env` 밖으로 노출/커밋하지 마세요.
- GitHub OAuth 경로는 `GITHUB_ALLOWED_USERNAME`과 일치하는 계정으로 로그인했을 때만 도구 호출이 허용되도록 미들웨어에서 검증합니다 (`src/telegram_mcp/server.py`의 `OwnerOnlyMiddleware`). 다른 GitHub 계정은 로그인은 되어도 도구 호출 시 거부됩니다.
- 이 서버는 읽기 전용이지만, 텔레그램 계정 전체(모든 채팅)를 읽을 수 있는 자격증명을 사용하므로 유출 시 피해 범위가 큽니다. 터널 URL/토큰/시크릿을 신뢰할 수 있는 곳에만 사용하세요.
