# KIOKU 개발 이력

### 2026-11-26 KQ-18 예산·환율 선택 입력

- 예산 설정 없이 KRW/JPY 지출을 기록할 수 있습니다. 첫 지출 때 표시용 기본 인원 장부를 원자적으로 만들며, 기존 인원 ID·순서 보호를 유지합니다. 환율 없는 엔화는 원통화·환불액을 보존하고 원화 합계/송금 계산에서 제외합니다. 일부 환산·미정산 건수와 엔화를 표시하고 지출 편집에서 나중에 환율을 입력합니다. 기본 환율 변경은 기존 지출을 바꾸지 않습니다.
- 새 migration `20261126002814_optional_expense_exchange_rate.sql`: 환율 nullable, KRW의 10000 고정 검증 유지, 최초 장부 생성. 기존 migration과 기존 금액·환불·환율·분담 인덱스는 수정하지 않습니다. 홈·여행 기억·선택형 PDF 경비 요약에도 일부 환산 여부를 표시합니다.
- 검증: 계산·관련 DB 6건과 추가 v1.0 증분 보존 테스트 통과, 타입 검사·관련 ESLint·빌드 통과. 기존 경비 Chrome 2건 통과. 격리 Supabase PostgreSQL migration 적용 후 Chrome 390px에서 예산/환율 없는 500엔 등록, KRW 1,000원 추가, 500엔 정산 제외, 나중에 9원/엔 적용 후 5,500원 합계 및 송금 1,750원 갱신, 원래 결제액 보존을 확인했습니다. 전체 격리 사진/표지/경비/오프라인/PDF 시나리오도 통과했고 `test-results/kq18-pending-mobile.png`를 확인했습니다.
- 주의: 새 NULL 환율 지출을 만든 후 구버전 앱으로 단순 롤백하면 구버전 계산기가 NULL을 처리하지 못합니다. 원래 금액을 임의 환율로 보정하지 않습니다. 운영은 DB→신규 앱 순서로 승인 후 적용하고 장애 시 NULL 처리 가능한 앱으로 전진 복구합니다. NULL 데이터가 없는지 확인 없이 v1.0으로 되돌리지 않습니다.
- KQ-21의 대규모 E2E 분리는 이번 변경에서 보류합니다. 기존 fixture를 재사용하고 새 순차 큐/표지/미확정 경비의 단위·DB·브라우저 테스트만 추가했습니다.

### 2026-11-26 KQ-08/14 여행 표지

- 기존 이미지/CSS 일러스트로 지역 자동·초록 산·푸른 바다·노을·겨울 거리 테마를 제공합니다. 여행 편집에서 기존 앨범 사진과 기본 테마를 골라 미리 본 뒤 저장하고 기본 표지로 복원할 수 있습니다. 목록과 홈은 같은 테마 해석 함수를 사용합니다.
- 새 migration `20261126002216_trip_cover_themes.sql`: 기존 여행은 auto 유지. 표지 저장은 소유권·여행 버전·같은 여행의 ready 사진을 확인하고 대표 사진 변경과 테마 저장을 한 트랜잭션으로 처리합니다. 사진 접근 정책과 기존 데이터는 유지합니다.
- 검증: 테마 단위/PGlite 권한·버전·다른 여행 사진 거부 2건, 타입 검사, 관련 ESLint와 빌드 통과. 격리 Supabase에서 migration 적용 후 Chrome 390px로 테마 미리보기→저장→홈/목록 일치→앨범 사진 선택→기본 복원을 통과했습니다. `test-results/kq08-cover-editor.png` 확인. 서버 액션의 네이티브 제출 폴백에서 발생한 Origin null 500을 재현하고 기존 BudgetForm과 같은 명시적 submit 방식으로 해결했습니다.
- 운영 적용은 승인 전입니다. DB를 앱보다 먼저 적용하고, 앱 롤백 시 cover_theme 컬럼과 설정은 보존합니다. 필요 시 새 보정 migration으로 함수만 복구하며 기존 사진이나 테마를 삭제하지 않습니다.

### 2026-11-26 KQ-04 사진 일괄 업로드

- 여러 장 선택, 작은 사진별 미리보기, 사진별 제목/제거, 순차 축소·전송, 전체 진행률, 개별 오류·재시도를 추가했습니다. 성공 사진은 재전송하지 않으며 원본 File 참조를 해제합니다. 선택 중복은 파일명·크기·종류로 걸러 모바일 선택기의 수정 시각 변동에도 대응합니다.
- 서버는 사진별 고정 ID의 ready 상태를 재확인합니다. 저장 후 응답 유실 시 같은 ID 재시도는 성공으로 처리합니다. pending/deleting 행을 임의 덮어쓰지 않고 기존 정리 절차를 유지합니다. 기존 정제·EXIF 제거·권한·3.8MB 요청·저장 크기·여행 24장/계정 120장 제한을 재사용합니다.
- 검증: 큐/입력 단위 4건, 타입 검사와 관련 ESLint, 프로덕션 빌드 통과. 격리 Supabase+Chrome 390px 시나리오에서 대용량 축소, HEIC 안내, 비공개 사진 접근, 다중 선택·제거·중복 선택·응답 유실·개별 재시도·DB 2행만 저장, 기존 경비·오프라인·A4 PDF가 통과했습니다. `test-results/kq04-mobile.png`를 시각 확인했습니다.
- 실행: 격리 스택 status JSON을 `KIOKU_LOCAL_SUPABASE`로 전달하고 `PLAYWRIGHT_CHANNEL=chrome`, `KIOKU_MEMORY_TEST_PORT=5731`로 `node tests/isolated-memory.mjs`. 실제 키는 출력/커밋하지 않습니다. 실기기 카메라·iOS 메모리 동작은 별도 검증 항목입니다.

### 2026-11-26 v1.1 재개 · KQ-09

- 재개 기준은 PR #9 `532e3d3`. 회사 PC는 깨끗한 과거 브랜치였으며 fetch 후 지정 브랜치를 추적하도록 전환했습니다. Git/Orca 조회에서 KIOKU 추가 worktree나 동시 작업 세션이 없었습니다. 이전 하위 에이전트의 개별 기록은 이 PC에서 확인되지 않으며 Obsidian 최신 인계에는 추가 커밋 없음으로 기록돼 있습니다.
- 실행 순서: KQ-09 → KQ-04 → KQ-08/14 → KQ-18. 각 기능의 테스트·화면 검증 뒤 커밋합니다. KQ-21은 핵심 검증 후 선택적으로 진행합니다. 새 병렬 에이전트 없이 기존 작업을 이어갑니다.
- KQ-09: 같은 날의 선택 종료 시각, 자동 분 계산, 날짜 이동·복사·후보 보관/복원, JSON `endTime`, 공유 화이트리스트, 지도/홈/예약 연결, PDF와 오프라인 표시를 연결했습니다. 기존 JSON 중복 기준은 유지합니다. 기존 RPC에서 종료 필드 생략 시 유효한 값을 보존하고 명시적 null은 지웁니다.
- 검증: 단위 33건, PGlite 전체 21건 통과 후 v1.0 증분 보존 테스트를 추가해 관련 DB 3건 통과. 프로덕션 빌드 통과. Chrome 관련 4건 통과, 화면 보정 후 가져오기·복사·PDF·오프라인 시나리오 1건 재통과. 360px 캡처에서 시간 범위가 카드와 겹치던 문제를 수정하고 캡처를 재확인했습니다. 변경 파일 선별 ESLint 오류·경고 0건.
- 격리 Supabase: Docker Desktop을 시작하고 로컬 전용 `kioku-v11-20261126` 스택에 전체 마이그레이션을 적용했습니다. `tests/itinerary-end-local.sql`로 실제 PostgreSQL에서 종료 시각·레거시 RPC·후보 복원·공유 필드·anon 차단을 검증하고 가상 데이터를 롤백했습니다. 운영 DB·환경변수·Production은 변경하지 않았습니다.
- 다음 작업은 KQ-04 순차 업로드입니다. 실제 iPhone/Android 및 운영 반영은 아직 검증/승인 전입니다.

### 2026-11-23 집 PC 인계

- `feature/m5-trip-sharing`의 원격 최신 커밋 `3b3236f`에서 검증했습니다. 볼트와 기존 `.env.local`은 동일했습니다. 인증에 필요한 세 변수는 형식이 유효했고, `GEOAPIFY_API_KEY`와 `KIOKU_SHARE_ENCRYPTION_KEY`는 비어 있었습니다. 장소는 수동 등록을 사용할 수 있습니다. 기존 공유 링크를 재복사하려면 발급 때 사용한 암호화 키를 볼트로 복구합니다.
- `npm ci`, lint, typecheck, 단위 13건, PGlite DB 15건, PowerShell 복원 스크립트 테스트, 프로덕션 빌드가 통과했습니다. 개발 서버 `localhost:3000`에서 `/login`은 200, 비로그인 `/trips`는 `/login`으로 307을 반환했습니다. 설치된 Chrome과 루프백 기본 포트 3100~3102로 실행한 `npm test` 35건과 실제 OpenFreeMap 시나리오 1건이 통과했습니다.
- 모의 Google OAuth에서 기존 여행 접근, 토큰 갱신, Chrome 재시작 후 세션 유지와 로그아웃을 검증했습니다. 호스팅 공개 설정은 Google 비활성화, 이메일 활성화, 신규 가입 허용 상태였습니다. 이 설정을 사용하는 로컬 Chrome에서 Google 로그인 시작이 차단되고 이메일 대안이 안내되는 것을 확인했습니다. 실제 계정 연결 검증은 Google Provider, 가입 차단과 콜백 설정 확인 후 진행합니다.
- Vercel 공개 `/login`과 `/s`는 200, 비로그인 `/trips`는 `/login`으로 307을 반환했습니다. 응답에서 `no-store`와 `Referrer-Policy: no-referrer`를 확인했습니다. 공개 로그인에 Google 버튼은 표시되지 않았습니다. Vercel 프로젝트 조회 권한이 열리면 배포 커밋, GitHub·Production 브랜치, 환경변수 대상, 로그와 실제 사용량을 대조합니다.

### 2026-11-23 호스팅 인증 설정

- Supabase 대시보드에서 신규 가입을 차단하고 집 PC Google 콜백 `http://localhost:3000/auth/confirm?flow=google`을 추가했습니다. 저장 후 공개 Auth 설정에서 신규 가입 차단, 이메일 활성화, Google 비활성화를 확인했습니다.
- 현재 Supabase Site URL은 `https://kioku-xi.vercel.app`입니다. 운영 주소를 확정할 때 Vercel Production `APP_URL`과 Supabase Site URL·Redirect URLs를 함께 대조합니다.
- 전용 Google Cloud 프로젝트 `kioku-515612`의 OAuth 웹 클라이언트 `KIOKU Web`을 호스팅 Supabase Google Provider에 연결했습니다. Google 인증 플랫폼은 테스트 모드이며 소유자 계정 한 개를 등록했습니다. 집 PC 출처 `http://localhost:3000`과 호스팅 Supabase의 `/auth/v1/callback`을 사용합니다.
- 실제 Chrome에서 Google로 로그인해 같은 Supabase 사용자 ID에 Google 인증이 연결되고 기존 여행 목록이 열리는 것을 확인했습니다. 새로고침과 탭을 닫았다 다시 열 때 세션이 유지됐으며, 로그아웃 후 `/trips` 재접근은 `/login`으로 이동했습니다. 실제 Chrome 프로세스 재시작과 Vercel 공개 주소의 Google 로그인은 후속 검증 범위입니다.

### 2026-11-23 Production 점검 및 배포 준비

- Vercel Hobby의 `kioku` 프로젝트는 GitHub `gugonggu/KIOKU`와 연결되어 있습니다. 대표 도메인 `kioku-trip.vercel.app`의 현재 Production은 `main`의 `61b9dee`이며 상태는 Ready입니다. Preview `feature/m5-trip-sharing`의 `3b3236f`에서는 Google 버튼이 표시됩니다.
- Production `/login`은 200이지만 Google 버튼이 없고, 비로그인 `/trips`는 `kioku-xi.vercel.app/login`으로 이동합니다. 이전 도메인은 Vercel `DEPLOYMENT_NOT_FOUND`를 반환합니다. Vercel의 Production `APP_URL`과 Supabase Site URL을 현재 대표 도메인에 맞추는 작업이 필요합니다.
- Production에 기본 인증 변수와 공유 암호화 키가 등록되어 있습니다. `GEOAPIFY_API_KEY`는 등록 목록에 없으므로 실검색은 키 준비 후 검증합니다. 기존 공유 키는 배포에 그대로 사용합니다.
- Supabase는 Google·이메일 로그인 활성화와 신규 가입 차단을 확인했습니다. 운영 도메인의 이메일·Google 콜백을 Supabase에 추가하고 Google 웹 클라이언트의 승인된 출처를 맞춥니다. 기존 로컬 콜백과 Google에서 Supabase로 돌아오는 콜백은 유지합니다.
- Production 빌드는 18초에 완료됐습니다. Vercel 로그에서 `engines.node` 범위로 인해 프로젝트의 Node 24 설정이 Node 26으로 바뀐 것을 확인해 `package.json`과 잠금 파일의 루트 엔진을 `24.x`로 맞췄습니다.
- 엔진 설정 변경 후 Node `24.11.1`에서 `npm ci`, lint, typecheck, 단위 13건, PGlite DB 15건, 프로덕션 빌드, 모의 Auth·데이터 API를 사용하는 Chrome E2E 35건이 통과했습니다. 운영 Google 로그인과 운영 DB를 사용하는 가상 여행 E2E는 아직 실행하지 않았습니다.
- 설정 변경과 `main` 릴리스는 승인 후 진행합니다. Vercel 환경변수 변경은 새 배포부터 적용됩니다. 먼저 올바른 도메인 설정으로 `main`의 기존 코드를 다시 빌드해 이메일 로그인과 보호 경로를 확인합니다. 이후 Google 로그인 커밋과 Node 설정을 릴리스합니다. 장애가 생기면 도메인을 교정한 직전 빌드를 롤백 대상으로 사용합니다. 가상 여행의 운영 E2E는 별도 승인 후 진행합니다.

### 2026-11-23 Production 1차 복구 완료

- Vercel `APP_URL`을 Production 전용으로 분리해 대표 도메인 `https://kioku-trip.vercel.app`과 일치시켰습니다. 기본 Preview와 `feature/m5-trip-sharing` 전용 Preview 설정을 보존했습니다.
- Supabase Site URL을 대표 도메인과 맞추고 운영 이메일·Google 콜백을 추가했습니다. Google `KIOKU Web`에 대표 도메인의 JavaScript Origin을 추가했습니다. 기존 로컬 콜백, Google의 Supabase 리디렉션 URI와 공유 암호화 키는 유지했습니다.
- 1차 복구 배포는 `main@61b9dee23efc67a793ffa11b20d1a45ae316c98b` 재배포이며 상태는 Ready입니다. Deployment ID는 `dpl_HByoDnz8QMfCBUx1mKebkH2U5eMN`, 고유 URL은 `https://kioku-2ax5u4vhx-gugonggus-projects.vercel.app`입니다. 2차 Google 로그인 배포의 롤백 지점으로 사용합니다. [Vercel 배포 상세](https://vercel.com/gugonggus-projects/kioku/HByoDnz8QMfCBUx1mKebkH2U5eMN)
- 공개 `/login`은 HTTP 200이었고, 비로그인 `/trips`는 대표 도메인의 `/login`으로 HTTP 307을 반환했습니다. 실제 이메일 매직 링크 요청·수신, 인증 콜백 303, 보호 페이지 접근, 로그아웃과 재접근 차단을 확인했습니다. 확인한 최근 30분 로그에서 런타임 오류와 HTTP 5xx는 0건이었습니다. 여행·예약 데이터에는 쓰기 작업을 실행하지 않았습니다.
- Google 버튼을 포함하는 코드와 로컬 Node 24.x 엔진 변경은 2차 배포 범위입니다. GitHub 반영·병합·배포와 운영 가상 여행 E2E는 별도 승인 후 진행합니다.

### 2026-11-24 운영 재점검 및 여행 준비

- `origin/main`과 Production 대표 도메인은 PR #1 병합 커밋 `2a85bf1`로 일치합니다. Vercel 배포는 Ready입니다. 변경 작업은 해당 커밋에서 분기한 `fix/travel-readiness`에서 진행했습니다. [GitHub PR #1](https://github.com/gugonggu/KIOKU/pull/1) · [Vercel 배포 상세](https://vercel.com/gugonggus-projects/kioku/Jw3FishZyL3BH9vjQLheAPUPNzyd)
- 운영 `/login`은 200, 비로그인 `/trips`와 `/trips/new`는 `/login`으로 307, 미인증 장소 검색은 401을 반환했습니다. `/s`는 200과 `no-store`·`no-referrer`·`noindex` 헤더를 반환했습니다. Chrome 320·390·1440px에서 로그인 버튼과 가로 너비를 확인했습니다. Supabase Auth 공개 설정은 Google·이메일 활성화와 신규 가입 차단을 표시합니다. 운영 계정 로그인과 여행 데이터 변경은 별도 검증 항목입니다. [Supabase 검증 기록](supabase/README.md)
- Vercel 방식으로 받은 공유 주소에서 같은 탭의 링크를 바꾸면 이전 여행 화면이 남는 문제를 수정했습니다. 링크를 바꾸거나 뒤로 가면 대상 링크를 다시 확인합니다. 일정·장소·예약 바로가기는 링크 주소를 유지하며 해당 섹션 제목으로 키보드 초점을 이동합니다.
- 4박 5일 격리 픽스처로 여행 날짜 탐색, 일정의 시각과 순서 조정, 지도 장소 연결, 예약 연결 및 공유 흐름을 점검했습니다. 320px 동행자 화면은 날짜 터치 조작, 시간 미정 일정, 빈 날짜를 확인했습니다. 실제 일정 입력 전에는 운영에서 기존 여행과 겹치는지 확인하고 확인된 장소·예약 정보만 입력합니다. Geoapify 실검색과 iPhone·Android 실기기 확인은 별도로 진행합니다.
- Node.js `24.11.1`에서 `npm run lint`, `npm run typecheck`, `npm run build`, 단위 13건, PGlite DB 15건, PowerShell 설정 복원 테스트, Chrome E2E 35건을 통과했습니다. `PLAYWRIGHT_BASE_PORT=4300`과 `PLAYWRIGHT_CHANNEL=chrome`으로 E2E를 실행했습니다. 별도 실제 OpenFreeMap 테스트 1건도 통과했습니다.

### 2026-11-24 여행 중 모바일 사용성

- 동행자 링크 전환 수정은 `fix/travel-readiness`의 `b312670`으로 PR #2를 열었습니다. 로컬 빌드와 Chrome 인증·소유자 격리·공유 회귀 7건을 다시 실행했습니다. [GitHub PR #2](https://github.com/gugonggu/KIOKU/pull/2)
- `feature/trip-day-usability`는 PR #2 커밋에서 분기했습니다. 여행 기간 중 홈에서 일본 현지 오늘 일정과 다음 정시 일정으로 바로 이동하고, 연결 장소가 있으면 해당 날짜 지도의 장소 상세를 엽니다. 시간대·시간 미정 항목은 기존 날짜별 일정에 표시합니다. 일정 하단의 장소 탭은 내용에 따라 해당 날짜 또는 후보 장소를 엽니다. 일정에 연결된 예약은 일정 시각과 별도로 기존 예약 상태를 표시합니다.
- 4박 5일, 3인 가상 여행에서 320px·1440px의 홈과 날짜별 지도 이동을 확인했습니다. 린트, 타입 검사, 프로덕션 빌드, 단위 14건, PGlite DB 15건, Chrome E2E 36건과 실제 OpenFreeMap 1건을 통과했습니다. Chrome은 `PLAYWRIGHT_BASE_PORT=4600`, `PLAYWRIGHT_CHANNEL=chrome`으로 실행했습니다.
- 다음 검증은 iPhone과 Android의 홈 → 일정 → 장소 상세 및 실제 계정의 공유 흐름입니다. 운영 가상 여행 쓰기는 별도 승인 뒤 실행합니다.

### 2026-11-24 실사용 릴리스 후보

| 흐름 | 이어서 완성한 내용 | 검증 범위 |
| --- | --- | --- |
| 여행 전·중·후 홈 | 일본 현지 D-Day, Day 번호, 여행 종료 상태와 오늘 확인할 예약을 표시합니다. 다음 일정은 시각이 지정된 오늘 일정 중 현재 시각 이후 항목입니다. 빈 날과 시간이 지난 날을 구별하고, 다음 일정 시각이 지나거나 일본 자정을 넘으면 보이는 홈을 다시 조회합니다. | 고정 시각 단위 테스트로 일본 자정 전후와 일정 시각 경계를 확인합니다. 가상 여행 홈으로 날짜별 상태를 확인합니다. |
| 일정·장소·예약 | 기존 추가·이동·순서·삭제 흐름을 사용합니다. 장소 및 예약 상세에는 연결 일정의 날짜·시각과 원래 일정으로 돌아가는 링크가 있습니다. 숙소의 체크인부터 체크아웃까지 오늘 예약에 표시하며 취소된 예약은 예약 기록에서 확인합니다. | 가상 3인 5일 여행에서 Day 4 후보 장소를 재사용하고 날짜별 지도와 연결 일정을 왕복합니다. 기존 DB 테스트로 연결 해제·다른 여행 참조 제한을 확인합니다. |
| 동행자 | 기존 공유 데이터로 오늘 날짜와 선택 날짜의 방문 장소를 표시합니다. 전체 지도, 길찾기 및 공유 범위 내 예약도 열 수 있습니다. 연결 장애에는 재시도 버튼을 표시합니다. | 지연된 이전 응답, 철회 후 뒤로 가기, 날짜 변경과 `pageshow.persisted` 재검증 핸들러를 확인합니다. 실제 모바일 브라우저의 BFCache 사용 여부는 실기기 검증 항목입니다. |

- 스키마·마이그레이션·RLS·공유 DTO 변경은 없습니다. 장소 상세는 소유자 권한으로 기존 일정의 식별자·제목·날짜·시각을 추가 조회합니다. 기존 MapLibre, OpenFreeMap, 무료 Geoapify 구성과 외부 지도 링크를 사용합니다. 개발 Geoapify 키가 없어 실검색은 미실행이며 검색 응답·실패 폴백은 격리 환경에서 검증합니다.
- 린트·타입 검사·프로덕션 빌드, 단위 16건, PGlite 15건, 전체 Chrome 39건, Windows WebKit 선별 7건, 실제 OpenFreeMap 1건을 통과했습니다. 가상 여행 홈은 320·360·375·390·430·768·1440px에서 가로 넘침을 검사했습니다. WebKit에서 본문 이동 링크가 기본 Tab 탐색에 포함되도록 탭 순서를 명시했습니다.
- 로컬 확인은 `npm ci`, `npm run build` 후 `npm test`를 사용합니다. Chrome은 `PLAYWRIGHT_CHANNEL=chrome`, WebKit은 `npx playwright install webkit` 후 `PLAYWRIGHT_BROWSER=webkit`을 지정합니다. `KIOKU_UI_SCREENSHOTS=test-results/kioku-rc`로 가상 화면을 저장합니다. Git 연동 Preview는 Vercel 인증이 필요하며 데이터 변경 테스트는 로컬 격리 DB에서 실행합니다. [후속 PR #3](https://github.com/gugonggu/KIOKU/pull/3)
- 실기기 확인 순서는 iPhone Safari와 Android Chrome에서 로그인 → 홈 → 오늘 일정 → 장소 상세 → 외부 지도 → 예약·공유입니다. 키보드를 연 상태에서 편집·저장, 하단 탭과 안전 영역, 지도 제스처, 느린 네트워크와 뒤로 가기를 확인합니다.
- 승인 후 PR #2를 먼저 병합하고, PR #3의 기준을 `main`으로 바꾼 뒤 변경 범위와 CI를 다시 확인합니다. `main`은 Vercel Production 추적 브랜치입니다. 장애 시 배포 직전의 Ready 배포로 Vercel에서 롤백하고, 원인 수정과 Git 되돌리기는 별도 PR로 검토합니다. [Vercel Git 연동](https://vercel.com/docs/git#production-branch)

### 2026-11-24 M6 독립 검수

- **본문 건너뛰기.** 격리 Chrome에서 `/s`의 건너뛰기 링크가 URL 프래그먼트를 바꾸는 문제를 재현했습니다. 프래그먼트 공유 화면에서는 버튼이 `main-content`로 초점과 스크롤만 옮깁니다. 일반 화면은 기존 링크 동작을 사용합니다. PR #2가 해시 변경을 재검증하기 때문에 단독 운영 반영 전에 이 수정 커밋을 PR #2에 넣었고, PR #3은 그 커밋을 조상으로 포함합니다.
- **공유 조회 장애.** 로컬 앱이 격리 Supabase RPC의 오류를 `404`로 처리하는 문제를 재현했습니다. JSON API 두 경로에서 정상 조회는 `200`, 무효·철회 링크는 공통 `404`, RPC·연결 장애는 상세 정보 없는 `503`을 응답합니다. 프래그먼트와 경로 기반 화면 모두 장애에서 재시도할 수 있습니다. 이 변경은 PR #3에 있습니다. RLS·공유 DTO·DB 스키마와 마이그레이션은 기존과 동일합니다.
- **브라우저 이력.** 기존 `ShareRefresh`의 합성 `pageshow.persisted` 테스트와 철회 후 실제 브라우저 뒤로·앞으로 이동을 검증합니다. BFCache 비활성화 실행 옵션을 뺀 로컬 Chrome에서도 새 탐색이 관찰되었습니다. 실제 BFCache 복원과 복원 직후 프레임에 대한 검증은 남아 있습니다.
- **최종 로컬 검증.** 린트·타입 검사·빌드, 단위 16건, PGlite DB 15건, 전체 Chrome 43건, Windows WebKit 선별 10건, 실제 OpenFreeMap 1건을 통과했습니다. `PLAYWRIGHT_BROWSER=webkit`에서 `review skip link`, `review shared server`를 포함해 실행했습니다. 건너뛰기 테스트는 브라우저의 POST 요청과 서버의 공유 RPC 호출이 둘 다 늘지 않는지 확인합니다.

#### 실기기 점검

| 흐름 | iPhone Safari와 Android Chrome에서 확인할 항목 |
| --- | --- |
| 인증과 홈 | Google 로그인, 여행 홈, 날짜별 이동, 오늘 일정, 다음 일정에서 장소 상세 열기 |
| 지도 | 확대·이동 제스처, 외부 지도 앱 열기 |
| 편집 | 일정 입력 중 키보드, 하단 Safe Area, 모달과 편집 화면의 저장·닫기 |
| 동행자 | 비로그인 링크 열기, 날짜 변경, 키보드 본문 이동, 뒤로·앞으로 이동 |
| 장애 | 느린 네트워크, 공유 링크 오류와 재시도, 철회된 링크의 이전 화면 잔존 여부 |

PC에서는 `npm run build` 후 `npm test -- --grep 'review skip link|review shared server|companion history' --headed`로 가상 5일 여행과 격리 DB를 확인합니다. 실기기의 로그인·수정·철회는 별도로 승인된 테스트 전용 Auth·DB와 HTTPS 주소에서 진행합니다. Git 연동 Preview는 Vercel 인증이 필요하고, DB 분리가 확인되기 전에는 데이터 변경 테스트를 보류합니다.

#### 장소 검색과 릴리스

- Geoapify 실검색은 개발 키가 없어 미실행입니다. 승인된 개발 환경의 서버 전용 `GEOAPIFY_API_KEY`가 준비되면 격리 여행에서 한국어·일본어 검색어를 한 번씩 붙여넣고 각 결과의 이름·주소·좌표를 확인합니다. `429`이면 중단합니다. 키 누락·빈 결과·오류 시 수동 등록과 기존 지도·길찾기를 사용할 수 있어 실검색만을 병합 차단 조건으로 두지 않습니다. 무료 인프라 정책은 유지합니다.
- 승인 후 PR #2를 일반 Merge Commit으로 `main`에 병합하고 Production `Ready`를 확인합니다. PR #3의 기준을 `main`으로 바꾸고 `git merge-base --is-ancestor <PR2 HEAD> origin/main`과 `git diff origin/main...HEAD`로 조상 관계와 리뷰 범위를 확인합니다. 최신 `main`으로 CI와 통합 검증을 실행한 뒤 Draft를 해제하고 검수합니다. PR #3 병합 뒤 Production 자동 배포와 읽기 전용 스모크를 확인합니다. Squash 또는 Rebase가 필요한 경우 병합 전 `git log --reverse --no-merges <PR2 HEAD>..origin/feature/trip-day-usability`로 PR #3 전용 커밋을 기록합니다. 최신 `main`의 별도 브랜치에 이 커밋만 순서대로 적용해 diff·CI를 검증하고 대체 PR을 승인받습니다.
- 첫 운영 변경 전 롤백 지점은 `2a85bf1`의 Ready 배포입니다. PR #2 배포 후에는 PR #3 직전 Ready 운영 배포도 기록합니다. 장애 시 승인 후 Vercel에서 직전 배포로 롤백하고 읽기 전용 스모크를 다시 실행합니다. [Vercel Git 연동](https://vercel.com/docs/git#production-branch) · [Instant Rollback](https://vercel.com/docs/instant-rollback)
- 실사용 안정화 후 후보는 여행 준비 체크리스트, PWA·오프라인 열람, 여행 예산·경비, PDF 여행 가이드, 여행 사진·추억 기록입니다.

### 2026-11-24 M6 운영 릴리스 이력

PR #2의 병합 커밋 `fc9abe7`과 PR #3의 병합 커밋 `34e65b4`가 차례로 운영에 반영됐습니다. PR #3의 정상 배포 `dpl_3awQZHbi1SZjS4gbEzjuRcrVhta4`는 다음 릴리스의 복구 지점으로 사용됐습니다. 당시 공개 스모크에서 로그인과 공유 화면, 보호 경로, 잘못된 공유 링크의 응답을 확인했습니다. [PR #2](https://github.com/gugonggu/KIOKU/pull/2) · [PR #3](https://github.com/gugonggu/KIOKU/pull/3) · [당시 main CI](https://github.com/gugonggu/KIOKU/actions/runs/45304837757)
