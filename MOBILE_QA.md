# KIOKU 모바일 릴리스 검증

M13의 360·390·430·768·1440px 브라우저 비교와 재실행 방법은 [UI/UX 개선 기록](UX_IMPROVEMENTS.md)에 있습니다. 아래 실기기 체크리스트는 M13에서도 적용됩니다.

모든 쓰기 검증은 가상 여행, 생성한 테스트 계정과 격리 Supabase를 이용합니다. Android 자동화는 선택 실행이며 일반 GitHub Actions에는 포함하지 않습니다.

## Windows에서 재실행

1. Node.js 24로 `npm ci`, `npm run build`를 실행합니다. 임시 로컬 Supabase 프로젝트에 [마이그레이션 9건](supabase/README.md)을 적용합니다. 상태 JSON은 값을 출력하지 않고 `KIOKU_LOCAL_SUPABASE`에 전달합니다. `KIOKU_RELEASE_MOBILE=1`을 설정하고 `node tests/isolated-memory.mjs`를 실행하면 360·390·430·768·1440px에서 11개 보호 경로를 검사합니다. Windows에 설치된 Chrome을 쓰려면 `PLAYWRIGHT_CHANNEL=chrome`을 지정합니다.
2. Android는 SDK Emulator의 `Pixel_10_Pro` AVD를 시작하고 `adb devices -l`, `adb shell getprop sys.boot_completed`로 연결과 부팅을 확인합니다. 앱 테스트 포트 기본값은 `5331`입니다. `adb reverse tcp:5331 tcp:5331`을 실행한 뒤 AVD Chrome에서 `http://127.0.0.1:5331`을 엽니다. 루프백을 보안 컨텍스트로 사용합니다.
3. Chrome의 첫 실행 설정을 마친 후 `adb forward tcp:9225 localabstract:chrome_devtools_remote`를 실행합니다. `http://127.0.0.1:9225/json/version`에 Chrome이 응답하면 `KIOKU_ANDROID_CDP=http://127.0.0.1:9225`를 추가합니다. `KIOKU_RELEASE_MOBILE=android`로 실행하면 데스크톱 검사를 생략합니다. Android OS 회전과 비행기 모드 확인은 전용 AVD의 일련번호를 `KIOKU_ANDROID_EMULATOR`에 지정합니다. 홈 화면 설치, 카메라 및 인쇄 저장은 기기 UI에서 따로 확인합니다.
4. 종료할 때 이 테스트에서 만든 `adb reverse --remove tcp:5331`과 `adb forward --remove tcp:9225` 연결을 해제하고 임시 Supabase와 AVD를 중지합니다. 테스트 계정과 여행은 임시 DB에만 생성됩니다.

Android SDK Emulator와 ADB를 재사용합니다. Playwright `1.65.1`에 실험적 `_android` API가 있으며, 브라우저 연결은 Chromium CDP와 ADB로 검사합니다. 기기 UI 조작이 필요한 경우 ADB 또는 호환되는 Appium·UiAutomator2를 선택할 수 있습니다. [Playwright Android](https://playwright.dev/docs/api/class-android)

## iPhone 원격 검증

`codex mcp add browserstack --url https://mcp.browserstack.com/mcp`, `codex mcp login browserstack`, `codex mcp list`로 BrowserStack 계정에 연결합니다. BrowserStack MCP는 계정·기기와 원격 세션을 관리하며 Appium MCP는 활성 세션의 브라우저나 접근 가능한 기기 UI를 조작합니다. Safari는 브라우저 세션을 선택합니다. 격리 앱은 BrowserStack Local 터널과 HTTPS 구성으로 연결합니다. 계정의 잔여량과 사용 가능한 iPhone을 먼저 조회하고 세션 종료까지 기록합니다. 공식 체험 안내는 Automate 60분, App Automate 100분이며 실제 잔여량은 계정별입니다. 홈 화면, 카메라, 네트워크 설정의 접근 가능 여부는 원격 세션에서 각각 확인합니다. [BrowserStack Remote MCP](https://www.browserstack.com/docs/browserstack-mcp-server/get-started/remote-mcp-server) · [App Automate 도구](https://www.browserstack.com/docs/browserstack-mcp-server/tools/app-automate) · [무료 체험](https://www.browserstack.com/support/faq/plans-pricing/plans/what-do-i-get-with-a-free-trial)

Windows의 대체 검증은 Playwright WebKit입니다. Xcode Simulator는 macOS가 필요합니다. AWS Device Farm은 계정과 체험 잔여량을 확인한 후 사용할 수 있으며, 무료량 이후 종량 과금이 가능한 구성은 이번 작업에서 제외합니다. [AWS Device Farm 요금](https://aws.amazon.com/device-farm/pricing/)

## 2026-11-25 실행 기록

애플리케이션 검증 기준은 `c58d2b1`이며 이후 변경은 릴리스 문서·예제·검증 코드입니다. Windows의 Android Studio와 기존 SDK, Emulator `36.6.11.0`, ADB `37.0.0`, Pixel 계열 `Pixel_10_Pro` AVD를 사용했습니다. OS는 Android `17`(API `37`), Chrome은 `149.0.7827.5`입니다. WHPX 가상화, Java `21.0.11`, Node.js `24.11.1`을 확인했으며 Appium·UiAutomator2는 설치하지 않았습니다. Android UI 확인에는 SDK 내장 `adb shell uiautomator`를 사용했습니다.

| 환경 | 결과와 범위 |
| --- | --- |
| Desktop Mobile Emulation | **PASS**. Chrome에서 보호 화면 11개를 360·390·430·768·1440px로 열고 가로 넘침을 확인했습니다. 이전 WebKit 자동화 6건은 Chromium과 별개로 통과했습니다. |
| Android OS Emulator | **PASS** A01·A02·A03·A06·A07·A08·A10·A11·A17. 실제 Chrome에서 보안 컨텍스트, Service Worker의 공개 셸 캐시, 설치 가능 조건과 설치 확인 창, 저장한 일정·장소, 시스템 회전을 확인했습니다. 비행기 모드에서 ADB reverse를 제거하고 Chrome의 기존 연결도 차단한 상태에서 저장본을 다시 불러온 뒤 네트워크를 복구했습니다. |
| Android OS Emulator | **PASS** A13의 가상 JPEG 파일 입력·업로드·삭제. **PASS** A16 중 터치 장소 선택, 길찾기 URL, 지도 캔버스 표시. 지도 드래그·핀치 및 시스템 파일 선택 창은 **NOT RUN**. PDF는 가이드 미리보기까지 확인했습니다. |
| Android OS Emulator | **PASS** 일반 Chrome 프로세스 종료 후 비행기 모드에서 오프라인 수첩을 다시 열어 저장 여행을 확인했습니다. A04·A05 및 A09·A18의 설치 PWA 흐름은 **BLOCKED**입니다. 설치 창에서 Install을 선택한 뒤 이번 AVD에서 홈 화면 아이콘이나 WebAPK 설치 완료를 확인하지 못했습니다. A14 시스템 인쇄 호출은 입력 시간 초과 후 AVD가 ADB에서 사라져 **BLOCKED**였습니다. A12 가상 카메라 촬영·첨부와 A15 저장 PDF 열기는 **NOT RUN**입니다. |
| iOS Simulator / Physical Android Device | **NOT RUN**. Windows에서는 Xcode Simulator를 사용하지 않았으며 물리 Android는 연결하지 않았습니다. |
| Physical iPhone Device | **BLOCKED**(I01~I14). BrowserStack OAuth와 MCP 연결, Automate Free 플랜, 실제 iPhone 15(iOS 17·26·27)·16(iOS 18)·17(iOS 26)의 Safari 목록을 확인했습니다. API는 동시 실행 수만 제공해 계정의 잔여 무료 분은 확인하지 못했습니다. 원격 세션 사용량은 이번 작업 기준 0분입니다. [Plan API](https://www.browserstack.com/docs/automate/api-reference/selenium/plan) |

Playwright Android 전용 실행과 초기 일반 CDP 연결은 시간 초과가 발생했습니다. `noDefaults` CDP 연결로 브라우저 검증을 실행했습니다. 사진 입력 재시험에서 수동 점검용 Next 서버가 같은 포트를 사용해 사진용 키 없는 인스턴스로 연결되는 것을 확인했습니다. 수동 서버를 종료했고 테스트 실행기도 포트가 이미 응답하면 중단합니다. 로컬 ADB 캡처 `test-results/mobile-release/android-offline.png`는 Chrome 주소와 시스템 UI를 보여 주지만 본문 영역의 시각 검수에는 사용할 수 없었습니다. 저장본 내용은 Android Chrome의 DOM 검증으로 확인했습니다.

## M11~M12 운영 전 사진 확인

고용량 JPEG와 HEIC 파일을 첨부하면 브라우저에서 제출을 막고 각각 축소와 JPEG 내보내기를 안내합니다. 카메라 앱 또는 사진 선택기가 변환해 전달한 JPEG는 정상 입력으로 처리합니다. 실제 iPhone Safari가 각 선택 경로에서 전달하는 형식과 카메라 직촬영은 실기기 확인 항목입니다. Windows WebKit 선별 실행의 확인된 범위는 6건입니다.

## 실기기 체크리스트

M15의 JSON 파일 입력 회귀는 가상 여행에서 Chrome과 Playwright WebKit의 390px 화면으로 통과했습니다. 파일 선택은 자동화 API를 사용했으며 Android·iOS 파일 앱은 아래 항목에서 확인합니다. 기존 Pixel AVD는 Android 17로 부팅됐지만 Chrome DevTools 연결이 되지 않아 설치·독립 실행·비행기 모드·카메라·PDF는 이번에 실행하지 않았습니다. BrowserStack은 무료 잔여량을 확인할 수 없어 원격 세션을 열지 않았습니다.

| 단계 | iPhone Safari | Android Chrome |
| --- | --- | --- |
| 설치 | 공유 메뉴에서 홈 화면 추가 | Chrome 메뉴에서 앱 설치 |
| 재실행 | 홈 화면 아이콘을 열고 앱을 종료한 뒤 비행기 모드에서 재실행 | 홈 화면 아이콘을 열고 앱을 종료한 뒤 비행기 모드에서 재실행 |
| 오프라인 | 저장해 둔 날짜별 일정과 장소 확인 | 저장해 둔 날짜별 일정과 장소 확인 |
| 사진 | 카메라 촬영과 사진 보관함에서 첨부 후 삭제 | 카메라 촬영과 파일 선택에서 첨부 후 삭제 |
| PDF | A4로 인쇄하고 PDF 저장 및 공유 | A4 PDF 다운로드와 다운로드 앱에서 열기 |
| JSON 파일 | 파일 앱에서 UTF-8 `.json` 파일을 골라 미리보기 확인 | 다운로드 앱에서 UTF-8 `.json` 파일을 골라 미리보기 확인 |
| 조작 | 회전, Safe Area, 키보드와 일정 편집 | 회전, 지도 터치·확대, 네트워크 복구 |
