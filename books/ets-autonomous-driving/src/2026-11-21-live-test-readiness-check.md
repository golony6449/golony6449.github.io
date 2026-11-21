# 2026-11-21 — 실게임 테스트 준비 상태 최종 점검

## 15:58 ~ 16:03 (KST) — 실게임 테스트 준비 여부 점검 (`"자 우리 그럼 실게임에서 테스트 할 준비는 끝난거지?"`)

- **사용자의 질문:**
  > "자 우리 그럼 실게임에서 테스트 할 준비는 끝난거지?"
- **실제 PC·저장소·ETS2 설정 파일 기준 팩트 체크 결과:**
  1. **코드 및 일감 완료 현황:**
     - Phase 1-A (`SCRUM-164`~`168`) 및 Phase 1-B (`SCRUM-169`~`174`) 11개 티켓이 전부 PR #10~#20으로 `origin/main`에 머지 완료되어 있다.
     - 로컬 도구·패치·검증·콘솔 관련 핵심 단위 테스트 47건(`test_rencloud_telemetry_setup.py`, `test_patch_controls_sii.py`, `test_tools_console_ui.py`, `test_verify_gamepad_ets2.py`) 전원 통과(`47 passed`)를 확인했다.
  2. **실제 PC의 ETS2 설정·플러그인·패키지 상태:**
     - `D:\SteamLibrary\...\bin\win_x64\plugins\scs-telemetry.dll`: 64비트(`Win64`) DLL 배포 완료, 직전 실행 로그(`Documents\Euro Truck Simulator 2\game.log.txt`, `2026-11-19 23:56`)에서 `loading 'scs-telemetry'` 정상 로드 확인.
     - `steam_profiles\626230313632\config_local.cfg`: `g_trans "0"`(단순 자동변속기), `g_cam_steering "0"` 반영 완료.
     - `steam_profiles\626230313632\controls.sii`: MOZA R3 휠(`device joy`)을 보존한 채 `device joy2 \`xinput.xinput_gamepad_1\``, `joy2.x`/`joy2.rt`/`joy2.lt`, `parkingbrake`(`b1`), `lblinker`(`b5`), `rblinker`(`b6`) 패치 완료.
     - `game.log.txt`(1012행, 1109행): 가상 패드 핫플러그 시 `Using 'xinput_gamepad_1' ('@@xinput_gamepad@@ 1') as ui_joy`로 인식되며 이전의 `<ERROR> Failed to parse device name` 및 `xinput.xinput_gamepad_1` 누락 경고가 사라진 것을 확인했다.
     - `Documents\Euro Truck Simulator 2\config.cfg`: `1280x720` 창모드(`r_fullscreen "0"`)로 캡처·HUD 병행에 적합하게 설정되어 있다.
     - `.venv` 실차 패키지(`mss`, `vgamepad`, `ultralytics`, `cv2`, `numpy`) 설치 및 `yolo11n.pt` 존재 확인.
  3. **실주행 직전 확인·정리할 3가지 잔여 항목:**
     - **`[4]`번 10초 패드 검증 최종 PASS 및 `steer_sign` 확정:** `game.log.txt` 상 11/19 23:56에 패드 바인딩 후 테스트 실행 흔적은 있으나, 전 항목 PASS 여부와 조향 부호(`config/default.toml` 현재 `steer_sign = 1.0`) 확정 기록이 아직 없어 정차 상태에서 `[4]`번 결과를 한 번 확인해야 한다.
     - **`[5]`번 카메라 ROI·소실점 캘리브레이션:** `config/default.toml`이 아직 초기 기본값(`horizon_y_ratio = 0.44`)이므로 첫 주행 전 운전석 시점(`1`번)에서 `[5]`번으로 맞추고 `S` 저장 권장.
     - **로컬 Git 동기화 및 핫픽스 커밋 정리:** 로컬 `main`이 `origin/main`보다 3커밋 뒤처져 있고(`SCRUM-174` PR #20의 `cli.py` `whitebox_minimap`/`whitebox_vision` 선택지 미반영), 11/19 밤 실차 핫픽스(`tools/setup_ets2_integration.py`, `tools/patch_controls_sii.py`, `tools/verify_gamepad_ets2.py`, 로컬 `tools.py`)와 `uv.lock`, untracked `yolo11n.pt`가 미커밋 상태로 남아 있다.

> 교훈: "준비 끝났지?"라는 질문에는 기억이나 완료 티켓 목록만 보지 않고, 실제 디스크의 `controls.sii`, `config_local.cfg`, `game.log.txt`, `git status`까지 한 번에 대조해야 '코드 완료'와 '현장 시운전 준비 완료' 사이의 마지막 5% 빈틈을 정확히 짚어낼 수 있다.

## 16:05 (KST) — 첫 실게임 시운전 개시 결정 (`"먼저 한번 돌려보자."`)

- **사용자 결정:**
  > "먼저 한번 돌려보자."
- **진행 계획:** Git 동기화·커밋 정리는 뒤로 미루고, 현재 로컬 워킹 트리(11/19 실차 핫픽스 포함) 상태로 바로 ETS2 실게임 테스트에 착수한다.
  1. **1단계:** ETS2 운전석 정차 상태에서 `uv run python tools.py` → `[4]` 10초 패드·텔레메트리 자동 검증으로 전 항목 PASS 및 `steer_sign` 확인
  2. **2단계:** `[5]` 대화형 ROI·소실점 캘리브레이션 후 `S` 저장
  3. **3단계:** `[6]` 로컬 단독 자율주행 첫 시운전

## 16:06 (KST) — 질의응답: `"근데 이거 창모드에서도 가능하지?"` (`ScreenCapturer` 주 모니터 전체 캡처 구조 확인)

- **사용자의 질문:**
  > "근데 이거 창모드에서도 가능하지?"
- **실제 코드(`src/ets_ad/capture/screen.py` 318~325행) 확인 결과:**
  - 현재 `ScreenCapturer`는 ETS2 게임 창(`HWND`)만 잘라 찍는 방식이 아니라 **주 모니터 전체 화면(`mss` `sct.monitors[1]` / `dxcam` 기본 출력)**을 캡처한 뒤 `1280x720`으로 정규화한다.
  - 따라서 **`[4]`번 10초 패드 검증**은 텔레메트리 공유 메모리만 쓰므로 작은 창모드에서도 문제없지만, **`[5]`번 캘리브레이션과 `[6]`·`[7]`번 실제 주행**은 화면 일부만 차지하는 작은 창모드에서 돌리면 바탕화면·터미널까지 함께 캡처되어 차선·미니맵 ROI 좌표가 어긋난다.
  - **대응 방안:**
    1. 지금 바로 테스트하려면 ETS2를 **전체 화면(또는 테두리 없는 전체 화면)**으로 띄워 주 모니터를 꽉 채워 실행한다.
    2. 창모드(예: 1280x720 창) 그대로 쓰고 싶으면 `ScreenCapturer`에 Win32 API(`FindWindow`/`GetClientRect`) 기반 **ETS2 게임 창 클라이언트 영역 자동 추적 캡처**를 추가할 수 있다.

> 교훈: 사용자가 "창모드도 되지?"라고 물었을 때 "네, 될 겁니다"라고 추측하지 않고 `screen.py`의 `sct.monitors[1]` 구현을 바로 까본 덕분에, 시운전 첫 판에서 바탕화면이 캡처되어 차선 인식이 망가지는 헛삽질을 사전에 막았다.

## 16:08 ~ 16:11 (KST) — `SCRUM-175` 티켓 등록 및 시니어 서브에이전트 위임 착수

- **사용자 요청:**
  > "2. 요걸로 해보자. 티켓 만들고 서브에이전트로 돌려줄래?"
- **구현 주체 판단 (`deepseek-delegate` 1장):**
  - `구현 주체: 시니어 서브에이전트 (self) — 사용자 직접 지정(1): 창모드 캡처 지원 작업을 티켓 등록 후 서브에이전트로 진행 요청`
- **Jira 등록 및 워크트리 준비:**
  - 일감 생성: **`SCRUM-175`** (`ETS2 창모드(Windowed) 게임 창 클라이언트 영역 자동 추적 캡처 지원`, 에픽 `SCRUM-155`, 스프린트 `SCRUM Sprint 0`, 라벨 `ets-autonomous-driving`, `Feature`) — 상태 `진행 중` 전환 및 시작 댓글 등록 완료.
  - Orca 워크트리 생성: `~/orca/workspaces/ets-autonomous-driving/scrum-175` (브랜치 `feature/SCRUM-175`, 기준 `origin/main` `29ba501`).
  - `tools/calibrate_ets2.py` 605행도 `ScreenCapturer(cfg.capture)`를 직접 사용하므로, `ScreenCapturer`에 Win32 클라이언트 영역 자동 추적을 넣으면 캘리브레이션·로컬 주행·분산 브릿지 전체에 창모드 지원이 자동 적용됨을 확인했다.

## 16:12 ~ 16:14 (KST) — 실차 `[4]`번 테스트 미반응 원인 조사 (`"누락된 컨트롤러 알림참이 떳어. 어거 때문일까?"`)

- **사용자의 제보:**
  > "그 와중에 실차 테스트 해봤는데 안돼. 근데 의심스러운거는 게임 시작할때 누락된 컨트롤러 알림참이 떳어. 어거 때문일까?"
- **실제 `game.log.txt`(2026-11-21 16:05 실행분) 및 `controls.sii` 분석 결과:**
  1. **누락된 컨트롤러 알림창 원인 (953~955행):**
     - `Missing device 'di8.{MOZA}...' ('R3 Racing Wheel and Pedals')`와 `Missing device 'xinput.xinput_gamepad_1' ('@@xinput_gamepad@@ 1')` 두 가지가 게임 시작 시점에 안 꽂혀 있어 뜬 정상 안내창이다(가상 패드는 `[4]`/`[6]` 실행 시에만 핫플러그로 연결됨).
     - `controls.sii` 디스크 파일에는 `device joy2 \`xinput.xinput_gamepad_1\``가 그대로 살아 있고, `[4]`번 실행 시 `00:03:45.630`·`00:05:28.513`에 `Using 'xinput_gamepad_1' as ui_joy`로 핫플러그 인식까지 로그에 찍혔다(누락 경고가 그 순간 사라짐).
  2. **유력한 미반응 원인 2가지 발굴:**
     - **게임 창 백그라운드(포커스 미획득):** PowerShell 터미널에서 `4` 입력 후 엔터를 치면 포커스가 터미널에 남고 ETS2 창은 비활성 상태가 된다. ETS2는 창이 백그라운드일 때 컨트롤러 입력을 무시하는 특성이 있다.
     - **`g_pause_on_disconnect "1"` 자동 일시정지 (`config.cfg` 169행, `game.log.txt` 1009·1056행):** 검증이 끝나 가상 패드가 분리될 때마다 게임이 자동으로 `pause`된다.
  3. 사용자에게 알림창에서 "무시"를 눌렀는지, `[4]`번 출력 내용과 함께 **엔터 직후 2.5초 웜업 동안 ETS2 창을 클릭해 포커스를 주고 재시도**하도록 안내했다.

> 교훈: 가상 패드를 핫플러그로 붙였다 떼는 구조에서는 ① PowerShell에서 실행 직후 게임 창에 포커스를 돌려줘야 XInput 입력이 먹히고, ② `g_pause_on_disconnect "1"` 때문에 매 종료마다 게임이 자동 일시정지된다는 점까지 함께 다뤄야 한다.

## 16:17 (KST) — 첫 가상 패드 실차 반응 돌파! (포커스 획득 후 브레이크·좌/우 깜빡이 PASS, 조향 `-0.5 → +0.500` 확인)

- **사용자 실행 결과 (`tools.py` `[4]` 10초 검증, ETS2 창 클릭으로 포커스 부여 후):**
  - **좌측 깜빡이(LB):** 통과 (단발 펄스 켜짐/꺼짐 왕복 성공)
  - **우측 깜빡이(RB):** 통과 (단발 펄스 켜짐/꺼짐 왕복 성공)
  - **브레이크:** 통과 (`gameBrake=1.000`)
  - **조향:** `+0.5 → gameSteer=+0.000`, **`-0.5 → gameSteer=+0.500`** (크기 1:1 정확 반응, 부호 반대 확인!)
  - **스로틀:** 실패 (`gameThrottle=0.000`)
- **원인 분석:**
  1. **포커스 가설 적중:** ETS2 창을 클릭해 포커스를 주자 그동안 `0.000`이던 가상 패드(`xinput.xinput_gamepad_1`) 입력이 즉시 게임에 반영되기 시작했다.
  2. **조향 첫 0.4초(`+0.5`) 누락 및 부호 반대:** 엔터 후 ETS2 창을 클릭하는 시점이 2.5초 웜업 직후를 살짝 넘겨 첫 `+0.5` 구간만 놓쳤고, 이어진 `-0.5` 구간에서 정확히 `+0.500`이 찍혔다. `controls.sii`의 `mix steering`이 `- j2_steer?0`로 빼기 부호이므로 실차 조향 보정은 **`steer_sign = -1.0`**이 확정적이다.
  3. **스로틀 `0.000` & 브레이크 `1.000`:** `verify_gamepad_ets2.py`가 패드 원시 입력(`userThrottle`/`userBrake`) 대신 게임 물리 출력(`gameThrottle`/`gameBrake`)을 읽고 있다. 트럭 시동이 꺼져 있거나(RPM 0) 파킹브레이크가 체결된 상태에서는 ETS2 물리 엔진이 `gameThrottle`을 `0.0`으로 막고 `gameBrake`를 `1.0`으로 고정할 수 있다.
- **다음 확인:** 시동(`E`) ON 여부 확인 및 엔터 직후 빠르게 ETS2 창 클릭 후 재검증 안내.

> 책 소재: "아아 포커스 때문일거같다. 다시 해볼게" — 게임 창을 한 번 클릭한 순간, 수 차례의 트러블슈팅 끝에 마침내 가상 Xbox 패드가 실제 유로트럭의 핸들(`+0.500`)과 좌/우 깜빡이를 움직이기 시작한 첫 돌파의 순간.

## 16:24 ~ 16:25 (KST) — 시동 ON 재검증: 스로틀·조향·깜빡이 통과, 브레이크만 실패 원인 규명 (단순 자동변속기 `abackward` 정차 후진 전환)

- **사용자의 보고:**
  > "이제 스로틀은 통과하고 브레이크만 실패야."
- **원인 검증 (`eurotrucks2.exe` `0x27a700~0x27b000` 역어셈블):**
  - XInput 채널 등록 테이블을 직접 추출해 `lt` (`@@left_trigger@@`), `rt` (`@@right_trigger@@`), `b1`~`b6` (`A`~`RB`) 토큰이 모두 100% 정확함을 재확인했다.
  - **시동 OFF 때 브레이크 통과·스로틀 실패 ↔ 시동 ON 때 스로틀 통과·브레이크 실패**라는 대칭 현상의 정확한 원인:
    - 단순 자동변속기(`g_trans "0"`, `c_stm_simple 1.0`)에서는 정차(`speed == 0`) + 시동 ON 상태에서 `mix abackward`(`joy2.lt`)를 밟으면 게임이 브레이크가 아니라 **후진(Reverse) 시도**로 해석하여 `gameBrake`가 `0.000`으로 떨어지고 `userBrake`만 올라간다(전진 주행 중에는 정상 브레이크로 동작).
    - 반면 `tools/verify_gamepad_ets2.py`가 `userBrake`를 보지 않고 `gameBrake`(`ego.brake_input`)만 검사했기 때문에 정차 검증에서 오탐 실패가 발생한 것이다.
- **결론:** 가상 패드 5개 채널(조향·스로틀·브레이크·좌/우 깜빡이)은 하드웨어·`controls.sii` 수준에서 **전부 정상 연결 확인 완료**. 다만 본 주행 전 `steer_sign`(`+1.0` vs `-1.0`) 방향만 최종 확인하면 바로 주행에 들어갈 수 있다.

> 교훈: 단순 자동변속기 게임에서 정차 중 브레이크 페달(`abackward`)을 검증할 때 물리 결과값(`gameBrake`)만 보면 게임이 후진 시도로 바꿔버려 거짓 실패가 난다. 정차 검증 도구는 `userBrake`/`userThrottle`(원시 게임 입력)까지 함께 확인해야 변속기 모드의 함정에 빠지지 않는다.

## 16:27 ~ 16:30 (KST) — `[4]`번 검증 상세 진단 JSON 자동 저장 기능 추가 (`"테스트 결과를 파일로 저장하게 해줘"`)

- **사용자 요청:**
  > "조향도 실패다. 근데 이거 이렇게 하니까 불편해. 4번에서 테스트 돌리면 테스트 결과를 파일로 저장하게 해줘. 터미널이 안보여주는 세세한 내용 포함해서 말이지. 그리고 세션에서 그거 읽어서 분석하자."
- **구현 주체 판단 (`deepseek-delegate` 1장):**
  - `구현 주체: 직접 구현(Gemini 메인 세션) — 현재 실차 테스트 중인 로컬 워킹 트리의 tools/verify_gamepad_ets2.py 단일 파일 즉각 보강(5: 위임·PR 왕복 비용이 더 크고 즉시 실행 필요)`
- **구현 내용 ([verify_gamepad_ets2.py](file:///D:/Programming/ets-autonomous-driving/tools/verify_gamepad_ets2.py), [.gitignore](file:///D:/Programming/ets-autonomous-driving/.gitignore)):**
  - `[4]`번 실차 실행 시 매번 `data/diagnostics/verify_gamepad_latest.json`(최신) 및 `verify_gamepad_YYYYMMDD_HHMMSS.json`(이력) 2개 파일로 자동 저장.
  - 저장 항목:
    - 공유 메모리 원시 헤더(`sdk_active`, `paused`, `revision`), 가상 패드 설정, 시작/웜업 직후 활성 포커스 창 제목(`GetForegroundWindow`).
    - 단계별(`initial`, `steer_positive`, `steer_negative`, `throttle`, `brake`, `left_blinker_*`, `right_blinker_*`, `final`) 보낸 논리 명령·실제 패드 인가값·활성 창 제목·`EgoState` 전체(`game_steer`/`user_steer`, `game_throttle`/`user_throttle`, `game_brake`/`user_brake`, `rpm`, `gear`, `park_brake`, `speed_kmh` 등).
  - 웜업 대기를 3초 카운트다운(`[대기] 3..2..1초 후 검증 시작... (ETS2 창 클릭 유지)`)으로 개선해 포커스 타이밍을 놓치지 않도록 했다.
  - `.gitignore`에 `data/diagnostics/` 추가.

## 16:34 (KST) — `verify_gamepad_latest.json` 엑스레이 분석: 5개 채널 전부 소수점 3자리 수준 1:1 정밀 동작 실측 완료!

- **사용자 요청:**
  > "실행결과 분석해줘"
- **실제 기록 파일(`data/diagnostics/verify_gamepad_latest.json`, `16:33:43 KST`) 전 구간 실측 수치:**
  - 포커스 상태: 시작(`Orca`) → 웜업 후 및 전 구간(`Euro Truck Simulator 2`) — 3초 카운트다운 효과로 전 구간 완벽 포커스 유지!
  - **조향 (`+0.5` / `-0.5`):** `+0.5 → game_steer=-0.500 (user_steer=-0.500)`, `-0.5 → game_steer=+0.500 (user_steer=+0.500)`. 1:1 크기 완벽 대칭, 부호만 반대 → **`config/default.toml` `steer_sign = -1.0` 확정!**
  - **스로틀 (`0.4` → 데드존 보상 `0.46`):** `game_throttle=0.3986`, `user_throttle=0.3987`, `gear=1`, `rpm=887.0` — ETS2 10% 데드존 선형 보상이 소수점 셋째 자리(`0.400 ≈ 0.399`)까지 정확하게 맞음을 실측 검증!
  - **브레이크 (`0.4` → 데드존 보상 `0.46`):** **`user_brake=0.3987`**(정확히 `0.400`!)로 완벽 입력되었으나, 단순 자동변속기(`g_trans "0"`) + 정차(`0 km/h`) 상태라 게임이 기어를 **`gear=-1`(후진)**로 변속하며 `game_throttle=0.3987`, `game_brake=0.0`, `speed_kmh=-0.111`로 전환한 것이 원시 JSON으로 100% 입증됨!
  - **좌/우 깜빡이 (LB/RB):** 각각 `false → true → false` 단발 펄스 왕복 완벽 통과.
- **결론:** 하드웨어·`controls.sii`·데드존 보상·단발 펄스 5개 채널 모두 100% 정상 검증 완료. `config/default.toml`에 `steer_sign = -1.0`만 반영하고, `verify_gamepad_ets2.py`가 브레이크 판정 시 `user_brake`도 함께 보도록 보강하면 실차 테스트 100% 통과 상태가 된다.

> 책 소재: "터미널이 안 보여주는 세세한 내용까지 파일로 저장해서 읽고 분석하자" — 진단 JSON을 도입하자마자 단 한 번의 실행으로 조향 ±0.500 대칭, 데드존 보상 0.400→0.3987 정밀 일치, 그리고 단순 자동변속기가 정차 브레이크(`user_brake=0.3987`)를 후진(`gear=-1`, `game_brake=0.0`)으로 바꿔버리는 현장 물리 현상까지 엑스레이처럼 100% 증명해 낸 순간.

## 16:35 ~ 16:37 (KST) — 실측 확정값 반영 (`steer_sign = -1.0`) 및 검증 도구 `user_brake`·설정 연동 보강

- **사용자 승인:** `"응 해줘"`
- **구현 주체 판단 (`deepseek-delegate` 1장):**
  - `구현 주체: 직접 구현(Gemini 메인 세션) — 사용자 승인 후 실차 확정값(steer_sign=-1.0) 반영 및 tools/verify_gamepad_ets2.py 소규모 판정 보강(5: 몇 줄 수정)`
- **변경 내용:**
  1. [config/default.toml](file:///D:/Programming/ets-autonomous-driving/config/default.toml): `steer_sign = -1.0` 반영 (실측 `+0.5 → -0.500`, `-0.5 → +0.500` 기준).
  2. [tools/verify_gamepad_ets2.py](file:///D:/Programming/ets-autonomous-driving/tools/verify_gamepad_ets2.py):
     - 브레이크/스로틀 판정이 `gameBrake`/`gameThrottle`뿐 아니라 원시 패드 입력 `userBrake`/`userThrottle`도 함께 확인해 단순 자동변속기 정차 후진 전환 오탐을 해소.
     - `_run_real()`이 `load_config().control`의 `steer_sign`/`steer_scale`/`deadzone_compensation`을 그대로 적용해 실제 주행과 동일한 조건으로 검증하고, 통과 시 현재 `steer_sign` 유지 권고를 출력.
  3. [tests/test_config.py](file:///D:/Programming/ets-autonomous-driving/tests/test_config.py), [tests/test_verify_gamepad_ets2.py](file:///D:/Programming/ets-autonomous-driving/tests/test_verify_gamepad_ets2.py): 회귀 테스트 및 신규 2건 추가.

## 16:40 (KST) — 실차 10초 가상 패드·텔레메트리 검증 **5개 전 항목 종합 통과!** (`"종합통과!"`)

- **사용자의 반응:**
  > "종합통과!"
- **최종 검증 기록 ([verify_gamepad_latest.json](file:///D:/Programming/ets-autonomous-driving/data/diagnostics/verify_gamepad_latest.json), `16:40:46 KST`):**
  - **조향 (`steer_sign = -1.0`):** `+0.5 → gameSteer=+0.500`, `-0.5 → gameSteer=-0.500` (**통과**)
  - **스로틀:** `gameThrottle=0.399`, `userThrottle=0.399` (**통과**)
  - **브레이크:** `userBrake=0.399` (`gear=-1`, 단순 자동변속기 정차 후진 전환 정상 확인, **통과**)
  - **좌측 깜빡이 (LB):** 단발 펄스 켜짐/꺼짐 왕복 (**통과**)
  - **우측 깜빡이 (RB):** 단발 펄스 켜짐/꺼짐 왕복 (**통과**)
  - **종합:** **`ok: true` (전 항목 통과)**

> 책 소재: "종합통과!" — 32비트 DLL 함정, `xinput.xinput_gamepad_1` 역어셈블, 게임 창 포커스, 조향 부호 반전(`steer_sign = -1.0`), 단순 자동변속기 정차 후진 전환까지 모든 현장 장애물을 하나씩 격파하고 마침내 5개 제어 채널 전부 소수점 셋째 자리 정밀도로 `ok: true`를 찍은 순간.

## 17:13 (KST) — `SCRUM-175` 시니어 구현 완료(Draft PR #21) 및 Qwen QA 검토 진입

- **시니어 서브에이전트 완료 보고 (`feature/SCRUM-175`, 커밋 `d31dbbf`, PR #21):**
  - 변경 파일 5건: `config/default.toml`, `src/ets_ad/config.py`, `src/ets_ad/capture/screen.py`, `tests/test_config.py`, `tests/test_capture.py`.
  - 핵심 테스트: `test_capture.py`(18건) + `test_config.py`(28건) = **46 passed**.
  - 슬랙 시작(`thread=cabe3d5ab`)·완료(`thread=cfcde7f26`) 보고 완료.
- **PL 조치:** `SCRUM-175` 상태를 `검토 중`(`31`)으로 전환하고 `qwen-review.py`로 QA 검토를 실행한다.

## 17:19 ~ 17:23 (KST) — `SCRUM-175` Qwen QA 1회차 통과(`$0.045`)·PR #21 머지·Jira 완료 및 로컬 반영

- **Qwen QA 검토 결과 (`20261121-171512-scrum-175`, Round 1):**
  - 판정: **`pass`** (지적 0건, `agreed: []`, `needs_claude: []`, `minor_count: 0`, `--check` 46 passed).
  - 모델별 비용: `qwen3.8-flash` `$0.0085` + `qwen3.7-plus` `$0.0365` = **총 `$0.0450`** (QA 슬랙 보고 `posted`).
- **마무리:**
  - PR #21 정식 전환 → `main` 머지 완료 (`1c0a9b7`), 원격 브랜치 `feature/SCRUM-175` 삭제, Jira `SCRUM-175` 결과 댓글 및 `완료`(`41`) 전환 완료.
  - 로컬 실차 핫픽스(`steer_sign = -1.0`, `verify_gamepad_latest.json` 진단 저장 등)를 보존한 채 `SCRUM-175`의 창모드 캡처 변경분(`src/ets_ad/capture/screen.py`, `src/ets_ad/config.py`, `config/default.toml` `[capture]` 2키, `tests/test_capture.py`)을 로컬 워킹 트리에 안전하게 반영했다.

> 책 소재: 실차 `[4]`번 패드 종합 통과와 창모드 클라이언트 영역 자동 추적(`SCRUM-175`, Qwen 듀얼 모델 지적 0건, `$0.045`)이 동시에 완성되어, 이제 창모드 ETS2 옆에 HUD·터미널을 띄워 놓고 곧장 `[5]` 캘리브레이션과 `[6]` 첫 자율주행에 돌입할 수 있게 된 순간.

## 17:26 (KST) — `[5]` 캘리브레이션 완료 및 `[6]` 첫 자율주행 진입 안내 (`"캘리브레이션 해봤어"`)

- **사용자 보고:**
  > "캘리브레이션 해봤어"
- **확인:** `config/default.toml`의 `[camera.interior]`는 기본값(`road_top_y_ratio = 0.44`, `road_bottom_y_ratio = 0.70`, `horizon_y_ratio = 0.44`) 유지 상태.
- 창모드 게임 화면 캡처 정상 여부 확인과 함께 `[6]` 로컬 단독 자율주행 시운전 절차(안전장치: `F12` Kill Switch / `F10` 일시정지 / ETS2 창 포커스 유지)를 안내했다.

## 17:33 ~ 17:35 (KST) — 첫 자율주행 시운전 트러블슈팅: `"6번 해봤는데 출발을 못하고 있어"` → `TakeoverMonitor` 조향 부호 자폭 버그 발굴!

- **사용자의 제보:**
  > "6번 해봤는데 출발을 못하고 있어"
- **코드·실측 대조를 통해 발굴한 치명적 버그 1건 + 구조적 불편 2건:**
  1. **`TakeoverMonitor` 조향 부호 반전 자폭 버그 (`src/ets_ad/pipeline.py:495`, `src/ets_ad/distributed/vehicle_bridge.py:673`):**
     - 11/19 설계 당시 `steer_sign = -1.0`일 때 `TakeoverMonitor`에 `applied.steering`(= `hw_steering = raw * -1.0`)을 넘기도록 구현했으나, 실제 ETS2 `controls.sii`(`- j2_steer?0`)가 다시 마이너스를 곱해 텔레메트리 **`ego.user_steering`은 `raw_command.steering`과 같은 부호(`+0.5`)**로 돌아옴을 방금 `[4]`번 실차 JSON에서 실측했다.
     - 결과적으로 `abs(ego.user_steering - applied.steering) = abs(+u - (-u)) = 2|u|`가 되어, 조향이 `0.08`만 나가도 0.15초 만에 `DriverTakeoverMonitor`가 스스로 Kill Switch(`MANUAL`, 재개 `F10`)를 발동시켜 출발을 차단하는 자폭 버그가 있었다!
     - 올바른 기대값은 `applied.steering * steer_sign` (= `clamp(raw_command.steering * steer_scale, -1.0, 1.0)`).
  2. **HUD 창 포커스 탈취 & `[6]`번 자동 로그 미기록 (`tools.py:383`):**
     - `cv2.imshow`로 HUD 창이 뜨면서 ETS2 게임 창의 포커스를 빼앗아 갈 수 있고, `tools.py` `[6]`번에 `--record-dir data/recordings`가 빠져 있어 주행 직후 `frames.jsonl`을 열어 원인을 사후 분석할 수 없었다.

> 교훈: 11/19 설계 리뷰에서 "오탐을 막으려고 `applied.steering`으로 바꾼다"고 세웠던 안전장치 수정이, 실제 게임의 `controls.sii` 이중 반전(`steer_sign = -1.0` × `- j2_steer?0` = `+1.0`)을 만나 정반대로 자폭 버그가 되었다. 물리 좌표계 규약은 반드시 실측 데이터(`verify_gamepad_latest.json`)로 끝까지 검산해야 한다.

## 17:43 ~ 17:46 (KST) — `TakeoverMonitor` 자폭 버그 + 전역 `F10`/`F12` 핫키 + `[6]`번 자동 주행 로그 저장 수정

- **사용자 확인 및 추가 제보:**
  > "1. 응 떠있어. 그리고 중요한거. F10 눌러도 복구가 안돼. 2. 응 같이 고쳐줘"
- **구현 주체 판단 (`deepseek-delegate` 1장):**
  - `구현 주체: 직접 구현(Gemini 메인 세션) — 안전 핵심 제어 경로(TakeoverMonitor 비교 기준 및 전역 F10/F12 비상정지 핫키) 즉시 수정(2)`
- **원인 추가 규명 (`F10` 미복구):**
  - `cli.py`의 `cv2.waitKeyEx(1)`은 OpenCV HUD 창에 포커스가 있을 때만 키를 받으며, Windows에서는 `F10`이 시스템 메뉴 키로 삼켜지기도 한다. ETS2 게임 창에 포커스를 주고 주행할 때는 `F10`(재개)·`F12`(Kill Switch)가 전혀 전달되지 않았다.
  - 또한 `--hardware-gamepad` 실행 직후 가상 패드 핫플러그 바인딩(1.5~2초) 및 게임 창 클릭 대기 없이 즉시 제어 루프가 돌아가면 시작 0.15초 만에 `user_steering=0.0` 차이로 Takeover가 오탐될 수 있었다.
- **수정 내용:**
  1. [pipeline.py](file:///D:/Programming/ets-autonomous-driving/src/ets_ad/pipeline.py), [vehicle_bridge.py](file:///D:/Programming/ets-autonomous-driving/src/ets_ad/distributed/vehicle_bridge.py): `TakeoverMonitor` 비교 기준을 `applied.steering * steer_sign`(실제 ETS2 텔레메트리 기대값)으로 수정하고 해당 단위 테스트(`test_hud_recorder_pipeline.py`, `test_vehicle_bridge.py`)도 실측 규격에 맞게 갱신.
  2. [cli.py](file:///D:/Programming/ets-autonomous-driving/src/ets_ad/cli.py): Win32 `GetAsyncKeyState` 상승 에지 기반 `_GlobalHotkeyPoller` 추가로 **ETS2 창에 포커스가 있어도 `F10`/`F12`/`F1`~`F5`가 즉시 동작**하게 개선, 실차 가상 패드 시작 시 3초 포커스 카운트다운 추가, 종료 시 `[주행 로그 저장]` 경로 출력.
  3. [tools.py](file:///D:/Programming/ets-autonomous-driving/tools.py): `[6]`번 실차 주행 시 `--record-dir data/recordings` 자동 포함.

## 17:51 ~ 17:53 (KST) — 첫 자율주행 출발 성공(`12.09 km/h`, 437프레임 자율 주행) 및 `frames.jsonl` 엑스레이 분석!

- **사용자 보고:**
  > "다시시작했어"
- **실차 주행 로그 분석 (`data/recordings/20261121_174938_509523/frames.jsonl`, 총 1,240프레임):**
  - **첫 자율 출발·주행 대성공:** `TakeoverMonitor` 자폭 버그 완전 해소! `step 0~436` 동안 실제 유로트럭이 스스로 시동·기어 1단·엑셀·조향·우측 깜빡이를 조작하며 **최고 속도 `12.09 km/h`**, 약 `37m` 이동 (`nav_distance_m`: `644,298m → 644,261m`). 차선 검출도 주행 중 `confidence = 0.95`, `lateral_offset_m = -0.02 ~ +0.20m`로 정상 인식됨.
  - **상태 분포:** `INTERSECTION_TURN` 177, `ROUNDABOUT` 125, `APPROACH_STOP` 86, `LANE_CHANGE` 16, `FOLLOW` 15, `EMERGENCY_BRAKE` 10, `CRUISE` 4, `TOLLGATE` 4, `MANUAL` 803 (`step 437`부터).
  - **`step 437` `MANUAL` 전환 원인:** `step 434~438`에서 ETS2 창 포커스가 빠지며 `user_steering = -0.57985`, `user_throttle = 1.0`이 동결되었고, 제어기 명령(`+0.877` → 기대 `-0.877`)과 차이가 발생해 `TakeoverMonitor`가 정상적으로 안전 해제를 발동함.
  - **실주행 품질을 가로막은 2대 핵심 버그 발굴:**
    1. **YOLO 운전석 내부·비차량 오탐 (`src/ets_ad/perception/objects.py:73`):** 트럭 대시보드 내비 화면을 `"tv"`(`4.6m`, `in_ego_lane=True`)로, 운전석 창틀 전체(`[3, 8, 980, 712]`)를 `"bus"`/`"train"`(`3.6m`)으로 검출해 `lead_vehicle`로 등록 → `"전방 4.6m tv가 안전거리 8.0m 이내 → 정지 목표"`로 가다 서다 반복(`APPROACH_STOP` 86회, `EMERGENCY_BRAKE` 10회).
    2. **미니맵 내비 오프셋·곡률 폭주 (`nav.route_offset_m = +25~37m`, `upcoming_curvature = -1.99`, `ROUNDABOUT` 125회):** 차선 미검출 시 폴백으로 쓰이는 미니맵 오프셋이 실제 도로 폭(3.5m)의 10배인 `+25~37m`로 계산되어 출발 직후 핸들을 끝까지 꺾는 현상 발생.

> 책 소재: 첫 자율주행 `12.09 km/h` 출발에 성공한 직후 주행 로그(`frames.jsonl`)를 열어보니, YOLO가 트럭 대시보드 내비 화면을 *"전방 4.6m의 TV"*로 오인해 급브레이크를 밟고 있었던 폭소와 통찰의 순간 — "화이트박스 판단 근거(한국어 로그)"가 왜 필수인지를 단 한 줄(`전방 4.6m tv가 안전거리 8.0m 이내 → 정지 목표`)로 완벽하게 증명했다.

## 17:53 ~ 17:56 (KST) — 시각 디버깅(`live_full_roi.png`): `"근데 차선인식을 전혀 못하는데?"` 원인 4건 100% 시각 확인

- **사용자의 지적:**
  > "근데 차선인식을 전혀 못하는데?"
- **실제 화면 캡처 시각 검증 (`scratch/live_full_roi.png`, `live_road_mask.png`):**
  1. **창모드 캡처(`SCRUM-175`)는 정상 동작** 확인(HUD 창 안에 ETS2 게임 화면만 정규화되어 표시됨).
  2. **HUD 창이 ETS2 창 하단을 일부 가림:** `mss` 캡처는 화면에 보이는 픽셀을 그대로 찍으므로 HUD 창이 ETS2 창과 겹치면 안 된다(HUD를 오른쪽/겹치지 않는 위치로 배치 필요).
  3. **게임 환경:** 현재 인게임 시각이 **한밤중(`00:43 AM`)**이며 바로 앞에 시내버스가 가로막고 있어 바닥 차선이 거의 보이지 않는 상태.
  4. **운전석(`interior`) ROI 하단 경계 과다 (`road_bottom_y_ratio = 0.70`):** 실제 ETS2 운전석 앞유리 도로 영역은 `y ≈ 0.38 ~ 0.62`인데 하단이 `0.70`까지 내려가 있어 **빨간 대시보드·계기판·핸들 테두리를 차선(`conf=0.95`)으로 오검출**하고 있었다. `road_bottom_y_ratio`를 `0.60~0.62`로 올려 대시보드를 제외하거나, 초기 테스트에는 `6`번 범퍼 시점(`bumper`)을 쓰면 대시보드 간섭이 0이 된다.

> 교훈: 숫자 로그(`lane.confidence = 0.95`)만 보면 차선 인식이 잘 되는 것처럼 착각하기 쉽다. 실제 캡처 이미지 한 장(`live_full_roi.png`)을 눈으로 확인한 순간, "신뢰도 0.95짜리 차선"의 정체가 도로가 아니라 트럭 계기판·핸들 테두리였고 HUD 창이 게임 창 하단을 가리고 있었음이 1초 만에 드러났다.

## 17:55 ~ 17:58 (KST) — YOLO 오탐 차단 · 미니맵 오프셋 클램핑 · 운전석 ROI 대시보드 제외 수정

- **사용자 승인:** `"1"`
- **구현 주체 판단 (`deepseek-delegate` 1장):**
  - `구현 주체: 직접 구현(Gemini 메인 세션) — 현재 실차 테스트 중인 로컬 워킹 트리의 안전 핵심 인식 경로(YOLO 오탐 비상정지 차단·미니맵 조향 폭주 클램핑) 즉시 수정(2)`
- **수정 내용:**
  1. [objects.py](file:///D:/Programming/ets-autonomous-driving/src/ets_ad/perception/objects.py): 코리더 차량 선별을 도로 주체 화이트리스트(`car`, `truck`, `bus`, `motorcycle`, `bicycle`, `person`, `van`, `trailer`)로 전환하고, 화면 천장~하단 전체를 덮는 운전석 창틀 초대형 오탐 박스(`_is_cabin_frame_false_positive`)를 차단.
  2. [nav_minimap.py](file:///D:/Programming/ets-autonomous-driving/src/ets_ad/perception/nav_minimap.py): `meters_per_pixel` 기본값을 `0.4 → 0.06`으로 현실화하고 `route_offset_m`을 1차선 폭 기준 `[-3.5, +3.5]m`로 클램핑해 `+25~37m` 조향 폭주 차단.
  3. [default.toml](file:///D:/Programming/ets-autonomous-driving/config/default.toml) 및 [config.py](file:///D:/Programming/ets-autonomous-driving/src/ets_ad/config.py): `[camera.interior]`의 `road_top_y_ratio = 0.40`, `road_bottom_y_ratio = 0.60`으로 조정(내장 `_FALLBACK_DEFAULTS` 동기화 포함)해 빨간 대시보드·핸들·계기판 영역을 차선 ROI에서 제외.
  4. [test_perception_objects_tl.py](file:///D:/Programming/ets-autonomous-driving/tests/test_perception_objects_tl.py), [test_perception_lane_nav.py](file:///D:/Programming/ets-autonomous-driving/tests/test_perception_lane_nav.py), [test_camera_presets.py](file:///D:/Programming/ets-autonomous-driving/tests/test_camera_presets.py): 대시보드 `tv`/창틀 `bus` 오탐 차단·미니맵 오프셋 클램핑 회귀 테스트 추가 및 `interior` ROI 기본값 단언(`0.40 ~ 0.60`, 높이 `144px`) 동기화.
- **검증 결과:**
  - `.venv\Scripts\python.exe -m pytest -p no:cacheprovider tests/test_perception_objects_tl.py tests/test_perception_lane_nav.py tests/test_camera_presets.py tests/test_config.py tests/test_calibrate_ets2.py tests/test_decision.py -q` → **138 passed, 1 skipped in 2.03s**.

> 교훈: 실주행에서 처음 잡히는 인식 오류는 알고리즘 고도화보다 "볼 것만 보게 만드는 경계 설정(비차량 화이트리스트·운전석 창틀 컷·대시보드 ROI 제외·미니맵 오프셋 클램핑)"에서 대부분 해결된다.

## 18:03 ~ 18:10 (KST) — 2차 실주행 로그 분석: 중앙분리대 돌진의 진짜 원인(조향 부호 반전) 대발견

- **사용자 보고:**
  > "지금 1차선에서 중앙분리대 쪽으로 돌진했고, 앞에 장애물이 있어도 직전하려고 하고 있어. 차선인식이 안되는것 같고, 장애물 상황에서 직진으로만 돌파하려는 것 같아."
- **주행 로그 분석 ([frames.jsonl](file:///D:/Programming/ets-autonomous-driving/data/recordings/20261121_180317_112221/frames.jsonl), 총 2,806프레임):**
  - 상태 분포: `MANUAL` 2,187(`f=619`부터), `ROUNDABOUT` 531, `LANE_CHANGE` 32, `INTERSECTION_TURN` 31, `FOLLOW` 16, `APPROACH_STOP` 6, `EMERGENCY_BRAKE` 3.
  - **치명적 버그 1 — 조향 피드백 부호 완전 반전 (`src/ets_ad/control/lateral.py`):**
    - 인식(`lane.py`, `nav_minimap.py`)과 판단(`whitebox_planner.py`) 전체는 **"오른쪽 = 양수(`+`), 왼쪽 = 음수(`-`)"** 좌표계로 통일되어 있다(`lane_center_px - ego_center_px > 0` → 차선 중심이 오른쪽, `TURN_RIGHT` → `+` 곡률, `LANE_CHANGE_OFFSET_BIAS_M` 오른쪽 `+0.85m`).
    - 반면 `ControlCommand.steering`과 ETS2 텔레메트리(`steering_input` / `game_steer`)는 **"양수(`+`) = 좌조향(왼쪽), 음수(`-`) = 우조향(오른쪽)"** 규약이다.
    - 그런데 `StanleyLateralController.compute_steering()`이 `steer_rad`에 `-` 부호를 붙이지 않고 양수 그대로 내보내, 차선 중심이 오른쪽(`+0.28m`)에 있을 때 **왼쪽(`ego_st = +0.25 ~ +0.82`)으로 핸들을 꺾는 양의 피드백(Positive Feedback) 발산**이 발생했다.
    - 로그에서 `f=1~130` 동안 `lane.off`가 `+0.28 → +0.62 → +0.85 → +1.02m`로 벌어질수록 `ego_st`가 `+0.16 → +0.24 → +0.49 → +0.82`(더 강한 좌조향)로 커지며 결국 1차선 왼쪽 중앙분리대 화단·가로수에 그대로 돌진했음이 100% 확인되었다.
  - **원인 2 — 장애물 앞에서 직진 돌파처럼 보인 3가지 이유:**
    1. **정적 장애물 미인식:** 트럭을 막은 중앙분리대·가로수·화단·연석은 COCO YOLO11n 클래스에 없어 검출 자체가 불가(`objs=[]`).
    2. **야간 차량 깜빡임(Flicker) 1프레임 해제:** `f=11`, `f=23`, `f=47`에서 `car@4.4m`를 잡아 `APPROACH_STOP`/`EMERGENCY_BRAKE`를 걸었지만, 바로 다음 1프레임(`f=12`, `f=24`, `f=49`)에서 YOLO가 차량을 놓치자마자 즉시 브레이크를 풀고 `throttle=1.0` 풀악셀로 돌파했다.
    3. **충돌·끼임(Stuck) 안전 정지 부재 + Phase 1 설계 한계:** 현재 화이트박스 판단기는 앞차에 대해 정지/추종만 수행(능동 회피 미구현)하며, 가로수에 박혀 `speed = 0.0 km/h`인 채로 `f=100~600`(500프레임) 동안 `throttle=1.0`을 계속 밟았다.
  - **원인 3 — 야간 가짜 차선 오검출 & 미니맵 `ROUNDABOUT` 531회 오탐:**
    - 트럭이 밤길 풀밭·가로수 앞에 서 있는데도 `_low_light_lane_mask`(CLAHE + Sobel X)가 가로등 빛·연석을 `conf=0.95`, `off=+0.55` 가짜 차선으로 검출했다.
    - 미니맵 ROI 안에 빨간 속도표지(`50`)·경고 UI가 함께 잡히면서 `curv=-2.6 ~ -4.3`, `ROUNDABOUT`가 531회 오탐되었다.

> 책 소재: "차선 중심으로 가라고 했는데 왜 중앙분리대로 돌진했을까?" — 인식·판단은 "오른쪽(+)", 조향·ETS2는 "왼쪽(+)"으로 단 하나의 마이너스(`-`) 부호가 빠져 있었고, 그 결과 차선에서 왼쪽으로 벗어날수록 더 세게 왼쪽으로 꺾는 완벽한 양의 피드백 폭주가 일어났다. 단위 테스트는 `lat_offset=+50 → steer=+1.0`만 확인했기에 시뮬레이션 전까지는 아무도 알아채지 못한, 실차 테스트만의 결정적 수확!

## 18:13 ~ 18:15 (KST) — 실차 발굴 4건 Jira 일감 일괄 등록 (`SCRUM-176` ~ `SCRUM-179`)

- **사용자 결정:**
  > "모두 일감으로 등록하고 넘어가자"
- **중복 확인:** `project = SCRUM AND labels = "ets-autonomous-driving" AND statusCategory != Done` → 0건(중복 없음).
- **등록 완료 (에픽 `SCRUM-155` 하위, 모두 독립 일감):**
  - `SCRUM-176` (https://golony.atlassian.net/browse/SCRUM-176) — Stanley 조향 제어기 부호 반전 수정 및 음의 피드백 복구 (`ets-autonomous-driving`, `Bug`, Highest)
  - `SCRUM-177` (https://golony.atlassian.net/browse/SCRUM-177) — 전방 차량 YOLO 단발 미검출(Flicker) 유지 히스테리시스 추가 (`ets-autonomous-driving`, `Bug`, High)
  - `SCRUM-178` (https://golony.atlassian.net/browse/SCRUM-178) — 정적 장애물 충돌·끼임(Stuck) 감지 자동 정지 안전장치 추가 (`ets-autonomous-driving`, `Feature`, High)
  - `SCRUM-179` (https://golony.atlassian.net/browse/SCRUM-179) — 야간 차선 오검출 완화 및 미니맵 로터리(ROUNDABOUT) 오탐 억제 (`ets-autonomous-driving`, `Improvement`, Medium)

> 교훈: 실차 시험 도중 여러 층위(제어 부호·인식 히스테리시스·안전 정지·야간/미니맵 노이즈)의 이슈가 한꺼번에 쏟아질 때는 즉석 핫픽스로 뭉뚱그리기보다 PR 1개 크기의 독립 일감으로 쪼개 Jira에 등록하고 단계적으로 검증하는 편이 훨씬 안전하다.

## 18:25 ~ 18:56 (KST) — 실차 핫픽스 일괄 정리(PR #24) 및 `uv` 전역 권한 허용

- **사용자 요청:**
  > "핫픽스 정리해줘. 그리고 집필노트 쓰고 있지?"
  > "uv 명령 전체 허용해줘. 제발 그만 물어봐"
- **`uv` 전역 권한 허용 반영:**
  - 원인: `golony-agent-support`의 `permissions.json` 및 `scripts/install.py`(`AGY_DEFAULT_ALLOW`)에 `uv run pytest`만 등록되어 있고 `uv *` / `uv:*` / `uv.exe *` 와일드카드가 빠져 있었다.
  - 수정: `golony-agent-support`(`eb9d15f`)에 `uv` / `uv.exe` 전체 허용 규칙을 추가하고 `python scripts/install.py`로 `~/.claude/`·`~/.gemini/` 즉시 반영 후 `main` 푸시 완료.
- **실차 핫픽스 전용 워크트리·PR #24 정리:**
  - 메인 워크스페이스에서 병행 진행 중이던 전체화면 오버레이 설계(PR #22)와 충돌하지 않도록 `origin/main`(`8f9f4f8`) 기반 전용 Orca 워크트리(`hotfix/live-test-2026-11-21`)에 순수 실차 핫픽스 23개 파일만 이식.
  - `origin/main`의 정식 `tools.py`(`SCRUM-174`)·`cli.py`(`whitebox_minimap`/`whitebox_vision`)와 `test_config.py`(`SCRUM-175`)를 100% 보존한 위에 자동 녹화(`--record-dir data/recordings`)·전역 핫키(`_GlobalHotkeyPoller`)·실측 `steer_sign=-1.0`만 정밀 병합하고, `.gitignore`에 `data/diagnostics/`·`*.pt` 추가.
  - 핫픽스 관련 10개 단위 테스트 스위트 **214 passed in 13.25s** 확인(실행 중인 ETS2 공유 메모리 간섭 2건 외 전체 통과).
  - Draft PR #24 생성 후 `qwen-review.py` 1차 실행에서 `too_large` 발생 → 원인 조사 결과 `uv run` 실행 시 자동 갱신된 `uv.lock`(250KB)이 `git add -A`에 섞였고, 집필 노트에 로컬 계정 절대 경로 1건이 남아 있었음 → `uv.lock` 원복 및 경로 마스킹(`~/orca/...`) 후 재검증 진행.

> 교훈: `uv run` 뒤에 무심코 `git add -A`를 치면 250KB짜리 `uv.lock`이 PR에 딸려 들어가 리뷰 도구 컨텍스트 한도를 터뜨릴 수 있다. 커밋·푸시 전 파일별 diff 크기와 개인 경로·시크릿 자동 스캔은 언제나 값진 보험이다.

## 19:06 ~ 20:03 (KST) — 남은 Jira 개발 일감 7건 3웨이브 병렬 위임 전원 1라운드 통과 및 워크플로우 토큰 절감 개선

- **사용자 지시:**
  > "지라 워크플로우로 전체 진행해주고, 동시에 진행가능한건 병렬로 주니어에게 위임해줘"
  > "근데 위임 했는데도 생각보다 토큰 많이 쓰네. 어떤 지점에서 사용량이 많은거야?"
  > "이거 3개 지라 워크플로우에 반영하고 다음 웨이브부터 적용해봐"
- **토큰 절감 워크플로우 개선 (`golony-agent-support` `567191e` → `59fd9a7` → `ef40e0a`):**
  - `qwen-review.py`, `ds-loop.py`, `~/.claude/bin/*` 파이썬 스크립트 전체 상시 허용 추가.
  - `claude/bin/ds-worktree.py` 신규 제작: `prepare`(fetch·워크트리 생성·브랜치명 변경·`.ds-tmp/` 제외·`ds-watch` 탭 열기)와 `finish`(PR ready·머지·워크트리 삭제·fetch)를 각각 1턴·1줄 JSON으로 축약.
  - `make-prompt.py` 개선: `### 작업 N:` 외 `### Task N:`, 복수 `tasks`, 스펙/계획 생략 일감 모두 지원.
  - `jira-workflow`/`deepseek-delegate` 스킬에 단계 전환 시 `/compact` 권장 및 `ds-worktree.py`/`make-prompt.py` 사용 규칙 반영.
- **3웨이브 병렬 실행 결과 (7전 7승 전원 1라운드 Qwen QA `pass`, 총합 `$0.6520`):**
  - **Wave 1:** `SCRUM-176`([PR #25](https://github.com/golony6449/ets-autonomous-driving/pull/25), `$0.0411`), `SCRUM-177`([PR #26](https://github.com/golony6449/ets-autonomous-driving/pull/26), `$0.0471`), `SCRUM-180`([PR #27](https://github.com/golony6449/ets-autonomous-driving/pull/27), `$0.1390`)
  - **Wave 2:** `SCRUM-179`([PR #29](https://github.com/golony6449/ets-autonomous-driving/pull/29), `$0.1135`, 전체 394 passed), `SCRUM-181`([PR #28](https://github.com/golony6449/ets-autonomous-driving/pull/28), `$0.1627`, 전체 436 passed)
  - **Wave 3 (새 `ds-worktree.py` + `make-prompt.py` 실전 적용):** `SCRUM-178`([PR #30](https://github.com/golony6449/ets-autonomous-driving/pull/30), `$0.0784`, 전체 478 passed), `SCRUM-182`([PR #31](https://github.com/golony6449/ets-autonomous-driving/pull/31), `$0.0703`, 전체 444 passed)
  - DeepSeek 잔액 실측: 시작 `$8.20` → 종료 `$7.83` (실차감 `$0.37`, 실행 합계 `$0.3803`; Qwen QA 합계 `$0.2717`).
  - 로컬 `main` fast-forward 완료(`9db1b4d..4e7380b`, 28개 파일 +6,436/-116줄, 충돌 0건).
  - 남은 일감: `SCRUM-183` (`ask-from-agent`, 사용자 ETS2 전체화면 오버레이 실기 확인) 선행 모두 해소.

> 책 소재: 7개 기능·버그를 파일 충돌 없는 3웨이브로 쪼개 주니어(DeepSeek)에게 병렬 위임했더니 55분 만에 7전 7승 1라운드 통과, 총 API 비용 단 65센트($0.65)에 6,400줄 이상의 코드와 테스트가 깔끔하게 `main`에 안착했다. 반면 메인 세션 토큰은 6~8턴씩 쪼개진 워크트리 준비·정리 JSON에서 가장 많이 새고 있었고, 이를 파이썬 1-턴 래퍼(`ds-worktree.py`)로 묶어 Wave 3부터 즉시 실증해 냈다.



















## 통합 콘솔 메뉴 6·7 플래그 오류 수정

- **증상:** `tools.py` 메뉴 [6] 로컬 단독 실행이 `ets-ad: error: unrecognized arguments: --use-hardware-gamepad`로 종료 코드 2를 내며 바로 끝났다. 메뉴 [7] 브릿지도 같은 원인이었다.
- **원인:** CLI(`cli.py`의 `build_parser`·`build_bridge_parser`)의 실제 플래그는 `--hardware-gamepad`인데, Phase 1B 설계 문서 메뉴 예시에 `--use-hardware-gamepad`로 잘못 적혔고 그 이름이 `tools.py`, 테스트 기대값, `cli.py` 사용 예시 docstring까지 그대로 퍼졌다. 테스트는 `cli.main`을 가짜로 바꿔 인자 목록만 비교했기 때문에 실제 파서를 거치지 않아 오류를 잡지 못했다.
- **수정:** 모든 곳을 `--hardware-gamepad`로 맞췄다(CLI 별칭 추가 대신 콘솔을 CLI에 맞춤). 메뉴 [6]·[7]이 넘기는 인자를 실제 `build_parser()`/`build_bridge_parser()`로 파싱하는 회귀 테스트 `test_console_run_argv_is_accepted_by_real_cli_parsers`를 추가했다.
- **검증:** `tests/test_tools_console_ui.py`·`tests/test_web_dashboard.py` 53 passed. 전체는 481 passed, 2 failed이며, 실패 2건(`test_scs_shm_reader_fallback_when_unavailable`, `test_run_integration_check_without_game_bin_is_safe`)은 이 수정 전에도 같이 나는 것으로, ETS2 실행 중이라 공유 메모리·게임 경로가 실제로 잡히는 환경 탓으로 보인다.

> 책 소재: 가짜 `main`으로 인자 목록만 비교하는 테스트는 "보낸 쪽과 받는 쪽이 같은 오타를 공유"하면 영원히 초록불이다. 설계 문서의 한 줄 오타가 코드·테스트·docstring으로 복제됐고, 실차 콘솔에서 첫 실행에 바로 드러났다. 경계 테스트는 받는 쪽 실제 파서를 한 번은 거쳐야 한다.

## 메뉴 6 실차 주행: 차선 미인식과 반복 유턴 원인 분석

- **증상:** 메뉴 6(whitebox, 하드웨어 패드)으로 주행하자 차선을 인식하지 못하고 계속 유턴을 시도했다.
- **녹화 근거(`data/recordings/20261121_201829_056969`, 538프레임):**
  - 대부분의 프레임에서 차선 신뢰도 `0.00` → 조향이 미니맵 경로 폴백으로 넘어감.
  - 미니맵 `upcoming_curvature`가 `-2 ~ -16`(중앙값 `-0.12`, 최대 `+24`). 판단 계층은 이를 1/m로 표시하고 Stanley `κ·L`(휠베이스 3.6m)에 그대로 넣어 `-7rad` 이상 → `max_steer_rad=0.6`에서 조향 포화. 제어 명령 `-1.0`, 텔레메트리 조향 입력 `+1.00`(좌측 끝)이 계속 유지됨.
  - 상태는 대부분 `ROUNDABOUT`(로터리 오검출), 회전 의도 `TURN_LEFT`.
- **원인 1(유턴의 직접 원인):** `nav_minimap.py`의 곡률은 미니맵 정규화 좌표(0~1)에서 맞춘 2차 계수(`2a`)로 단위가 없는데(`perception/models.py`도 "정규화 좌표계 기준"으로 명시), `whitebox_planner.py`의 미니맵 폴백·교차로 회전 분기는 이를 1/m로 쓴다. 회전 지점까지의 거리를 고려하지 않아 "앞 교차로 좌회전"을 즉시 최대 좌조향으로 실행한다. 미니맵 `meters_per_pixel=0.06`도 미니맵 전체를 약 17m로 보는 값이라 실제와 맞지 않는다.
- **원인 2(차선 미인식):** 운전석 시점 도로 ROI(세로 `0.40~0.60`, y 288~432)에 가로등, 지평선 근처 조명, 나무, 오른쪽 HUD 금액 패널이 들어가고 실제 차선(y 약 340~500)은 위쪽만 걸린다. BEV 사다리꼴은 `lane.py`에 고정돼 있어 시점 캘리브레이션이 반영되지 않는다. 실시간 캡처(밤, 정지선 앞 화살표 노면 표시, 왼쪽 차선 없음)에서는 "차선 피팅 잔차 과다(23.6px > 20px)"로 탈락했고, ROI 세로 범위를 0.40~0.70으로 바꿔 시험해도 회복되지 않았다. 검출 실패 시 매 프레임 `reset()`하므로 직전 차선을 유지하지 못하고, 녹화에 이미지가 없어 야간 인식률을 오프라인으로 측정할 수 없다.
- **조치:** 일감 묶음으로 등록했다(계획 라벨 `plan-lane-nav-fallback`, 에픽 SCRUM-155). 미니맵 곡률 단위·안전 상한·로터리 오검출, 시점 기하 캘리브레이션, 야간 평가 데이터, 차선 일시 유지, 노면 표시·광원 필터, 도로 경계 기준선, 실기 재검증으로 나눴다.

> 책 소재: 인식 계층의 "정규화 좌표 곡률"이 판단 계층에서 "1/m 곡률"로 읽히는 순간, 앞 교차로의 좌회전 예고가 지금 당장 핸들을 끝까지 꺾으라는 명령이 됐다. 단위가 바뀌는 경계에 단위 이름을 박아 두지 않으면, 모든 단계가 각자 옳게 동작하면서 트럭은 유턴한다.

## 20:20 ~ 20:45 (KST) — 원인 분석을 일감 그래프로: `plan-lane-nav-fallback` 등록과 야간 차선 질문

- 사용자: `"일감으로 등록해줘"` → 원인 분석 결과를 일감 10개(SCRUM-184~193)와 차단 링크 10개로 등록했다(에픽 SCRUM-155, 계획 라벨 `plan-lane-nav-fallback`).
- 사용자: `"밤 시간에 차선 인식률 개선을 위해서는 어떤 작업이 필요해?"` → 야간 차선 개선을 "측정 데이터(이미지 녹화) → 시점 기하 → 일시 유지 → 노면 표시·광원 필터 → 도로 경계 폴백" 순서로 설명했다. 사용자가 `"T6을 나눠서 다시 보여줘"`라고 해 한 덩어리였던 차선 개선을 189(녹화·측정), 190(일시 유지), 191(노면 표시·광원), 192(도로 경계)로 쪼개 다시 보여 주고 `"승인"`을 받았다.

> 교훈: "인식률을 높이자"는 측정 수단이 없으면 일감이 될 수 없다. 녹화에 이미지를 남기는 일감을 맨 앞에 둬야 뒤 일감의 효과를 숫자로 말할 수 있다.

## 20:50 ~ 21:05 (KST) — agy 한도 소진, Claude가 직접 오케스트레이션: 1차 묶음(184·190)

- 사용자: `"지금 agy 한도가 다 됬어. 이 상황에서는 클로드가 직접 오케스트레이션 하자."` → 원래 규칙(Claude는 설계만, 실행 PL은 agy)에 "agy 한도 소진 시 Claude가 직접" 예외를 메모리에 남기고 진행했다.
- 1차 묶음은 서로 파일이 겹치지 않는 SCRUM-184(미니맵 곡률을 1/m로 환산, `±0.08` 상한)와 SCRUM-190(차선 검출 실패 시 직전 차선을 15프레임 동안 신뢰도를 깎으며 유지)을 동시에 DeepSeek에 맡겼다.
  - 계획에 "실제 표본" 절을 두고 녹화의 정규화 곡률 네 값(`-2.017 → -0.05576`, `-0.12 → -0.003317`, `-16.296 → -0.08`, `+24.488 → +0.08`)을 기대값으로 적었다.
  - 둘 다 Qwen 검토 1회차 통과. 비용(DeepSeek+Qwen): 190 $0.0475, 184 $0.0503.

## 21:00 ~ 21:15 (KST) — 워크플로우에 "스스로 압축" 넣기와 첫 실기 시험 실패

- 사용자: `"jira 워크플로우에 compact 수행도 넣자."` → `/compact`는 사용자가 치는 CLI 명령이라 모델이 대화 중에 직접 실행할 수 없다. 방법을 물었고 사용자는 "Orca로 자기 터미널에 자동 입력"을 골랐다.
- `self-compact.py`를 만들었다: 턴의 마지막 동작으로 백그라운드에서 띄우면, 자기 Orca 터미널이 유휴가 될 때까지 기다렸다가 그 터미널에 `/compact <보존 메모>`를 입력한다.
- **실기 2회 모두 실패.** 1회차는 사용자가 직접 `/compact`를 친 것과 겹쳐 유휴 재확인에 실패했고, 그 뒤 30분 대기 중 다음 턴이 끝나면 **낡은 메모로** 압축할 위험이 있어 멈췄다. 대기 기본값을 5분으로 줄였다. 2회차도 보내지 못했고 원인은 확인하지 못했다. 지금은 쓰지 않는다.

> 책 소재: 자기 자신에게 키 입력을 보내는 에이전트는 "언제 내 턴이 끝났는가"를 밖에서 추측해야 한다. 사람이 그 사이에 한 번만 끼어들어도 타이밍이 어긋나고, 늦게 도착한 메모는 이미 지난 상황을 요약한다.

## 21:05 ~ 21:20 (KST) — `"개발은 주니어가 하는데도 사용량이 많아"`: 토큰은 어디서 새는가

- 사용자: `"지금 토큰 사용량 증가가 엄청난데, 어느지점에서 많이 소모되는거야? 개발은 주니어가 하는데도 사용량이 많아."`
- 설명한 요지: 도구를 한 번 부를 때마다 **대화 전체가 다시 모델에 들어간다.** 이 세션에는 디버깅 이력·캡처 이미지·스킬 본문·일감 본문이 쌓여 있었고, 그 위에서 Jira 전환·댓글·링크·머지 같은 작은 호출을 40번 넘게 했다. 비용은 대략 "호출 횟수 × 맥락 크기 × 모델 가중치"다. DeepSeek(구현)과 Qwen(검토)은 API 과금이라 Claude 한도와 무관하다.
- 사용자: `"2~4번도 워크플로우에 넣어줘"` → 반영한 것:
  - **오케스트레이션 세션 나누기:** 긴 설계 세션에서 바로 실행을 이어 가지 않고 메모 파일을 남겨 새 세션에서 시작한다.
  - **Jira 호출 줄이기:** 스프린트는 일감을 만들 때 넣는다. 실행 중 발견: `executeWrite`에 `responseFields: ["key"]`를 붙이면 일감 본문 전체를 돌려주던 응답이 키 하나로 줄어든다.
  - **결과 한 줄 읽기:** `ds-brief.py`를 만들어 ds-loop·Qwen 결과 JSON(DeepSeek 보고서 원문 포함)을 판단에 필요한 필드만 남긴 한 줄로 읽는다.

## 21:20 ~ 21:35 (KST) — `"차라리 소넷에 개발 시키는게"`: 설계 PL(Opus)과 실행 PL(Sonnet) 나누기

- 사용자: `"이럴꺼면 차라리 소넷에 개발 시키는게 토탈 토큰은 적게 쓰는거 아닐까?"`
- 답: 구현을 Sonnet으로 옮기면 오히려 늘 가능성이 크다. Sonnet 구현 토큰은 전부 Claude 한도에서 나가고, DeepSeek은 일감당 약 $0.05로 한도 밖이다. 줄일 곳은 구현이 아니라 **PL(Opus 세션)**이다.
- 사용자: `"오.. 오케스트레이션을 고성능으로 해야한다고 생각했어."` → 오케스트레이션 안에도 두 종류가 섞여 있다고 설명했다.
  - 판단이 필요한 일(원인 분석, 일감 쪼개기, DeepSeek용 계획 작성, 검토 판정·충돌·크리티컬 판단) → Opus
  - 절차만 따르는 일(워크트리, 프롬프트 생성, ds-loop, 결과 읽기, Jira, 머지) → Sonnet. 스크립트와 Qwen 검토·테스트가 이미 지켜 준다.
- 워크플로우에 "설계 PL과 실행 PL 나누기"를 넣었다. 실행 PL은 계획을 고치지 않고, 판단이 필요하면 `blocked`를 붙이고 멈춘다. 새 세션은 `orca agent launch --agent claude --model sonnet`으로 띄운다.
- 사용자: `"그리고 지금 계획단계를 소넷으로 넘기는 거 적용된 워크플로우지?"` → 아니다, 계획까지 Opus이고 실행만 Sonnet이다.
- 사용자: `"근데 나 하나더. 저정도를 소넷에 넘기는 것만해도 절약효과가 충분해? 어떤 부분에서 효율화가 되는건지 설명해줄래?"` → 실행 단계는 호출이 가장 많은 구간이라 "더 싼 모델 × 더 작은 맥락"이 함께 줄어든다. 그러나 설계 세션 자체(분석·계획, 길어진 맥락)는 그대로라, 설계도 회차마다 새 세션에서 하고 반복 분석은 스크립트로 만드는 것이 다음 단계다.
- 사용자: `"근데 저 호출횟수 부분도, 횟수는 동일하지만 소넷이 저렴하니까 총 비용은 줄어드는거구나."` → 맞다. 여기에 맥락 크기 감소가 곱해진다.

> 교훈: "고성능 모델이 지휘해야 한다"는 직관은 반만 맞다. 지휘 중 판단하는 순간은 짧고, 시간 대부분은 정해진 절차를 반복한다. 비싼 모델은 판단에만 부르고, 반복은 싼 모델의 작은 맥락으로 돌린다.

## 21:10 ~ 21:28 (KST) — 2차 묶음(185·187)과 첫 머지 충돌

- 185와 186은 둘 다 `nav_minimap.py`를 고쳐야 해서 동시에 못 돌린다. 2차 묶음은 185(미니맵 단독 조향 상한, 회전 지점이 30m 안일 때만 회전 곡률 반영)와 187(도로 ROI에서 소실점 위·오른쪽 HUD 가리기, BEV 사다리꼴을 시점 프리셋에서 만들기)로 묶었다. 겹치는 `config.py`·`default.toml`은 서로 다른 절만 고치게 지시했다.
- 둘 다 Qwen 1회차 통과. 비용: 187 $0.11, 185 $0.13.
- 187이 먼저 머지되자 185 PR이 `tests/test_config.py`에서 충돌했다(두 일감이 같은 자리에 테스트를 추가). Claude가 두 쪽 테스트를 모두 남기도록 풀고, 겹친 테스트 파일 5개(165건)를 돌려 통과를 확인한 뒤 머지했다.

## 21:20 ~ 21:28 (KST) — SCRUM-186: 실제 미니맵 캡처가 뒤집은 원인 가설

- 일감 본문은 "로터리 판정 기준을 1/m 곡률에 맞게 다시 잡기"였다. 계획을 쓰기 전에 남아 있던 실차 미니맵 캡처(282x202)를 현재 추출기로 돌려 행별 마스크를 찍어 봤다.
- 드러난 사실:
  - ETS2 미니맵은 위에서 내려다본 지도가 아니라 **뒤쪽 위에서 비스듬히 본 원근 화면**이다.
  - 자차 화살표는 아래 끝이 아니라 `(0.60, 0.61)`에 있고, 그 아래 주황 띠는 자차 **뒤쪽** 경로다.
  - 왼쪽 위 HUD의 빨간 속도제한 "50" 표지가 경로 마스크에 **고리 모양**으로 남아 중간·상단 구간 중심을 끌어당겼다.
  - 구간 중심이 `136.0 → 156.7 → 138.2`로 오른쪽으로 갔다가 돌아와 "편차 반전 = 로터리" 조건을 만족했다. 회전 지점 거리가 1.5m로 나온 것도 뒤쪽 경로를 기준으로 쟀기 때문이다.
- 그래서 계획을 "판정식 수정"이 아니라 "고리 표지 제거 + 자차 기준점"으로 바꿨다. 캡처는 커밋하지 않고 DeepSeek 워크트리의 `.ds-tmp/`에 넣어 직접 확인하게 했다.
- 같은 회차에 SCRUM-189(도로·미니맵 ROI 이미지 2Hz 녹화, 리플레이로 차선 검출률·탈락 사유 집계, 메뉴 6에서 자동 녹화) 계획을 썼다. 191·192는 녹화 이미지를 본 뒤로 미뤘다.
- 메모 파일(`.handoff/…-orchestrate.md`)을 남기고 Sonnet 실행 세션을 띄워 186·189를 넘겼다. 실행 세션이 둘 다 머지했다(PR #40, #41).

> 책 소재: 일감 제목은 증상을 보고 쓴 가설이다. "로터리 판정 기준이 틀렸다"고 적었지만, 실제 픽셀을 찍어 보니 판정식은 멀쩡했고 입력에 속도 표지와 지나온 길이 섞여 있었다. 계획 직전에 실제 표본을 한 번 보는 비용이 가장 싸다.

## 21:48 ~ 22:02 (KST) — 야간 실차 녹화 분석: 유턴은 사라졌지만 차선 검출률 0.4%

- 사용자: `"실행해봤는데 녹화 확인해볼래?"` → 세션 `20261121_214800_218969`(2분 37초, 판단 기록 546프레임, ROI 이미지 461장).
- 사용자: `"이번에는 내가 컨트롤해서 유턴은 확인 못했어. 66KM는 내가 운전한거야."` → 판단 출력(목표 곡률 상한 0.03 안, 로터리 오판 0건)은 정상이지만, 자율 조향으로 유턴이 사라졌는지는 **확인되지 않은 것**으로 정정했다. 66km/h는 사용자 운전이라 문제 목록에서 뺐다.
- 리플레이 차선 검출률 **0.4%(1/239)**. 탈락: 좌우 기하 불일치 110, 폭 비정상 82, 잔차 과다 46. 대표 이미지를 보니 야간에도 차선(가운데 점선, 오른쪽 실선)은 선명했다. 원인은 화살표·조명이 아니라 **차선을 찾는 영역**이었다.
  - 사다리꼴(폭 10~90%)에 왼쪽 운전석 창문·필러와 오른쪽 가드레일이 들어간다.
  - 격자를 그려 잰 소실점은 ROI 기준 `(690, 24)`인데, 사다리꼴은 가운데(640) 기준이고 위·아래 폭 비율도 원근과 맞지 않았다. 그래서 BEV로 펴도 평행한 차선이 평행하게 나오지 않아 "기하 불일치"가 가장 많았다.
  - 소실점을 지나는 사다리꼴 후보 24개를 녹화 게임 화면 211장으로 돌린 결과, 최고 **25.6%**(소실점 x 670, 아래 반폭 200px, 위 y 0.40). 기존 사다리꼴은 0.5%.
- 새로 드러난 문제:
  - 제어 주기 약 3.8Hz(프레임 간격 중앙값 0.27초, 목표 30Hz). 로그에 YOLO `'half' is deprecated` 경고가 반복.
  - 433번 이후 이미지는 게임이 아니라 데스크톱 터미널 화면. 게임이 앞에 없어도 자율주행이 판단을 계속했다.
  - 고속도로에서 미니맵 우회전 판정 222프레임, 회전 지점 거리는 늘 약 15m. 원근 미니맵을 1px=0.25m로 일정하게 잰 탓에 완만한 곡선을 "15m 앞 교차로 회전"으로 봤다.
- 사용자 `"승인"`으로 일감을 정리했다: SCRUM-191을 "운전석 시점 차선 탐색 영역을 실제 차선에 맞추기"로 바꿨고(화살표·조명 대응은 주원인이 아니어서 뺌), SCRUM-195(제어 주기), SCRUM-196(게임 창 비전경 시 자동 일시정지), SCRUM-197(원근 미니맵 거리·회전 의도 보정)을 새로 만들었다. 실차 재확인 SCRUM-193에 선행 4개와 "개입 없이 유턴 없음" 확인 항목을 더했다.

> 교훈: 측정 도구(189)를 먼저 만든 덕에 "밤이라 안 보인다"는 추측이 "보이는데 엉뚱한 곳을 보고 있다"는 사실로 바뀌었다. 0.4%에서 25.6%로 오른 첫 실험은 코드가 아니라 사다리꼴 네 점의 좌표였다.
