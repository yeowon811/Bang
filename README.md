# K-뉴딜 2기 뱅

숨은 역할 + 거리 기반 총격전 온라인 카드 게임. 카드 80장(갈색 63 + 파란 17), 캐릭터 16명, 2~7명 (4명 미만은 테스트 모드).

- 게임: https://yeowon811.github.io/Bang/
- 관리자: https://yeowon811.github.io/Bang/#/admin (지정된 Google 계정만)

## 구조 (서버 없음, 무료)

| 역할 | 담당 |
|---|---|
| 웹사이트 | GitHub Pages (main 에 push 하면 자동 배포, `.github/workflows/deploy.yml`) |
| 실시간 통신·저장 | Firebase Realtime Database (`src/net.ts`) |
| 게임 진행 (규칙·봇·제한 시간) | **방장 브라우저** (`src/host.ts`) |
| 로그인 | Firebase Auth — 플레이어는 익명, 관리자는 Google |
| 보안 | `database.rules.json` — 각자 자기 손패·역할만 읽기 가능 |

방장은 규칙 판정을 위해 전체 정보를 갖고 있으므로 친구끼리 하는 용도입니다. 방장이 나가면 게임이 멈추고, 돌아오면 이어집니다.

## 로컬 실행

```bash
npm install
npm run dev
```

http://localhost:5173 — 탭마다 다른 플레이어로 접속됩니다. (PowerShell 실행 정책 오류 시 `npm.cmd run dev` 또는 `dev.cmd` 더블클릭)

## Firebase 설정 (처음 한 번)

1. Authentication → Sign-in method: **익명**, **Google** 사용 설정
2. Authentication → 설정 → 승인된 도메인: `yeowon811.github.io` 추가
3. Realtime Database → 규칙: `database.rules.json` 내용 붙여넣고 게시 (규칙을 바꿀 때마다)
4. GitHub 저장소 Settings → Pages → Source: **GitHub Actions**

관리자 계정을 바꾸려면 `src/firebase.ts` 의 `ADMIN_EMAILS` 와 `database.rules.json` 의 이메일을 함께 바꾸세요.

## 폴더

| 경로 | 내용 |
|---|---|
| `shared/cards.ts`, `shared/characters.ts` | 카드·캐릭터 정의 |
| `shared/engine.ts` | 규칙 엔진 (순수 로직) |
| `shared/bot.ts` | 봇 AI |
| `shared/*.test.ts` | 테스트 (`npm test`) |
| `src/host.ts` | 방장 브라우저의 게임 진행 |
| `src/net.ts` | Firebase 통신 |
| `src/Game.tsx`, `src/App.tsx`, `src/Admin.tsx` | 게임·로비·관리자 화면 |

## 관리자 화면

카드 22종, 캐릭터 16명, 역할 4종, 카드 뒷면의 이름·설명·이미지를 바꿀 수 있습니다. 이미지는 400×600 이하 WEBP 로 줄여 데이터베이스에 저장되며, 바꾸면 접속 중인 모든 화면에 바로 반영됩니다. "오래된 방 정리"로 하루 지난 방을 지워 무료 용량을 관리하세요.

## 무료 한도 (Firebase Spark)

동시 접속 100명, 저장 1GB, 월 다운로드 10GB.
