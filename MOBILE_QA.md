# KIOKU 모바일 릴리스 검증

모든 쓰기 검증은 가상 여행, 생성한 테스트 계정과 격리 Supabase를 이용합니다. Android 자동화는 선택 실행이며 일반 GitHub Actions에는 포함하지 않습니다.

## Windows에서 재실행

1. Node.js 24로 `npm ci`, `npm run build`를 실행합니다. 임시 로컬 Supabase 프로젝트에 [마이그레이션 9건](supabase/README.md)을 적용합니다. 상태 JSON은 값을 출력하지 않고 `KIOKU_LOCAL_SUPABASE`에 전달합니다. `KIOKU_RELEASE_MOBILE=1`을 설정하고 `node tests/isolated-memory.mjs`를 실행하면 360·390·430·768·1440px에서 11개 보호 경로를 검사합니다. Windows에 설치된 Chrome을 쓰려면 `PLAYWRIGHT_CHANNEL=chrome`을 지정합니다.
2. Android는 SDK Emulator의 `Pixel_10_Pro` AVD를 시작하고 `adb devices -l`, `adb shell getprop sys.boot_completed`로 연결과 부팅을 확인합니다. 앱 테스트 포트 기본값은 `5331`입니다. `adb reverse tcp:5331 tcp:5331`을 실행한 뒤 AVD Chrome에서 `http://127.0.0.1:5331`을 엽니다. 루프백을 보안 컨텍스트로 사용합니다.
3. Chrome의 첫 실행 설정을 마친 후 `adb forward tcp:9225 localabstract:chrome_devtools_remote`를 실행합니다. `http://127.0.0.1:9225/json/version`에 Chrome이 응답하면 `KIOKU_ANDROID_CDP=http://127.0.0.1:9225`를 추가하고 같은 테스트를 실행합니다. CDP 차단은 브라우저 네트워크 회귀에 사용합니다. 홈 화면 설치, OS 네트워크 차단, 카메라 및 인쇄는 기기 UI에서 따로 확인합니다.
4. 종료할 때 이 테스트에서 만든 `adb reverse --remove tcp:5331`과 `adb forward --remove tcp:9225` 연결을 해제하고 임시 Supabase와 AVD를 중지합니다. 테스트 계정과 여행은 임시 DB에만 생성됩니다.

Android SDK Emulator와 ADB를 재사용합니다. Playwright `1.65.1`에 실험적 `_android` API가 있으며, 브라우저 연결은 Chromium CDP와 ADB로 검사합니다. 기기 UI 조작이 필요한 경우 ADB 또는 호환되는 Appium·UiAutomator2를 선택할 수 있습니다. [Playwright Android](https://playwright.dev/docs/api/class-android)

## iPhone 원격 검증

`codex mcp add browserstack --url https://mcp.browserstack.com/mcp`, `codex mcp login browserstack`, `codex mcp list`로 BrowserStack 계정에 연결합니다. BrowserStack MCP는 계정·기기와 원격 세션을 관리하며 Appium MCP는 활성 세션의 브라우저나 접근 가능한 기기 UI를 조작합니다. Safari는 브라우저 세션을 선택합니다. 격리 앱은 BrowserStack Local 터널과 HTTPS 구성으로 연결합니다. 계정의 잔여량과 사용 가능한 iPhone을 먼저 조회하고 세션 종료까지 기록합니다. 공식 체험 안내는 Automate 60분, App Automate 100분이며 실제 잔여량은 계정별입니다. 홈 화면, 카메라, 네트워크 설정의 접근 가능 여부는 원격 세션에서 각각 확인합니다. [BrowserStack Remote MCP](https://www.browserstack.com/docs/browserstack-mcp-server/get-started/remote-mcp-server) · [App Automate 도구](https://www.browserstack.com/docs/browserstack-mcp-server/tools/app-automate) · [무료 체험](https://www.browserstack.com/support/faq/plans-pricing/plans/what-do-i-get-with-a-free-trial)

Windows의 대체 검증은 Playwright WebKit입니다. Xcode Simulator는 macOS가 필요합니다. AWS Device Farm은 계정과 체험 잔여량을 확인한 후 사용할 수 있으며, 무료량 이후 종량 과금이 가능한 구성은 이번 작업에서 제외합니다. [AWS Device Farm 요금](https://aws.amazon.com/device-farm/pricing/)

## 실기기 체크리스트

| 단계 | iPhone Safari | Android Chrome |
| --- | --- | --- |
| 설치 | 공유 메뉴에서 홈 화면 추가 | Chrome 메뉴에서 앱 설치 |
| 재실행 | 홈 화면 아이콘을 열고 앱을 종료한 뒤 비행기 모드에서 재실행 | 홈 화면 아이콘을 열고 앱을 종료한 뒤 비행기 모드에서 재실행 |
| 오프라인 | 저장해 둔 날짜별 일정과 장소 확인 | 저장해 둔 날짜별 일정과 장소 확인 |
| 사진 | 카메라 촬영과 사진 보관함에서 첨부 후 삭제 | 카메라 촬영과 파일 선택에서 첨부 후 삭제 |
| PDF | A4로 인쇄하고 PDF 저장 및 공유 | A4 PDF 다운로드와 다운로드 앱에서 열기 |
| 조작 | 회전, Safe Area, 키보드와 일정 편집 | 회전, 지도 터치·확대, 네트워크 복구 |
