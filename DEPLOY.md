# 배포 가이드

서버 1대(Node.js)가 게임 서버, 웹 페이지, 관리자 API를 모두 담당합니다.
Docker를 지원하는 곳이면 어디든 올릴 수 있습니다.

## 꼭 알아둘 점

| 항목 | 내용 |
|---|---|
| **ADMIN_KEY** | 필수. 8자 이상이어야 하고, 없으면 서버가 시작되지 않습니다. 관리자 화면 비밀번호입니다. |
| **영구 저장소** | 카드 이름/이미지 설정은 `STORAGE_DIR`(기본 `/data`)에 저장됩니다. 볼륨/디스크를 연결하지 않으면 재배포 때 업로드한 이미지가 사라집니다. |
| **진행 중인 게임** | 메모리에 있으므로 서버 재시작/재배포 시 진행 중인 방은 사라집니다. 사람이 적은 시간에 배포하세요. |
| **인스턴스 1개** | 방 정보를 서버 메모리에 두기 때문에 인스턴스는 **1개만** 실행해야 합니다 (오토스케일 끄기). |
| **WebSocket** | 실시간 통신에 WebSocket을 씁니다. 아래 서비스들은 기본 지원합니다. |

## 환경 변수

| 이름 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `ADMIN_KEY` | ✅ | — | 관리자 키 (8자 이상) |
| `STORAGE_DIR` | | `/data` (Docker) | 카드 설정·이미지 저장 경로 |
| `PORT` | | `3000` | 대부분의 호스팅이 자동 지정 |
| `TURN_TIMEOUT` | | `60000` | 턴 제한 시간 (ms) |
| `RESPONSE_TIMEOUT` | | `20000` | 응답·선택 제한 시간 (ms) |
| `OFFLINE_GRACE` | | `20000` | 연결 끊긴 사람을 봇이 대신하기까지 (ms) |
| `BOT_DELAY` | | `900` | 봇 행동 간격 (ms) |

## 방법 A — Render (가장 간단)

1. 코드를 GitHub 저장소에 올립니다.
2. [Render](https://render.com) → **New → Blueprint** → 저장소 선택. `render.yaml`이 자동으로 읽힙니다.
3. 생성 후 대시보드 **Environment**에서 자동 생성된 `ADMIN_KEY` 값을 확인합니다.
4. 발급된 `https://…onrender.com` 주소로 접속합니다.

> 영구 디스크는 유료(Starter, 월 약 $7)부터입니다. 무료 플랜으로 하려면 `render.yaml`에서 `plan: free`로 바꾸고 `disk` 항목을 지우세요. 단, 업로드 이미지가 재배포 때 사라지고 15분 동안 접속이 없으면 서버가 잠듭니다.

## 방법 B — Fly.io

```bash
fly launch --no-deploy          # Dockerfile 자동 인식, 지역은 nrt(도쿄) 추천
fly volumes create showdown_data --size 1
fly secrets set ADMIN_KEY=여기에-긴-랜덤-문자열
```

생성된 `fly.toml`에 아래를 추가한 뒤 `fly deploy`:

```toml
[mounts]
  source = "showdown_data"
  destination = "/data"

[http_service]
  internal_port = 3000
  auto_stop_machines = "off"   # 게임 중 서버가 멈추지 않도록
  min_machines_running = 1
```

## 방법 C — 직접 서버 (VPS 등)

```bash
docker build -t showdown .
docker run -d --name showdown -p 80:3000 \
  -e ADMIN_KEY=여기에-긴-랜덤-문자열 \
  -v showdown-data:/data \
  --restart unless-stopped showdown
```

HTTPS는 앞단에 Caddy/Nginx 같은 리버스 프록시를 두고 WebSocket 업그레이드(`/socket.io`)를 허용하세요.

## Docker 없이 실행

```bash
npm ci
npm run build
NODE_ENV=production ADMIN_KEY=긴-랜덤-문자열 STORAGE_DIR=./storage npm start
```

## 배포 후 확인

- `https://내주소/healthz` → `{"ok":true,...}`
- `https://내주소/admin` → 관리자 키로 로그인, 이미지 하나 업로드 → 재배포 후에도 남아 있는지 확인
- 휴대폰과 PC에서 같은 방에 들어가 게임 진행
