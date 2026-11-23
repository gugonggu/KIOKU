# KIOKU — Japan Travel Planner

한국어 사용자를 위한 일본 여행 수첩입니다. 이메일로 로그인해 내 여행을 생성·편집하고, 여행 수첩에서 일본 현지 날짜별 일정과 후보함을 관리할 수 있습니다.

## 로컬 실행

Node.js 24와 npm이 필요합니다.

```powershell
npm ci
npm run dev
```

브라우저에서 [localhost:3000](http://localhost:3000)을 엽니다. Supabase 설정을 생략하면 로그인 화면에서 설정 안내를 볼 수 있습니다. 비로그인 사용자가 `/trips` 또는 `/trips/new`를 열면 `/login`으로 이동합니다.

여행·일정 저장을 사용하려면 아래 인증 설정과 [M1·M2 마이그레이션](supabase/README.md)을 같은 Supabase 인스턴스에 적용합니다.

## 집과 회사 PC에서 이어서 개발하기

두 PC에서 같은 GitHub 저장소와 작업 브랜치를 사용합니다. 다른 PC로 옮기기 전에 `git status`를 확인하고, 이어서 작업할 변경은 검토한 뒤 커밋하여 프로젝트 소유자가 GitHub에 반영합니다. 새 PC에서는 저장소를 클론하거나 기존 체크아웃을 빠른 병합으로 갱신합니다(`git pull --ff-only`). Codex와 Claude Code는 PC별로 로그인하고, [공통 작업 규칙](AGENTS.md)과 Git 이력을 읽은 뒤 작업을 시작합니다.

볼트에서는 환경 파일을 `KIOKU/env/env.local`로 보관합니다. Obsidian에서 `설정 → 파일 및 링크 → 모든 파일 유형 표시`를 켜고, Google Drive Sync의 수동 전송 목록에 `KIOKU/env/env.local`이 표시되는지 확인합니다. 회사 PC에서는 같은 옵션을 켜고 사용자가 수동으로 가져옵니다. 볼트의 `README.md`와 `MANIFEST.md`도 함께 전송합니다. [Google Drive Sync 플러그인 안내](https://github.com/RichardX366/Obsidian-Google-Drive#notes)

Obsidian 볼트의 루트 경로를 현재 PowerShell 세션에 지정합니다. 다음 명령은 저장소 루트에서 실행합니다. `-VaultRoot`를 직접 넘기면 환경변수보다 우선합니다.

```powershell
$env:KIOKU_VAULT_ROOT = '<이 PC의 Obsidian 볼트 루트>'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\sync-local-files.ps1 -Direction Import -DryRun
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\sync-local-files.ps1 -Direction Import
npm ci
npm run dev
```

Windows PowerShell 5.1에서 위 `-ExecutionPolicy Bypass`는 해당 자식 프로세스에만 적용됩니다. 회사 정책이 우선하며, 정책상 허용된 방법으로 실행합니다. 홈 PC의 확인 버전은 Node.js `24.11.1`, npm `11.6.2`입니다. `npm ci`는 저장소의 잠금 파일에 맞춰 의존성을 설치합니다.

설정을 수정한 PC에서는 같은 명령의 방향을 `Export`로 바꾸어 미리 본 후 내보냅니다. 스크립트는 저장소 루트의 `.env.local`과 볼트의 `KIOKU/env/env.local`을 비교합니다. 같은 파일은 건너뛰고, 내용이 다르면 중단합니다. 원본 방향을 확인한 뒤 `-Force`를 추가하면 기존 대상이 대상 쪽 `.kioku-local-backups` 폴더에 백업됩니다. `-DryRun -Force`로 덮어쓰기와 백업 위치를 함께 확인할 수 있습니다. 교체 백업은 각 PC에서 관리합니다.

Git에는 소스, 마이그레이션, 테스트, 비밀값 없는 `.env.example`, 복사 스크립트와 공통 규칙을 보관합니다. 실제 여행 정보가 포함될 수 있는 내부 `docs/` 및 `reference/` 원본은 기존 로컬 보관을 사용합니다. 작업을 이어 받을 때 관련 내부 요구사항이 필요하면 프로젝트 소유자에게 확인합니다.

Windows에서 `listen EACCES`로 개발 서버가 시작되지 않으면 `netsh interface ipv4 show excludedportrange protocol=tcp`로 예약된 포트를 확인합니다. 회사 PC에서 3000번이 예약되어 있으면 `npm run dev -- --port 4000`으로 실행하고 해당 PC의 `APP_URL`을 브라우저에서 여는 주소에 맞춥니다. 매직 링크를 사용하려면 Supabase **Authentication → URL Configuration → Redirect URLs**에 `http://localhost:4000/auth/confirm`을 추가합니다. 집 PC가 3000번을 사용하면 기존 Site URL과 콜백 허용 항목을 유지합니다.

회사 PC에서 로컬 포트를 바꾼 `.env.local`은 볼트로 내보내지 않습니다. 볼트에서 다시 가져오면 회사 PC의 `APP_URL`을 다시 맞춰야 합니다.

## Supabase 이메일 로그인 설정

1. `Copy-Item .env.example .env.local`로 로컬 설정 파일을 만들고 아래 값을 입력합니다.

   | 변수 | 값 |
   | --- | --- |
   | `APP_URL` | 브라우저에서 앱을 여는 주소의 오리진. 로컬 예시 `http://localhost:3000` |
   | `SUPABASE_URL` | Supabase 프로젝트 URL |
   | `SUPABASE_PUBLISHABLE_KEY` | 프로젝트의 Publishable 키(`sb_publishable_…`) |

2. Supabase **Authentication → URL Configuration**에서 Site URL을 `APP_URL`과 맞추고 Redirect URLs에 `http://localhost:3000/auth/confirm`을 추가합니다. 브라우저 주소가 다르면 `APP_URL`과 허용 목록에도 같은 오리진을 사용합니다.
3. Supabase 기본 매직 링크 템플릿은 그대로 사용할 수 있습니다. 기본 링크는 PKCE 방식이므로 요청을 시작한 브라우저에서 가장 최근 이메일의 링크를 엽니다. 신규 Free 프로젝트가 기본 SMTP를 쓰면 템플릿 수정이 제한되고 조직 팀 이메일로만 발송할 수 있습니다. 이미 커스텀 SMTP와 토큰 해시 템플릿을 쓰고 있다면 기존 `/auth/confirm`의 `token_hash`와 `type=email` 흐름도 지원합니다.

4. **Authentication → Users**에서 본인 테스트 계정을 사전에 등록하고 Email 제공자 및 SMTP 발신 설정을 확인합니다. 링크 요청에서 자동 가입을 끕니다.
5. 개발 서버를 재시작한 뒤 이메일을 제출합니다. 받은 링크를 열면 서버에서 검증하고 `/trips`로 이동합니다. 여행 메뉴에서 로그아웃한 뒤 `/trips` 재접근이 차단되는지 확인합니다.

`.env.local`에 서비스 역할 키를 넣을 필요가 없습니다. 앱은 서버에서 Supabase 토큰을 검증하고, HTTPS에서 Secure 속성을 적용한 HttpOnly 쿠키를 사용합니다. 배포 환경에서 인증 확인 경로의 쿼리 문자열과 쿠키가 프록시 또는 접근 로그에 수집되지 않도록 설정합니다. 메일 보안 프로그램이 링크를 먼저 열면 1회용 링크가 소비될 수 있습니다. 이 경우 새 링크를 요청하고, 커스텀 SMTP의 링크 추적 기능도 확인합니다.

[Supabase SSR 설정](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&queryGroups=framework) · [매직 링크와 이메일 템플릿](https://supabase.com/docs/guides/auth/auth-email-passwordless) · [SMTP 설정](https://supabase.com/docs/guides/auth/auth-smtp)

## 검사 및 테스트

```powershell
npm run lint
npm run typecheck
npm run test:unit
npm run test:db
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\sync-local-files.test.ps1
npm run build
npx playwright install chromium
npm test
```

Playwright는 위 빌드를 사용하여 기본 루프백 포트 3100~3102에서 앱과 테스트용 인증·데이터 API를 실행합니다. 테스트용 API는 실제 마이그레이션을 적용한 인메모리 PostgreSQL(PGlite)을 사용합니다. 기본 포트가 예약되어 있으면 사용 가능한 연속 포트 세 개의 시작 번호를 PowerShell에서 지정합니다. 회사 PC 예시는 4100~4102를 사용합니다.

```powershell
npm run build
$env:PLAYWRIGHT_BASE_PORT = '4100'
npm test
Remove-Item Env:PLAYWRIGHT_BASE_PORT
```

설치된 Chrome을 사용하려면 PowerShell에서 `$env:PLAYWRIGHT_CHANNEL = "chrome"`을 설정한 뒤 `npm test`를 실행합니다. 호스팅된 Supabase의 메일 수신과 PostgREST 설정은 연결 후 별도로 확인합니다.

2026-11-23 회사 PC에서 대체 포트로 Playwright 20건이 통과했습니다. Supabase 대시보드에서 4000번 콜백을 등록했고, Chrome에서 실제 매직 링크로 `/trips`에 진입한 뒤 로그아웃했습니다. 로그아웃 후 `/trips`에 다시 접속하면 `/login`으로 이동하는 것을 확인했습니다.

| 명령 | 용도 |
| --- | --- |
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 |
| `npm start` | 빌드 후 로컬 프로덕션 서버 |
| `npm run lint` / `npm run typecheck` | ESLint 및 TypeScript 검사 |
| `npm run test:unit` | 여행 양식 검증, 날짜와 일본 현지 상태 계산 |
| `npm run test:db` | 마이그레이션, 소유자 격리, 제약 조건과 중복 저장 방지 |
| `tests/sync-local-files.test.ps1` | 임시 체크아웃과 볼트로 설정 내보내기·복원, 미리보기, 충돌 및 백업 검사 |
| `npm test` | 브라우저에서 인증, 여행 생성·편집·삭제와 오류 복구 검증 |

## 기술 구성

Next.js 16.4.6 App Router, React 19.3.1, TypeScript 6.0.3, Tailwind CSS 4.3.5, shadcn/ui 방식의 로컬 Input, Supabase JS 2.119.2 / SSR 0.12.7, Playwright 1.65.1, PGlite 0.5.17. 버전은 `package.json`과 `package-lock.json`에 고정합니다.

`src/app`은 화면과 서버 액션, `src/components`는 공용 UI, `src/lib`는 인증과 설정을 관리합니다. `src/proxy.ts`에서 세션 쿠키를 갱신하며, 보호 페이지도 서버에서 사용자 신원을 확인합니다. 파일과 외부 요청 없이 기본 표지를 그리며, 한글은 시스템 글꼴을 사용합니다.

여행 쿼리는 현재 사용자의 소유권으로 범위를 제한하며 PostgreSQL RLS에서도 같은 경계를 적용합니다. 여행 기간은 일본 현지 날짜로 저장하고 두 날짜를 모두 비워 둘 수 있습니다. 같은 생성 폼의 재시도는 UUID로 중복 방지하고, 수정·삭제에는 현재 데이터 버전을 비교합니다.

## 개발 진행

- **M2 일정 관리** — 여행 수첩의 **일정 보기**에서 `/trips/[tripId]/itinerary?date=YYYY-MM-DD`를 엽니다. 정확한 시각, 오전·오후·저녁, 시간 미정 일정을 저장하고 날짜 이동, 후보 보관·복원, 같은 그룹 내 순서 변경을 할 수 있습니다. 날짜 없는 후보는 여행 기간 판단에서 제외합니다. 기간 밖 일정은 확인 후 저장하고 별도 영역에서 표시합니다. 여행 기간을 바꾸면 표시 구역이 달라지는 일정의 날짜·개수를 먼저 보여 줍니다.
- **M2 검증 기록** — 2026-11-23 회사 PC에서 린트·타입 검사·프로덕션 빌드, 단위 6건, PGlite DB 8건, Chrome E2E 23건 통과. Chrome은 `PLAYWRIGHT_BASE_PORT=4100`과 `PLAYWRIGHT_CHANNEL=chrome`을 사용했습니다. M2의 호스팅 Supabase 적용 및 테스트 계정 검증은 승인 후 진행합니다.
- **M3 장소·지도** — 다음 단계는 `/trips/[tripId]/map`의 장소·지도 UX, Geoapify 검색과 수동 입력 폴백입니다. M2는 이미 등록된 같은 여행의 장소를 연결할 수 있습니다. 예약은 M4에서 추가합니다.
- **다른 PC에서 이어가기** — 공식 기준은 비공개 킥오프 ZIP의 `docs/01~05`입니다. 기간 밖 정책은 결정 로그 D-017을 참고하세요. `docs/`와 `reference/`는 각 PC에서 별도로 복구하고, Supabase 적용 전 [마이그레이션 이력과 권한 검사](supabase/README.md)를 확인합니다.

## 목적

개인과 소규모 그룹이 일본 여행을 준비할 때 쓰는 한국어 여행 수첩입니다.

## 범위 관리

- 화면 사진 API의 이용 조건과 요금·무료 한도는 실제 키 발급/배포 전에 최신 약관을 재검증한다.
- 운영비 0원 **목표**이지 무조건 무료 보장은 아니다. 사용량 상한·키 보호·폴백이 필수다.
- 실제 항공권/호텔 예약번호, 여행자 실명, 여권번호, 개인 이메일, 비밀 토큰은 데모·Git에 넣지 않는다.
- 현재 문서는 **제품/개발 명세**이지 기능 구현 사실 또는 외부 API 연결 완료를 뜻하지 않는다.
