# M1·M2 여행 데이터베이스

[`20261122073111_create_trips.sql`](migrations/20261122073111_create_trips.sql)은 `public.trips`, 소유자별 RLS, 필드별 쓰기 권한, 수정 버전 트리거를 한 트랜잭션으로 추가합니다. 기존 Supabase Auth의 `auth.users`, `auth.uid()`, `auth.jwt()`를 사용합니다. 파일 버전은 KIOKU 테스트 DB의 적용 이력과 일치합니다.

[`20261123014445_create_trip_plan.sql`](migrations/20261123014445_create_trip_plan.sql)은 M2 `itinerary_items`, 같은 여행의 장소 참조용 `trip_places`, RLS와 일정 저장·배치·순서·기간 변경 함수를 추가합니다. 기존 여행 행이나 인증 설정은 변경하지 않습니다. `booking_id`는 M4에서 같은 여행의 예약 FK와 쓰기 권한을 도입하기 전까지 NULL만 허용합니다.

## 적용

1. 로컬 Supabase CLI를 사용한다면 작업 폴더에서 최초 한 번 `supabase init`을 실행한 뒤 `supabase start`로 로컬 스택을 준비합니다. 실행 중인 로컬 스택에 적용하려면 `supabase migration up --local`을 사용합니다.
2. 승인된 호스팅 프로젝트에 반영하기 전 M1 적용 여부, M2 버전 미적용 여부, `trip_places`·`itinerary_items`·이전 `trip_schedule` 초안과의 충돌, 기존 데이터 백업을 확인합니다. 이전 초안이나 실제 일정 데이터가 존재하면 적용을 중단하고 별도의 데이터 보존 마이그레이션을 설계합니다. `public`이 Data API에 노출되는지와 테이블·함수의 명시적 권한을 확인한 뒤 순서대로 적용하고, M2 앱은 그 다음에 반영합니다.
3. 서로 다른 두 계정으로 각각 여행을 만든 뒤 자기 목록과 상세·편집·삭제 화면만 열리는지 확인합니다. 로그아웃 후에는 로그인 화면으로 이동합니다.

## 검증과 복구

- `npm run test:db`가 매번 빈 로컬 PostgreSQL 엔진에 이 마이그레이션을 적용하고 소유자·비소유자·익명 역할을 검증합니다.
- 호스팅 적용 후 테스트 계정 두 개로 일정 생성·후보 복원·여행 기간 변경을 확인합니다. 익명 조회·함수 호출과 다른 여행의 일정·장소 참조가 거부되는지 확인합니다. PGlite와 브라우저 테스트용 API는 실제 호스팅 PostgREST 검증을 대체하지 않습니다.
- SQL 적용 중 오류가 나면 트랜잭션 전체가 롤백됩니다. 적용된 환경의 이력은 유지하고, 잘못된 정책이나 제약은 후속 마이그레이션으로 수정합니다.
- 여행이 저장된 이후에 마이그레이션 전 상태로 돌아가야 한다면 우선 데이터와 스키마를 백업하고 복구를 확인합니다. 여행 테이블을 제거하면 저장된 여행이 함께 사라지므로 별도 승인과 백업 확인 후에만 수행합니다.
- M1의 `cover_photo_id`는 빈 값만 허용합니다. 표지 사진 도입 단계에서 같은 여행의 사진을 가리키는 외래 키를 추가하면서 이 제약을 교체합니다.

[Supabase CLI의 로컬 개발](https://supabase.com/docs/guides/local-development) · [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
