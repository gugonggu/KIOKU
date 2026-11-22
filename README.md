# KIOKU — Japan Travel Planner

한국어 사용자를 위한 일본 여행 수첩입니다. M1에서는 이메일로 로그인한 뒤 내 여행을 만들고, 여행 수첩을 열고, 기본 정보를 편집하거나 여행을 삭제할 수 있습니다.

## 로컬 실행

Node.js 24와 npm이 필요합니다.

```powershell
npm ci
npm run dev
```

브라우저에서 [localhost:3000](http://localhost:3000)을 엽니다. Supabase 설정을 생략하면 로그인 화면에서 설정 안내를 볼 수 있습니다. 비로그인 사용자가 `/trips` 또는 `/trips/new`를 열면 `/login`으로 이동합니다.

여행 저장을 사용하려면 아래 인증 설정과 [M1 마이그레이션](supabase/README.md)을 같은 Supabase 인스턴스에 적용합니다.

## Supabase 이메일 로그인 설정

1. `Copy-Item .env.example .env.local`로 로컬 설정 파일을 만들고 아래 값을 입력합니다.

   | 변수 | 값 |
   | --- | --- |
   | `APP_URL` | 브라우저에서 앱을 여는 주소의 오리진. 로컬 예시 `http://localhost:3000` |
   | `SUPABASE_URL` | Supabase 프로젝트 URL |
   | `SUPABASE_PUBLISHABLE_KEY` | 프로젝트의 Publishable 키(`sb_publishable_…`) |

2. Supabase **Authentication → URL Configuration**에서 Site URL을 `APP_URL`과 맞추고 Redirect URLs에 `http://localhost:3000/auth/confirm`을 추가합니다. 브라우저 주소가 다르면 `APP_URL`과 허용 목록에도 같은 오리진을 사용합니다.
3. **Authentication → Email Templates → Magic Link**에서 링크를 아래 토큰 해시 템플릿으로 설정합니다.

   ```html
   <a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=email">KIOKU 로그인</a>
   ```

4. **Authentication → Users**에서 본인 테스트 계정을 사전에 등록하고 Email 제공자 및 SMTP 발신 설정을 확인합니다. 링크 요청에서 자동 가입을 끕니다.
5. 개발 서버를 재시작한 뒤 이메일을 제출합니다. 받은 링크를 열면 서버에서 검증하고 `/trips`로 이동합니다. 여행 메뉴에서 로그아웃한 뒤 `/trips` 재접근이 차단되는지 확인합니다.

`.env.local`에 서비스 역할 키를 넣을 필요가 없습니다. 앱은 서버에서 Supabase 토큰을 검증하고, HTTPS에서 Secure 속성을 적용한 HttpOnly 쿠키를 사용합니다. 배포 환경에서 인증 확인 경로의 쿼리 문자열과 쿠키가 프록시 또는 접근 로그에 수집되지 않도록 설정합니다. Supabase 기본 메일의 수신자 및 발신 한도와 SMTP 링크 추적 설정은 실제 프로젝트에서 확인합니다.

[Supabase SSR 설정](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&queryGroups=framework) · [매직 링크와 이메일 템플릿](https://supabase.com/docs/guides/auth/auth-email-passwordless) · [SMTP 설정](https://supabase.com/docs/guides/auth/auth-smtp)

## 검사 및 테스트

```powershell
npm run lint
npm run typecheck
npm run test:unit
npm run test:db
npm run build
npx playwright install chromium
npm test
```

Playwright는 위 빌드를 사용하여 루프백 포트 3100~3102에서 앱과 테스트용 인증·데이터 API를 실행합니다. 테스트용 API는 실제 마이그레이션을 적용한 인메모리 PostgreSQL(PGlite)을 사용합니다. 설치된 Chrome을 사용하려면 PowerShell에서 `$env:PLAYWRIGHT_CHANNEL = "chrome"`을 설정한 뒤 `npm test`를 실행합니다. 호스팅된 Supabase의 메일 수신과 PostgREST 설정은 연결 후 별도로 확인합니다.

| 명령 | 용도 |
| --- | --- |
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 |
| `npm start` | 빌드 후 로컬 프로덕션 서버 |
| `npm run lint` / `npm run typecheck` | ESLint 및 TypeScript 검사 |
| `npm run test:unit` | 여행 양식 검증, 날짜와 일본 현지 상태 계산 |
| `npm run test:db` | 마이그레이션, 소유자 격리, 제약 조건과 중복 저장 방지 |
| `npm test` | 브라우저에서 인증, 여행 생성·편집·삭제와 오류 복구 검증 |

## 기술 구성

Next.js 16.4.6 App Router, React 19.3.1, TypeScript 6.0.3, Tailwind CSS 4.3.5, shadcn/ui 방식의 로컬 Input, Supabase JS 2.119.2 / SSR 0.12.7, Playwright 1.65.1, PGlite 0.5.17. 버전은 `package.json`과 `package-lock.json`에 고정합니다.

`src/app`은 화면과 서버 액션, `src/components`는 공용 UI, `src/lib`는 인증과 설정을 관리합니다. `src/proxy.ts`에서 세션 쿠키를 갱신하며, 보호 페이지도 서버에서 사용자 신원을 확인합니다. 파일과 외부 요청 없이 기본 표지를 그리며, 한글은 시스템 글꼴을 사용합니다.

여행 쿼리는 현재 사용자의 소유권으로 범위를 제한하며 PostgreSQL RLS에서도 같은 경계를 적용합니다. 여행 기간은 일본 현지 날짜로 저장하고 두 날짜를 모두 비워 둘 수 있습니다. 같은 생성 폼의 재시도는 UUID로 중복 방지하고, 수정·삭제에는 현재 데이터 버전을 비교합니다.

## 목적

개인과 소규모 그룹이 일본 여행을 준비할 때 쓰는 한국어 여행 수첩입니다.

## 범위 관리

- 화면 사진 API의 이용 조건과 요금·무료 한도는 실제 키 발급/배포 전에 최신 약관을 재검증한다.
- 운영비 0원 **목표**이지 무조건 무료 보장은 아니다. 사용량 상한·키 보호·폴백이 필수다.
- 실제 항공권/호텔 예약번호, 여행자 실명, 여권번호, 개인 이메일, 비밀 토큰은 데모·Git에 넣지 않는다.
- 현재 문서는 **제품/개발 명세**이지 기능 구현 사실 또는 외부 API 연결 완료를 뜻하지 않는다.
