# 2026-11-19 — Phase 1-A 실차 구동·제어 보강 설계(`brainstorming`) 및 `TakeoverMonitor` Q&A

*(선행 기록인 가상 패드/휠 선택, `ViGEmBus` 설치, 옵션 A + 접근법 1 초안 및 `SCRUM-155` 에픽 8건 완료 기록은 `epic/SCRUM-155` 브랜치의 [2026-11-19-superpowers-design-review.md](file:///D:/Programming/ets-autonomous-driving/docs/journal/2026-11-19-superpowers-design-review.md)에 이어진다.)*

## 21:30 ~ 21:34 (KST) — Builder Check 3건 검증 반영, 변속기 설정 확정(`1로 하자`) 및 `TakeoverMonitor` 질의응답

### 1. Builder Check(서브에이전트 구현자 검토)에서 건져 올린 3가지 핵심 쟁점
신규 서브에이전트(`research`)가 설계서 초안([2026-11-19-ets2-live-actuation-hardening-design.md](file:///D:/Programming/ets-autonomous-driving/docs/superpowers/specs/2026-11-19-ets2-live-actuation-hardening-design.md))과 `SCRUM-163` 코드, 실제 프로필 `controls.sii`를 대조해 구현 전 반드시 풀어야 할 3가지 쟁점을 짚어냈다.

1. **`TakeoverMonitor` 오탐 위험 (`Agent Call`로 해결):**
   - `DriverTakeoverMonitor`는 `abs(ego.user_steering - last_command.steering) >= 0.15`가 `0.15초` 이상 지속되면 수동 전환(Kill Switch)을 건다.
   - 만약 `steer_sign = -1.0`이나 `steer_scale != 1.0` 보정 전의 논리 조향값을 비교하면, 자율주행이 핸들을 돌리는 순간 0.15초 만에 Takeover 오탐이 발동하므로 **실제 패드로 나간 보정 조향값(`hw_steering`)**을 비교하도록 설계서에 명시했다.
2. **분산 관제(`VehicleBridgeRunner`)에서의 Auto-Start Guard 오작동 위험 (`Agent Call`로 해결):**
   - 홈서버 `Engine == "off"` 대기 상태나 통신 단절 시 노트북 로컬 폴백이 `target_speed_kmh = 80.0`을 내면서 트럭 파킹브레이크가 저절로 풀려 출발할 위험이 있었다.
   - `ServerDecisionPacket`에 `auto_actuation_allowed: bool`을 두어 **`Engine == "on"` 및 비수동 모드일 때만** 파킹브레이크 자동 해제 펄스를 허용하고, `Engine == "off"` 대기나 로컬 폴백 중에는 절대 해제하지 않도록 차단했다.
3. **ETS2 변속기 모드 (`c_stm_simple` 선택지 → 사용자 확인):**

   | 선택지 | 내용 | 장점 | 단점 / 트레이드오프 |
   |---|---|---|---|
   | **옵션 1** *(선택됨, `"1로 하자"`)* | **단순 자동변속기(`c_stm_simple 1.0`) 유지** | 현재 `controls.sii`(24행) 그대로 사용 가능, 엑셀만 밟으면 N→1단 자동 출발해 `mix drive` 바인딩·기어 펄스 불필요 | 수동/실제 자동처럼 정차 중 중립 대기·수동 후진 기어 전환 연습에는 제한적 |
   | **옵션 2** | **실제 자동변속기(`c_stm_simple 0.0`) 전환** | 실제 트럭 자동변속기(D/N/R)에 가까운 기어 상태 제어 가능 | `mix drive` / `mix geardrive` 추가 바인딩 및 `ego.gear == 0` 시 D단 펄스·후진 처리까지 추가 필요 |

- **사용자 결정:** `"1로 하자."` (단순 자동변속기 `c_stm_simple 1.0` 유지)
- 이에 따라 설계서에서 `mix drive` / `mix gearup` 패치 및 기어 D 펄스 로직을 제거하고, `mix parkingbrake` 해제 펄스와 `mix lblinker`/`rblinker` 토글 펄스만 깔끔하게 남기도록 최종 업데이트했다.

---

### 2. 질의응답: `"그리고 TakeoverMonitor가 뭐야?"`

- **사용자의 질문:**
  > "그리고 TakeoverMonitor가 뭐야?"
- **에이전트의 설명 요지 (`src/ets_ad/decision/takeover.py` 기준):**
  - `DriverTakeoverMonitor`는 실제 자율주행차의 **'운전자 개입 감지(Override / Takeover)' 안전장치**다.
  - 주행 중 트럭이 이상하게 꺾거나 위험해 보여서 운전자가 **책상 위 MOZA 레이싱 휠을 직접 돌리거나 실제 브레이크 페달을 밟으면**, 텔레메트리에서 읽은 실제 게임 입력(`ego.user_steering`, `ego.user_brake`)과 직전 가상 패드 명령(`last_command`)의 차이를 감시한다.
  - 그 차이가 **`0.15` (15%) 이상**인 상태가 **`0.15초` 이상** 지속되면(1프레임 노이즈 스파이크는 무시), 즉시 `emergency_release()`로 가상 패드 출력을 `0`으로 끄고 주행 상태를 `DrivingState.MANUAL` (`"운전자 핸들/페달 개입 감지 → 수동 운전 전환 (재개: F10)"`)로 래치해 운전자에게 운전대를 넘긴다. 다시 자율주행을 켜려면 `F10`으로 재개해야 한다.
  - 방금 빌더 리뷰어가 짚은 문제도 바로 이것 때문이었다: 가상 패드 조향 부호(`steer_sign = -1.0`)를 뒤집어 보냈는데 `TakeoverMonitor`가 뒤집기 전 숫자와 `ego.user_steering`을 비교하면, 프로그램이 자기가 돌린 핸들을 보고 *"어? 사람이 핸들을 반대로 꺾었네!"*라고 착각해 0.15초 만에 자율주행을 꺼 버릴 수 있었다.

> 교훈: 안전장치(`DriverTakeoverMonitor`)는 반드시 "소프트웨어가 원한 이상적인 값"이 아니라 "실제 액추에이터가 게임/차량에 인가한 물리 값"을 기준으로 비교해야 오탐(False Positive)으로 인한 불시 해제를 막을 수 있다.

## 21:40 ~ 21:42 (KST) — Phase 1-A 실차 구동 보강 구현 계획서 작성 (`writing-plans`)

- **사용자 승인:** `"응 해줘"` → `superpowers:writing-plans` 스킬을 사용해 6개 TDD 태스크로 구성된 구현 계획서를 작성했다.
- **작성 파일:** [2026-11-19-ets2-live-actuation-hardening-plan.md](file:///D:/Programming/ets-autonomous-driving/docs/superpowers/plans/2026-11-19-ets2-live-actuation-hardening-plan.md)
  - **Task 1:** `ControlConfig` 보정 필드(`steer_sign`, `steer_scale`, `trailer_offtrack_gain`, `max_trailer_offtrack_m`) 및 `EgoState.park_brake` 텔레메트리 연결
  - **Task 2:** 실제 ETS2 v1.62 `controls.sii` 문법(`mix steering`, `memory(...)`, `lblinker`/`rblinker`/`parkingbrake`) 대응 무손실·멱등 패처 보강
  - **Task 3:** `VirtualGamepadActuator` 트리거 정렬(RT=스로틀, LT=브레이크), 조향 보정 및 `DiscreteButtonPulser` 단발 토글 펄스 구현
  - **Task 4:** 세미트레일러 내륜차 보정(`compute_trailer_offtrack_offset_m` 및 `WhiteboxRulePlanner` 연동)
  - **Task 5:** `pipeline.py` + 분산 관제(`protocol.py`, `server_hub.py`, `vehicle_bridge.py`) Takeover 오탐 방지 및 `Engine OFF`/폴백 시 Auto-Start Guard 차단
  - **Task 6:** 실차 10초 패드·텔레메트리 자동 검증 도구(`tools/verify_gamepad_ets2.py`) 구현
- **계획 작성 중 코드 대조를 통해 잡은 핵심 디테일:**
  1. `perception/models.py` 부호 규약(`lateral_offset_m > 0`: 차선 중심이 자차 오른쪽, `curvature > 0`: 우곡선)을 검산해, 우곡선에서 코너 바깥쪽(왼쪽)으로 여유를 두려면 `steering_offset = lane.lateral_offset_m - offtrack_shift` 방향이어야 함을 수학적으로 확정했다.
  2. `TakeoverMonitor` 비교 명령을 만들 때 조향은 `applied.steering`(보정 반영)을 쓰되 페달은 데드존 보상 왜곡을 피하기 위해 `raw_command.brake`를 유지하는 조합(`replace(raw_command, steering=applied.steering)`)으로 두 마리 토끼를 모두 잡았다.

> 교훈: 구현 계획 단계에서 실제 코드의 좌표계 부호와 기존 주석("데드존 보상 전 페달 비교")까지 한 번 더 검산하면, 구현 중 부호가 뒤집히거나 기존 설계 의도가 깨지는 실수를 사전에 막을 수 있다.

## 21:44 (KST) — 사용자 반응: `"오.. 처음알았어. 저 안전장치를 TakeoverMonitor라고 하는구나."`

- **사용자의 감탄:**
  > "오.. 처음알았어. 저 안전장치를 TakeoverMonitor라고 하는구나."
- **배경 메모:**
  - 자율주행 공학에서 운전자가 시스템으로부터 운전 제어권을 넘겨받거나 되찾아오는 일을 **테이크오버(Takeover / Driver Override)**라고 부른다. (레벨 3 자율주행에서 차가 사람에게 *"이제 잡아주세요"*라고 요청하는 건 **TOR: Takeover Request**, 반대로 위급할 때 사람이 핸들이나 브레이크를 밟아 제어권을 강제로 빼앗는 건 **Driver-initiated Takeover / Override**에 해당한다.)
  - 우리 프로젝트에서는 MOZA 물리 휠(`device joy`)과 가상 Xbox 패드(`device joy2`)가 공존하므로, 텔레메트리(`user_steering`, `user_brake`)로 사람이 핸들을 잡았는지를 상시 감시하는 모듈 이름을 그대로 `DriverTakeoverMonitor`로 지었다.

> 책 소재: "오.. 처음알았어. 저 안전장치를 TakeoverMonitor라고 하는구나." — 게임용 가상 패드와 실제 레이싱 휠이 공존하는 환경에서, 실제 자율주행차의 '제어권 이양(Takeover)' 개념과 용어가 자연스럽게 연결된 순간.

## 21:45 (KST) — Jira 일감 그래프(`jira-plan`) 설계 및 등록 전 승인 요청

- **사용자 요청:** `"아니 직접 하지말고 티켓만 등록해줘. 선후관계 설정 포함해서"`
- **Jira 현황 확인:** 기존 레포 에픽 `SCRUM-155` (`ets-autonomous-driving`)가 현재 `완료` 상태이며, 계획 라벨 `plan-ets2-live-actuation-hardening`의 중복 일감은 없음을 확인했다.
- **일감 쪼개기 및 의존성 그래프(DAG) 설계 (PR 단위 5건):**
  - `T1` (루트): `ControlConfig` 보정 필드, `EgoState.park_brake` 연결 및 세미트레일러 내륜차 보정 구현
  - `T2` (루트, 병렬): 실제 ETS2 v1.62 `controls.sii` 문법(`mix steering`·깜빡이·파킹브레이크) 무손실 공존 패처 보강
  - `T3` (`T1 → T3`): 가상 패드 트리거 정합성(RT/LT), 조향 보정 및 폐루프 단발 토글(`DiscreteButtonPulser`) 구현
  - `T4` (`T3 → T4`): 로컬 파이프라인·분산 관제 `TakeoverMonitor` 오탐 방지 및 `Engine OFF`/폴백 시 Auto-Start Guard 안전 차단 통합
  - `T5` (`T2 → T5`, `T3 → T5`): 실차 10초 가상 패드·텔레메트리 자동 검증 도구(`tools/verify_gamepad_ets2.py`) 구현
- `jira-plan` 4장 규칙에 따라 등록 전 일감 표·에픽(`SCRUM-155`)·선후관계 그래프를 사용자에게 제시하고 승인을 요청했다.

## 21:47 (KST) — Phase 1-A 실차 구동 보강 Jira 일감 5건(`SCRUM-164`~`SCRUM-168`) 및 `Blocks` 링크 등록 완료

- **사용자 승인:** `"응 해줘"`
- **Jira 등록 결과 (`golony.atlassian.net`, 에픽 `SCRUM-155`, 계획 라벨 `plan-ets2-live-actuation-hardening`):**
  - `T1` → **`SCRUM-164`**: ControlConfig 조향·트레일러 보정 필드, EgoState.park_brake 연결 및 세미트레일러 내륜차 보정 구현
  - `T2` → **`SCRUM-165`**: 실제 ETS2 v1.62 controls.sii 문법(mix steering·깜빡이·파킹브레이크) 무손실 공존 패처 보강
  - `T3` → **`SCRUM-166`**: 가상 패드 트리거 정합성(RT/LT), 조향 부호·스케일 보정 및 폐루프 단발 토글(DiscreteButtonPulser) 구현
  - `T4` → **`SCRUM-167`**: 로컬 파이프라인·분산 관제 TakeoverMonitor 오탐 방지 및 Engine OFF·폴백 시 Auto-Start Guard 차단 통합
  - `T5` → **`SCRUM-168`**: 실차 10초 가상 패드·텔레메트리 자동 검증 도구(tools/verify_gamepad_ets2.py) 구현
- **선후관계(`Blocks`) 링크:**
  - `SCRUM-164 → SCRUM-166` (첫 링크 `getJiraIssue`로 방향 검증 완료)
  - `SCRUM-166 → SCRUM-167`
  - `SCRUM-165 → SCRUM-168`
  - `SCRUM-166 → SCRUM-168`

> 책 소재: 설계(Phase 1-A) → 빌더 리뷰(3건 쟁점 포착) → 변속기·Takeover Q&A → 6단계 TDD 계획 수립 → 5건 PR 단위 Jira DAG 등록까지, 한 줄의 구현 코드도 직접 치기 전에 안전장치와 선후관계를 빈틈없이 세운 하루의 마무리.

## 21:48 (KST) — 질의응답: `"그리고 추가할만한 1단계 작업이 있을까?"`

- **사용자의 질문:**
  > "그리고 추가할만한 1단계 작업이 있을까?"
- **실제 구현 코드(`src/ets_ad/`, `tools/`) 대조를 통해 도출한 Phase 1(화이트박스) 추가 후보 5가지:**
  1. **전방 커브 곡률 기반 자동 감속 (`Curvature Speed Cap`):**
     - 현재 `WhiteboxRulePlanner`는 미니맵 교차로 회전(`INTERSECTION_TURN`, 30km/h)만 감속하고 일반 `CRUISE`에서는 급커브에서도 제한속도(80~90km/h)를 그대로 유지한다. 횡가속도 한계 공식($v_{\text{curve}} = \sqrt{a_{\text{lat,max}} / |\kappa|}$)으로 커브 진입 전 선제 감속 및 판단 근거(`curve_speed_cap_kmh`)를 추가하면 트럭 전복·차선 이탈을 막을 수 있다.
  2. **목적지 도착 자동 감속·정차(`ARRIVED`) 및 인게임 `config.cfg` 점검 보완:**
     - `EgoState.nav_distance_m`(`routeDistance`)이 이미 파싱되고 있으므로 `nav_distance_m < 40m` 구간에서 단계적 감속 → 정차 → 파킹브레이크 체결까지 수행하는 `ARRIVED` 상태를 추가할 수 있다(1차 목표인 "출발지 ~ 목적지 입구 무사 도착"의 완결). 또한 `setup_ets2_integration.py`의 winget ID(`ViGEm.ViGEmBus`) 최신화 및 `config.cfg`(`g_emergency_brake`, `g_cam_steering`) 자동 진단·패치도 함께 묶을 수 있다.
  3. **야간·터널·우천 대응 적응형 차선 검출 (`BEVLaneDetector`):**
     - 현재 `lane.py`는 고정 밝기 임계값(`175`)만 사용하여 야간/터널/비 오는 날 차선 검출 신뢰도가 급락할 수 있다. ROI 평균 조도 기반 CLAHE·동적 임계값(또는 Sobel 에지 결합) 보강.
  4. **카메라 시점(`interior` vs `bumper`)별 앞차 거리·TTC 역투영 파라미터 분리:**
     - 현재 `objects.py`는 단일 상수(`_DEFAULT_HORIZON_RATIO = 0.44`, `_DEFAULT_FOCAL_SCALE = 950.0`)만 쓰고 있어 `CameraViewPreset`에 시점별 `horizon_y_ratio`·`focal_scale`을 연결하고 `calibrate_ets2.py`에서 함께 튜닝하게 만드는 작업.
  5. **복합 도로 시나리오(옵션 B — 고속도로 분기/합류 차선 변경·로터리·톨게이트):**
     - 앞서 1-A 뒤로 분리해 둔 도로 주행 상태기계 확장.

> 교훈: 설계 문서만 보지 않고 실제 구현된 모듈(`lane.py`, `objects.py`, `whitebox_planner.py`)의 상수와 분기문을 들여다보면, 실주행에서 트럭이 어디서 넘어질지(급커브 무감속, 야간 차선 소실, 목적지 도착 미정차)가 코드 수준에서 선명하게 드러난다.

## 21:51 (KST) — Phase 1-B (1~5번 전체 확장) 설계(`brainstorming`) 시작 및 `config_local.cfg` 조사

- **사용자 결정:** `"응 1 ~ 5 전부 하자"` (① 급커브 곡률 감속, ② 목적지 도착 `ARRIVED` 및 설정 점검, ③ 야간·터널·우천 적응형 차선 검출, ④ 시점별 앞차 거리·TTC 보정, ⑤ 복합 도로 시나리오: 차선 변경·로터리·톨게이트 모두 포함)
- **추가 환경 조사(`Do recon` — `steam_profiles\626230313632\config_local.cfg`):**
  - 실제 프로필의 `config_local.cfg`를 확인한 결과 68행에 **`uset g_trans "3"`(H-쉬프터 수동 변속 모드)**, 58행에 `uset g_cam_steering "0"`, 61행에 `uset g_steer_anim_range "900"`이 설정되어 있음을 발견했다.
  - 즉 `controls.sii`의 `c_stm_simple 1.0`과 별개로, 프로필의 `g_trans`가 `"3"`(H-쉬프터)으로 되어 있으면 엑셀만 밟아서는 기어가 변속되지 않으므로 `setup_ets2_integration.py`에서 `config_local.cfg`의 `g_trans`(자율주행 시 `"0"` 단순 자동 또는 `"1"` 실제 자동 권고/패치)까지 함께 진단하도록 설계에 반영하기로 했다.
- **복합 도로 시나리오(5번) 구현 접근법 선택지 제시:**

  | 선택지 | 구현 방식 | 장점 | 단점 / 트레이드오프 |
  |---|---|---|---|
  | **접근법 1 (추천)** | **미니맵 기하학 + YOLO 3구역(좌·중앙·우 코리더) + 차선 신뢰도 결합 화이트박스 상태기계** (`LANE_CHANGE`, `ROUNDABOUT`, `TOLLGATE`, `ARRIVED`) | 추가 모델(VRAM 0MB) 없이 30Hz 동작, 국가별 디자인 차이에 무관, 100% 수치형 한국어 판단 근거(`DecisionFactor`) 생성 | 미니맵 기본 확대 배율 유지 필요, 톨게이트의 개별 열린 게이트(초록 화살표 vs 빨간 X) 식별은 미니맵만으로 불가 |
  | **접근법 2** | **국가별 로터리 표지판·톨게이트 하이패스 아이콘 전용 템플릿 매칭 / 커스텀 YOLO 파인튜닝** | 전방 카메라 표지판·게이트 신호만으로 직접 트리거 및 열린 게이트 조준 가능 | 단독 사용 시 국가별 디자인 편차에 취약하고, 별도 YOLO 재학습으로 가면 Phase 1 범위를 초과 |
  | **접근법 1+2 융합 (하이브리드)** | **접근법 1(미니맵 기하학 + YOLO 3코리더) + 접근법 2를 경량 OpenCV 도형·발광 검출기(`RoadStructureDetector`: 톨게이트 초록 `↓` vs 빨간 `X` 게이트 조준 + 로터리/양보 표지판 컨투어)로 결합** | VRAM 추가(0MB) 없이 미니맵의 거시적 경로 예고와 전방 카메라의 미시적 게이트/표지판 조준을 상호 보완 | 검출기와 상태기계에 융합 신뢰도 규칙 추가 필요 |

## 21:56 (KST) — 질의응답: `"둘다 할수도 있어?"` → 접근법 1+2 하이브리드 융합 제안

- **사용자의 질문:**
  > "둘다 할수도 있어?"
- **에이전트의 설명 요지:**
  - 두 방식을 결합하면 단독 방식의 약점을 서로 완벽하게 메워 준다.
  - 특히 **톨게이트**의 경우, 접근법 1(미니맵+차선 소실)만으로는 *"앞이 톨게이트다"*까지만 알 수 있고 여러 요금소 차로 중 어느 게이트가 열려 있는지(초록 화살표 `↓` vs 닫힌 빨간 `X`)는 알 수 없다. 여기에 접근법 2(전방 상단 캐노피의 초록 발광 게이트 검출 및 게이트 중심 오프셋 조준)를 결합하면 **미니맵으로 톨게이트 진입을 감지하고 → 전방 카메라로 초록 화살표 게이트를 조준해 통과**할 수 있다.
  - **로터리** 역시 미니맵의 원형 회전 궤적(접근법 1)과 전방 우측의 파란 원형 로터리 표지판/적색 역삼각형 양보 표지판 형상 검출(접근법 2)을 교차 검증하면 오검출 없이 감속·양보가 가능하다.
  - 또한 접근법 2를 무거운 추가 딥러닝 재학습 대신 **경량 OpenCV HSV 발광·도형 검출기(`RoadStructureDetector`)**로 구현하면 VRAM을 전혀 더 쓰지 않고도 두 방식을 모두 30Hz 안에 넣을 수 있다.

> 책 소재: "둘 다 할 수도 있어?"라는 질문 한마디로, '미니맵 기하학(숲을 보는 눈)'과 '전방 카메라 표지판·톨게이트 초록 화살표 검출(나무를 조준하는 눈)'을 하나로 합친 센서 퓨전 설계가 탄생한 순간.

## 21:59 (KST) — Phase 1-B (1~5번 전체 + 1+2 하이브리드 융합) 설계서 초안 작성 및 Builder Check 시작

- **작성 설계서:** [2026-11-19-ets2-phase1b-road-completion-design.md](file:///D:/Programming/ets-autonomous-driving/docs/superpowers/specs/2026-11-19-ets2-phase1b-road-completion-design.md)
  - §5.1 전방 급커브 곡률 기반 자동 감속 (`compute_curvature_speed_cap_kmh`)
  - §5.2 목적지 도착 자동 정차(`DrivingState.ARRIVED`, 내비 미설정 `0.0m` 오판 방지 포함) 및 `tools/setup_ets2_integration.py`(`ViGEm.ViGEmBus`·`config_local.cfg` `g_trans "0"`·`config.cfg` `g_emergency_brake "0"`) 진단·패치
  - §5.3 야간·터널·우천 적응형 차선 검출 (`mean_l < 110.0` 저조도 CLAHE + 동적 임계값 + Sobel 수직 에지 결합)
  - §5.4 카메라 시점(`interior` vs `bumper`)별 `horizon_y_ratio`·`focal_scale` 분리 및 `calibrate_ets2.py` 소실점 조정
  - §5.5 복합 도로 시나리오 **1+2 하이브리드 센서 퓨전**: YOLO 3코리더(`LEFT`/`EGO`/`RIGHT`) + `RoadStructureDetector`(톨게이트 초록 `↓` vs 빨간 `X` 게이트 오프셋 및 로터리/양보 표지판 검출) + 미니맵 분기·로터리 기하학 + `LANE_CHANGE`/`ROUNDABOUT`/`TOLLGATE` 상태기계
- 신규 서브에이전트(`research`)에게 **Builder Check** 리뷰를 위임했다.

## 22:00 (KST) — 사용자 추가 제안: `"아니면 스위칭도 괜찮아."` → 3종 전략(`minimap_corridor` / `vision_cue` / `hybrid_fusion`) 스위칭 및 Shadow 비교 반영

- **사용자의 제안:**
  > "아니면 스위칭도 괜찮아."
- **설계 반영:**
  - 1번(`minimap_corridor`: 미니맵+YOLO 코리더 단독), 2번(`vision_cue`: 전방 카메라 표지판·톨게이트 초록 화살표 비전 단독), 그리고 1+2 융합(`hybrid_fusion`, 기본값) 세 가지를 **`ComplexRoadStrategy`로 언제든 스위칭**할 수 있게 설계서를 확장했다.
  - 또한 `ModeManager`에 `whitebox`(`hybrid_fusion`), `whitebox_minimap`, `whitebox_vision`으로도 등록할 수 있게 하여, 로터리나 톨게이트 진입 시 **방식 1 단독 vs 방식 2 단독 vs 1+2 융합을 실시간 전환하거나 Shadow 모드로 나란히 비교**할 수 있도록 구성했다.
- **Builder Check 완료 (`22:01 KST`):** 서브에이전트 리뷰어가 설계서와 기존 코드베이스를 대조한 결과 **`"nothing important left"`**(추가 미결 질문 없음)로 검토를 통과했다.

> 책 소재: "둘 다 할 수도 있어?"에 이어 "아니면 스위칭도 괜찮아"라는 한마디가 더해지면서, 미니맵 방식·전방 비전 방식·센서 퓨전 방식을 단순히 합치는 데 그치지 않고 주행 중 실시간 스위칭과 Shadow 동시 비교 실험까지 가능한 연구 구조로 진화했다.

## 22:03 ~ 22:06 (KST) — Phase 1-B 구현 계획서(`writing-plans`) 작성 및 Jira 일감 그래프(`jira-plan`) 승인 요청

- **사용자 요청:** `"계획 작성하고 일감 등록해줘"`
- **구현 계획서 작성 완료:** [2026-11-19-ets2-phase1b-road-completion-plan.md](file:///D:/Programming/ets-autonomous-driving/docs/superpowers/plans/2026-11-19-ets2-phase1b-road-completion-plan.md) (Task 1 ~ Task 6 TDD 계획 및 자가 검토 완료)
- **Jira 일감 그래프(`plan-ets2-phase1b-road-completion`) 설계 — 선행 Phase 1-A(`SCRUM-164`~`168`)와의 파일 충돌 방지 연결 포함:**
  - `T1` (`SCRUM-164 → T1`): Phase 1-B 설정·인식·판단 데이터 계약 확장(`SafetyConfig`, `CameraViewPreset`, `NavPerception`, `RoadStructurePerception`, `DrivingState`)
  - `T2` (독립 루트): ETS2 인게임 설정(`config_local.cfg` `g_trans`·`config.cfg` `g_emergency_brake`) 자동 진단·무손실 패치 및 `ViGEm.ViGEmBus` 점검 보강
  - `T3` (`T1 → T3`): 야간·터널 적응형 차선 검출, 미니맵 차선변경·로터리 기하학 및 전방 표지판·톨게이트 비전 검출기(`RoadStructureDetector`) 구현
  - `T4` (`T1 → T4`, `T3`와 병렬): 카메라 시점별 거리·TTC 역투영 보정, YOLO 좌·중앙·우 3코리더 차량 추적 및 `calibrate_ets2.py` 소실점 보정 구현
  - `T5` (`T3 → T5`, `T4 → T5`, `SCRUM-167 → T5`): 급커브 곡률 감속, 목적지 도착(`ARRIVED`), 복합 도로 1+2 융합·3종 전략 스위칭 상태기계 및 파이프라인·분산 허브 통합
- `jira-plan` 4장 규칙에 따라 등록 전 일감 표와 선후관계 그래프를 사용자에게 제시하고 승인을 요청했다.

## 22:07 (KST) — 질의응답: `"그리고 이정도면 게임 구동해서 돌려볼수 있을까?"` 및 실차 원클릭 구동 준비(`pyproject.toml live`·플러그인 배포) 보강

- **사용자의 질문:**
  > "그리고 이정도면 게임 구동해서 돌려볼수 있을까?"
- **실제 PC 환경 마지막 팩트 체크:**
  1. `ViGEmBus v1.22.0` 드라이버 서비스: 이미 `Running` 상태(오늘 설치 완료).
  2. `D:\SteamLibrary\...\bin\win_x64\plugins\scs-telemetry.dll`: 현재 `False`(미설치)이고 `C:\Program Files (x86)\...\plugins\ETSSharedMemoryMapPlugin64v2.dll`만 존재함.
  3. `pyproject.toml`: 헤드리스 테스트를 위해 `mss`, `vgamepad`, `ultralytics`가 지연 임포트로만 되어 있고 `uv sync --extra live` 같은 실차 런타임 의존성 묶음이 빠져 있었음.
- **조치:**
  - Phase 1-B 설계서·계획서(`Task 6` / 일감 `T2`)에 **`pyproject.toml`의 `live = ["mss>=9.0", "vgamepad>=0.1.0", "ultralytics>=8.3.0"]` 그룹 추가** 및 **`setup_ets2_integration.py`의 플러그인 배포(로컬 `ETSSharedMemoryMapPlugin64v2.dll` 폴백 복사 또는 `scs-telemetry.dll` 배포)**까지 포함시켰다.
  - 이로써 Phase 1-A(`SCRUM-164`~`168`)와 Phase 1-B(`T1`~`T5`)가 완료되면 실제 ETS2 게임을 켜서 바로 자율주행을 시운전할 수 있는 모든 조건이 충족된다.

> 교훈: "이 정도면 게임을 켜서 돌려볼 수 있을까?"라는 질문에 답할 때는 코드 로직뿐 아니라 실제 디스크의 `.dll` 존재 여부와 `pyproject.toml` 패키지 설치 명령까지 확인해야 진짜 막힘없는 첫 시운전이 된다.

## 22:12 (KST) — 최상위 `tools.py` 프로젝트 통합 도구 콘솔 UI 설계·계획 추가 (`Task 7` / 일감 `T6`)

- **사용자 요청:**
  > "최상위 루트에 tools.py를 만들고, 프로젝트내 여서 도구를 실행할수 있도록 콘솔 기반 UI 만들어줘"
- **설계 및 계획 반영 ([2026-11-19-ets2-phase1b-road-completion-design.md](file:///D:/Programming/ets-autonomous-driving/docs/superpowers/specs/2026-11-19-ets2-phase1b-road-completion-design.md#L172), [2026-11-19-ets2-phase1b-road-completion-plan.md](file:///D:/Programming/ets-autonomous-driving/docs/superpowers/plans/2026-11-19-ets2-phase1b-road-completion-plan.md#L466)):**
  - `uv run python tools.py` 하나로 상단에 실시간 환경 상태(`ViGEmBus`, `scs-telemetry.dll`, `controls.sii` 패치 여부, `g_trans` 변속기 설정, 활성 시점·복합 도로 전략)를 요약 표시하고, `[1]`~`[9]` 번호 메뉴로 프로젝트 내 모든 도구(`setup_ets2_integration`, `patch_controls_sii`, 백업 원복, `verify_gamepad_ets2`, `calibrate_ets2`, `ets-ad run`, `ets-ad bridge`, `ets-ad serve`, `ets-ad replay`)를 대화형으로 실행하는 통합 콘솔 UI를 추가했다.
  - **핵심 기술 디테일 (`tools.py` vs `tools/` 디렉터리 임포트 충돌 방지):**
    - 저장소 루트에 이미 `tools/` 폴더가 있고 기존 테스트들이 `from tools.patch_controls_sii import ...` 형태로 임포트하므로, 루트에 일반 `tools.py`를 만들면 파이썬이 `tools.py`를 비패키지 모듈로 먼저 로드해 `'tools' is not a package` 오류가 발생한다.
    - 이를 막기 위해 `tools.py` 상단에 `__path__ = [str(Path(__file__).resolve().parent / "tools")]`를 선언해 `tools.py`가 실행 스크립트이면서 동시에 `tools.*` 하위 모듈 임포트를 그대로 중계하는 패키지 진입점으로 동작하도록 계획서 `Task 7`에 명시했다.
- **Jira 일감 그래프 확장 (`T1` ~ `T6`):**
  - `T6`: 최상위 루트 `tools.py` 프로젝트 통합 도구 실행 콘솔 UI 구현 (`T2 → T6`, `T5 → T6`, `SCRUM-168 → T6`)

> 교훈: 루트에 `tools/` 폴더가 있는 파이썬 프로젝트에서 루트 `tools.py` 런처를 만들 때는 `__path__` 설정으로 패키지 호환성을 함께 챙겨야 기존 `from tools.xxx import ...` 코드와 테스트가 깨지지 않는다.

## 22:14 ~ 22:17 (KST) — Phase 1-B Jira 일감 6건(`SCRUM-169`~`SCRUM-174`) 및 `Blocks` 선후관계 9건 등록 완료

- **사용자 승인:** `"응 좋아"`
- **Jira 등록 결과 (`golony.atlassian.net`, 에픽 `SCRUM-155`, 계획 라벨 `plan-ets2-phase1b-road-completion`):**
  - `T1` → **`SCRUM-169`**: Phase 1-B 커브·도착·시점 보정·복합 도로(RoadStructure·DrivingState) 설정 및 데이터 계약 확장
  - `T2` → **`SCRUM-170`**: 실차 런타임 의존성(live), ETS2 설정(config_local.cfg g_trans·config.cfg) 자동 진단·무손실 패치 및 ViGEmBus 점검 보강
  - `T3` → **`SCRUM-171`**: 야간·터널 적응형 차선 검출, 미니맵 차선변경·로터리 기하학 및 전방 표지판·톨게이트 비전 검출기(RoadStructureDetector) 구현
  - `T4` → **`SCRUM-172`**: 카메라 시점별 거리·TTC 역투영 보정, YOLO 좌·중앙·우 3코리더 차량 추적 및 calibrate_ets2.py 소실점 보정 구현
  - `T5` → **`SCRUM-173`**: 급커브 곡률 감속, 목적지 도착(ARRIVED), 복합 도로 1+2 융합·3종 전략 스위칭 상태기계 및 파이프라인·분산 허브 통합
  - `T6` → **`SCRUM-174`**: 최상위 루트 tools.py 프로젝트 통합 도구 실행 콘솔 UI 구현
- **선후관계(`Blocks`) 링크 (총 9건):**
  - `SCRUM-164 → SCRUM-169`
  - `SCRUM-169 → SCRUM-171`
  - `SCRUM-169 → SCRUM-172`
  - `SCRUM-171 → SCRUM-173`
  - `SCRUM-172 → SCRUM-173`
  - `SCRUM-167 → SCRUM-173`
  - `SCRUM-170 → SCRUM-174`
  - `SCRUM-173 → SCRUM-174`
  - `SCRUM-168 → SCRUM-174`

> 책 소재: 실차 패드·안전 구동 보강(Phase 1-A, `SCRUM-164`~`168`)과 전 구간 완주 품질·복합 도로 1+2 융합·통합 콘솔 런처(Phase 1-B, `SCRUM-169`~`174`) 총 11개 티켓이 하나의 거대한 파일 무충돌 DAG로 맞물려 등록된 순간.

## 22:26 (KST) — 질의응답: `"자 그럼 지금 일감들 다 하고나서 실행을 위한 절차 알려줘"` (실주행 A to Z 매뉴얼 정리)

- **사용자의 질문:**
  > "자 그럼 지금 일감들 다 하고나서 실행을 위한 절차 알려줘"
- **안내한 5단계 실주행 절차 요약 (`tools.py` 통합 콘솔 UI 기준):**
  1. **1단계 (게임 켜기 전 최초 1회 설정):** `uv sync --extra live` → `uv run python tools.py` 실행 → **`[1]`** (플러그인 배포 확인 및 `config_local.cfg` `g_trans "0"`·`config.cfg` `g_emergency_brake "0"` 패치) → **`[2]`** (`controls.sii` MOZA 휠 + 가상 패드 `joy2` 공존 패치).
  2. **2단계 (ETS2 게임 구동 및 운전석 진입):** ETS2 실행 후 트럭 운전석 진입, `1`번 운전석 시점(또는 `6`번 범퍼 시점), `F3` 미니맵(Route Advisor) 기본 배율 표시, 월드맵(`M`)에서 목적지 내비 경로 지정 후 정차 대기.
  3. **3단계 (정차 상태 10초 검증 및 ROI·소실점 맞춤):** `tools.py`의 **`[4]`**(10초 패드·텔레메트리 자동 검증으로 조향 부호·페달·깜빡이 반응 확인) → **`[5]`**(대화형 캘리브레이션 뷰어에서 방향키와 `[`/`]`로 차선 ROI·소실점 맞추고 `S` 저장).
  4. **4단계 (자율주행 출발):** 노트북 단독 주행은 **`[6]`**, 홈서버 3단 웹 대시보드(`http://<홈서버>:8094`, 상단 `Engine ON`) 연동 주행은 **`[7]`** 실행.
  5. **5단계 (주행 중 안전 개입 및 원상 복구):** 위급 시 MOZA 핸들/브레이크 직접 조작(`TakeoverMonitor` 자동 해제) 또는 `F12`(Kill Switch), 재개는 `F10`, 실험 종료 후 설정 원복은 `tools.py`의 **`[3]`**.

> 교훈: 아무리 정교한 자율주행 파이프라인이라도 사용자가 처음 시운전할 때는 "게임을 켜기 전에 할 일"과 "운전석에 앉은 뒤에 누를 번호"가 순서대로 한눈에 보여야 실수 없이 첫 주행에 성공할 수 있다.

## 23:00 ~ 23:05 (KST) — 최상위 `tools.py` 통합 도구 콘솔 UI (`SCRUM-174`) 선행 구현 및 검증

- **사용자 요청:** `"tools.py 만드는거만 먼저 해줄래?"`
- **구현 주체 판단 (`deepseek-delegate` 1번):**
  - `구현 주체: Claude — 사용자 직접 지정(1번): 별도 워크트리에서 SCRUM-173이 진행 중인 동안 파일 충돌이 전혀 없는 최상위 tools.py 콘솔 UI(SCRUM-174)를 먼저 직접 구현 요청`
- **구현 및 검증 내용:**
  1. Jira `SCRUM-174`에 `wip-by-agent` 라벨을 붙이고 `진행 중`으로 전환하여 중복 착수를 방지했다.
  2. `tests/test_tools_console_ui.py` 실패 테스트 5건을 먼저 작성해 `ImportError`를 확인한 뒤, 최상위 [tools.py](file:///D:/Programming/ets-autonomous-driving/tools.py)를 구현했다.
  3. `__path__ = [str(Path(__file__).resolve().parent / "tools")]` 패키지 중계 설정으로 `import tools`와 기존 `from tools.patch_controls_sii import ...` 등 4개 서브모듈 임포트가 100% 공존함을 확인했다(`58 passed in 6.11s`).
  4. 실제 `uv run python tools.py --list` 실행 결과, 현재 PC의 실제 상태(`ViGEmBus: Running(정상) | 플러그인: 미설치 | controls.sii: 미패치 | 인게임 설정: g_trans=3(패치 권장)`)와 `[1]`~`[9]`, `[0]` 메뉴가 정상 출력됨을 확인했다.

> 교훈: 최상위 콘솔 런처가 상단 헤더에서 현재 PC의 드라이버·플러그인·설정 파일 상태를 실시간으로 진단해 보여주면, 사용자는 다음에 몇 번 메뉴를 눌러야 할지 고민할 필요가 없다.

## 23:11 ~ 23:13 (KST) — 실차 시운전 트러블슈팅 1: `"게임 실행했는데 플러그인 관련 내용이 없는데?"`

- **사용자의 제보:**
  > "게임 실했했느데 플러그인 관련 내용이 없는데?"
- **원인 조사 및 해결 (삽질 기록):**
  - **증상:** 사용자가 `tools.py`의 `[1]`번과 `[2]`번을 실행한 뒤 ETS2를 켰으나 인게임에서 SDK 플러그인 감지 안내가 뜨지 않음.
  - **원인:** `tools.py` `[1]`번 메뉴의 기존 기본값 `(1)`이 `--patch-configs`만 실행하고 `--download-plugin`을 포함하지 않아서, 첫 실행 시점에 `controls.sii`와 `g_trans=0`, `g_emergency_brake=0`은 정상 패치됐지만 `D:\SteamLibrary\...\bin\win_x64\plugins\scs-telemetry.dll`은 아직 다운로드되지 않은 상태(`플러그인: 미설치`)에서 게임이 먼저 켜졌음.
  - **조치:**
    1. `D:\SteamLibrary\steamapps\common\Euro Truck Simulator 2\bin\win_x64\plugins\scs-telemetry.dll` (39,424 Bytes, SHA-256 `c209f377...`)을 즉시 다운로드·배포 완료하고 디스크 존재를 확인했다.
    2. `tools.py` `[1]`번 메뉴의 기본값 `(1)`을 **`--download-plugin --patch-configs`(플러그인 자동 설치 + 인게임 설정 패치 동시 수행)**로 수정해 앞으로는 엔터만 눌러도 플러그인까지 한 번에 깔리도록 개선했다.
    3. ETS2는 게임 시작 시점에만 `plugins\` 폴더를 스캔하므로, **게임을 한 번 종료했다가 다시 실행**하면 플러그인 팝업이 뜬다고 안내했다.

> 교훈: 통합 콘솔 메뉴의 기본값(Default)은 사용자가 세부 옵션(1~4)을 읽지 않고 그냥 엔터만 쳐도 가장 필요한 작업(플러그인 설치 + 설정 패치)이 한 번에 끝나도록 설계해야 한다.

## 23:14 ~ 23:16 (KST) — 실차 시운전 트러블슈팅 2 (삽질 기록): `"공유 메모리(Local\SCSTelemetry)에 연결하지 못했습니다"` → `Win32`(32bit `0x14c`) vs `Win64`(64bit `0x8664`) ZIP 추출 버그 발굴 및 수정

- **사용자의 제보:**
  > "- 공유 메모리(Local\SCSTelemetry)에 연결하지 못했습니다. ETS2를 실행하고 플러그인이 로드됐는지 `Documents\Euro Truck Simulator 2\game.log.txt`에서확인하세요."
- **원인 추적 (PE 바이너리 헤더 및 GitHub ZIP 구조 분석):**
  1. 배포된 `D:\SteamLibrary\...\bin\win_x64\plugins\scs-telemetry.dll` (39,424 Bytes)의 PE 헤더(`e_lfanew` + 4) Machine 필드를 파이썬 `struct`로 찍어본 결과 **`0x14c` (`IMAGE_FILE_MACHINE_I386`, 32비트 x86 DLL)**로 확인되었다.
  2. `RenCloud/scs-sdk-plugin` 릴리스의 `release_v_1_12_1.zip` 내부 엔트리를 조회해 보니:
     - 7번째 엔트리: `release_v_1_12_1/Win32/scs-telemetry.dll` (`39,424 Bytes`, 32비트)
     - 9번째 엔트리: `release_v_1_12_1/Win64/scs-telemetry.dll` (`42,496 Bytes`, 64비트)
  3. 기존 `download_telemetry_plugin()`의 `next(info for info in archive.infolist() if info.filename.lower().endswith("scs-telemetry.dll"))`가 알파벳순으로 앞에 있던 **`Win32/scs-telemetry.dll`을 먼저 꺼내 64비트 게임 폴더(`bin\win_x64\plugins\`)에 배포**한 것이 원인이었다(64비트 `eurotrucks2.exe`는 32비트 DLL을 로드할 수 없음).
- **고친 방법 및 결과:**
  1. `tools/setup_ets2_integration.py`에서 ZIP 압축 해제 시 `"win64"` 또는 `"x64"`가 포함된 엔트리를 최우선 선택하도록 수정하고, `_is_pe_32bit_x86()` 검사로 기존에 잘못 깔린 32비트 DLL(`0x014C`)이 감지되면 자동으로 64비트 DLL로 교체하도록 보완했다.
  2. 즉시 재실행하여 `Win64/scs-telemetry.dll` (`42,496 Bytes`, PE Machine **`0x8664` AMD64**, SHA-256 `1d03dbc7...`)로 교체를 완료했다.

> 교훈: ZIP 아카이브에서 파일명 끝자리(`.endswith("scs-telemetry.dll")`)만으로 바이너리를 꺼내면 `Win32/`와 `Win64/`가 공존하는 릴리스에서 32비트 DLL이 64비트 폴더로 들어가는 함정에 빠진다. 경로 필터(`win64`/`x64`)와 PE Machine 헤더(`0x8664`) 검증까지 넣어야 진짜 안전하다.

## 23:19 (KST) — 실제 ETS2 `Local\SCSTelemetry` 공유 메모리 라이브 연결 성공 (`"됬다!"`)

- **사용자의 반응:**
  > "됬다!"
- **라이브 텔레메트리 진단 확인 (`tools/setup_ets2_integration.py`):**
  - `플러그인 설치: 예` (`Win64/scs-telemetry.dll`, SHA-256 `1d03dbc7...`)
  - `ViGEmBus 서비스 실행: 예`
  - **`공유 메모리 연결: 예`** — `공유 메모리(Local\SCSTelemetry)에 연결했습니다: 11회 샘플링, 속도 0.0km/h, 제한속도 80km/h, 기어 0, RPM 0, 남은 내비 거리 0m, 트레일러 미연결, 운전자 입력(조향 +0.00/브레이크 0.00)`
  - `인게임 설정이 자율주행 권장값입니다(g_emergency_brake "0", g_trans "0", g_cam_steering "0").`
- 동시에 백그라운드에서 진행 중이던 마지막 코어 일감 `SCRUM-173`도 `완료`로 머지되었으며, `.venv`에 `vgamepad`, `mss` 실차 패키지 설치(`live packages OK`)까지 확인되었다.

> 책 소재: 32비트 vs 64비트 DLL 함정을 격파한 직후, 실제 유로트럭 게임 프로세스로부터 32KB `Local\SCSTelemetry` 공유 메모리 패킷이 1초에 11번씩 살아 들어오기 시작한 첫 라이브 연결의 순간.

## 23:24 ~ 23:31 (KST) — 실차 시운전 트러블슈팅 3 (삽질 기록): `[4] 10초 패드 검증 전 항목 미반응(0.000)` → `game.log.txt` 및 `eurotrucks2.exe` 역어셈블로 XInput 실제 식별자(`xinput_gamepad_1`, `rt`/`lt`, `b1..b6`) 규명

- **증상:**
  - 사용자가 운전석 정차 상태에서 `tools.py` `[4]`번(10초 패드·텔레메트리 자동 검증)을 실행했으나 조향(`gameSteer=0.000`), 스로틀(`0.000`), 브레이크(`0.000`), 좌/우 깜빡이가 모두 미반응으로 실패했다.
- **원인 추적 (`game.log.txt` 분석 + `eurotrucks2.exe` `.text` 역어셈블):**
  1. `Documents\Euro Truck Simulator 2\game.log.txt` 1137~1149행을 확인한 결과 결정적인 단서 두 줄이 찍혀 있었다:
     - `00:05:49.107 : Using 'xinput_gamepad_1' ('@@xinput_gamepad@@ 1') as ui_joy.`
     - `00:05:49.108 : <WARNING> Unable to find alternative for device 'xinput.gamepad_1', unable to fix its binding`
     - 즉 ETS2의 XInput 장치 ID는 점(`.`)이 들어간 `xinput.gamepad_1`이 아니라 **언더스코어(`_`)가 들어간 `` `xinput_gamepad_1` ``**이었다!
  2. 이어서 `eurotrucks2.exe` 바이너리의 `xinput_gamepad` 입력 채널 등록 함수(파일 오프셋 `0x27a985` 부근)의 `lea` 문자열 참조 테이블을 파이썬으로 역어셈블하여 ETS2 내부의 실제 축·버튼 토큰을 1:1로 추출했다:
     - **트리거 축:** DirectInput식의 `joy2.rz` / `joy2.z`가 아니라 **`joy2.rt` (`@@right_trigger@@`), `joy2.lt` (`@@left_trigger@@`)**
     - **버튼 번호 (0-indexed가 아닌 1-indexed!):**
       - `@@button_a@@` (A, 파킹브레이크) = **`joy2.b1`** (기존 `b0` 아님)
       - `@@button_b@@` (B) = `joy2.b2`, `@@button_x@@` (X) = `joy2.b3`, `@@button_y@@` (Y) = `joy2.b4`
       - `@@button_lb@@` (LB, 좌측 깜빡이) = **`joy2.b5`** (기존 `b4` 아님)
       - `@@button_rb@@` (RB, 우측 깜빡이) = **`joy2.b6`** (기존 `b5` 아님)
  3. **핫플러그 인식 지연(`1.43초`):** `game.log.txt` 타임스탬프(`00:05:51.701 : [di8] Received device change notification.` → `00:05:53.136 : Using 'xinput_gamepad_1'`)에서 `vgamepad`가 가상 패드를 꽂은 뒤 ETS2가 장치를 바인딩하기까지 **약 1.43초**가 걸리는 것을 확인했다.
- **고친 방법:**
  1. `tools/patch_controls_sii.py`의 기본값을 실제 `eurotrucks2.exe` 규격(`xinput_gamepad_1`, `joy2.rt`, `joy2.lt`, `lblinker: joy2.b5?0`, `rblinker: joy2.b6?0`, `parkingbrake: joy2.b1?0`)으로 업데이트하고, 기존 `joy2.b*` 항도 자동 교체되도록 보완했다(`31 passed`).
  2. `tools/verify_gamepad_ets2.py`에서 가상 패드 생성 및 첫 중립 리포트 송출 직후 **2.5초 핫플러그 인식 대기(Warm-up)**를 추가했다.
  3. ETS2는 종료 시 메모리의 `controls.sii`를 디스크에 덮어쓰므로(`Current profile saved.`), **게임을 먼저 종료한 뒤 `tools.py`의 `[2]`번 패치를 다시 실행하고 게임을 켜도록** 안내했다.

> 교훈: 게임 컨트롤러 바인딩에서 문서나 일반적인 DirectInput 관례(`xinput.gamepad_1`, `rz`/`z`, `b0`/`b4`/`b5`)만 믿으면 인게임 파서가 조용히 무시한다. `game.log.txt`와 실행 바이너리(`.exe`)의 문자열 등록 테이블을 직접 까보면 단 한 번에 100% 정확한 토큰(`xinput_gamepad_1`, `rt`/`lt`, `b1`/`b5`/`b6`)을 얻을 수 있다.

## 23:52 ~ 23:54 (KST) — 실차 시운전 트러블슈팅 4 (삽질 기록): `<ERROR> Failed to parse device name 'xinput_gamepad_1'` → 최종 정답 `` `xinput.xinput_gamepad_1` `` 확정

- **증상:**
  - `xinput_gamepad_1`로 패치 후 게임을 재시작했으나 `[4]`번 10초 검증이 여전히 전 항목 미반응(`0.000`).
- **원인 분석 (`game.log.txt` 777행, 1038행):**
  1. `00:00:36.908 : <ERROR> Failed to parse device name 'xinput_gamepad_1'`
     - ETS2 `controls.sii` 장치 표기는 반드시 **`<서브시스템>.<장치이름>`** 형태를 요구한다(`sys.keyboard`, `fusion.mouse`, `di8.'{...}'`).
     - 1차 시도 `xinput.gamepad_1`은 장치명이 틀려 `Unable to find alternative`, 2차 시도 `xinput_gamepad_1`은 서브시스템 접두사(`xinput.`)가 빠져 `Failed to parse device name` 오류가 났다.
     - **최종 정답:** **`xinput.xinput_gamepad_1`** (`xinput` 서브시스템 + `.` + `xinput_gamepad_1` 장치명).
  2. 추가로, 사용자가 켜 두었던 기존 `tools.py` 콘솔 창을 재시작하지 않아 `verify_gamepad_ets2.py`의 2.5초 핫플러그 웜업 수정본이 메모리에 반영되지 않았던 점도 함께 확인했다.
- **조치:**
  - `tools/patch_controls_sii.py`의 `DEFAULT_VIRTUAL_DEVICE_ID`를 `` "`xinput.xinput_gamepad_1`" ``으로 수정하고 테스트 통과를 확인했다.
  - 게임 종료 후 재패치 및 `tools.py` 창 재시작 안내.

> 교훈: `game.log.txt`의 오류 메시지 한 줄(`<ERROR> Failed to parse device name`)이 장치 ID 파서 문법(`<서브시스템>.<장치이름>` = `xinput.xinput_gamepad_1`)을 정확히 짚어 주었다. 또한 파이썬 콘솔 런처(`tools.py`)가 켜진 채로 코드가 수정되면 반드시 콘솔을 재시작해야 새 모듈이 반영된다.

## 22:10 (KST) — 새 세션에서 Jira 일감 목록 재조회

- **사용자 요청:** `"일감 목록 다시 불러와줘"`
- **Jira(`SCRUM`, 라벨 `ets-autonomous-driving`) 조회 결과:**
  - **에픽:** `SCRUM-155` (`ets-autonomous-driving`, 상태: `완료`)
  - **미완료 일감 (`해야 할 일` 5건, `plan-ets2-live-actuation-hardening`):**
    - 바로 착수 가능(선행 없음): `SCRUM-164`, `SCRUM-165`
    - 선행 대기: `SCRUM-166` (`SCRUM-164` 대기), `SCRUM-167` (`SCRUM-166` 대기), `SCRUM-168` (`SCRUM-165`, `SCRUM-166` 대기)
  - **완료 일감 (`완료` 8건, `plan-ets2-phase1-whitebox`):** `SCRUM-156` ~ `SCRUM-163`
  - **미등록 계획:** Phase 1-B(`plan-ets2-phase1b-road-completion`, `T1`~`T5`)는 계획서만 작성되어 있으며 아직 Jira에 등록되지 않음을 함께 확인·안내했다.

> 교훈: 세션이 새로 열렸을 때 일감 목록을 다시 불러오면서 직전 집필 노트까지 함께 확인하면, 이미 등록된 일감(Phase 1-A)과 등록 대기 중인 계획(Phase 1-B)의 경계를 놓치지 않고 정확히 이어갈 수 있다.

## 22:20 (KST) — Phase 1-A·1-B 전체 11건(`SCRUM-164`~`174`) 지라 워크플로우 최대 병렬 착수

- **사용자 요청:** `"지라 워크플로우로 모두 처리해줘. 최대한 병렬처리 해줘"`
- **구현 주체 판단 (`deepseek-delegate` 1장):**
  - `구현 주체: DeepSeek — 11건 모두 계획서에 파일·시그니처·테스트가 구체적으로 정의되어 있고 보안·크리티컬 위험에 해당하지 않음(4)`
  - 시작 시점 DeepSeek 잔액: `$8.85`
- **최대 병렬 DAG 실행 계획:**
  - **Wave 1 (즉시 3병렬):** `SCRUM-164` (Phase 1-A Task 1+4), `SCRUM-165` (Phase 1-A Task 2), `SCRUM-170` (Phase 1-B Task 6, `pyproject.toml` live 그룹 포함) — 파일 겹침 0건
  - **동적 후속 투입:** 선행 일감이 머지·완료되는 즉시 대기 중인 후행 일감을 바로 착수
    - `SCRUM-164` 완료 즉시 → `SCRUM-166`, `SCRUM-169` 동시 투입
    - `SCRUM-166` 완료 즉시 → `SCRUM-167` 투입 (및 `SCRUM-165`도 완료면 `SCRUM-168` 동시 투입)
    - `SCRUM-169` 완료 즉시 → `SCRUM-171`, `SCRUM-172` 동시 투입
    - `SCRUM-167`+`171`+`172` 완료 즉시 → `SCRUM-173` 투입
    - `SCRUM-168`+`170`+`173` 완료 즉시 → `SCRUM-174` 투입

> 책 소재: 11개 티켓이 5단계 DAG로 얽혀 있을 때 Wave 단위 일괄 대기가 아니라, 선행 티켓 하나가 머지되자마자 후행 티켓을 즉시 띄우는 동적 파이프라이닝으로 병렬 효율을 극대화하는 전략.

## 22:24 ~ 23:25 (KST) — Phase 1-A·1-B 전체 11건(`SCRUM-164`~`174`) 지라 워크플로우 완료 및 비용 정산

- **완료 요약 (총 11건, PR #10 ~ #20 전부 `origin/main` 머지 및 Jira `완료`):**
  - Wave 1 (3병렬): `SCRUM-164` (#10, `$0.0674`), `SCRUM-165` (#11, `$0.0814`), `SCRUM-170` (#12, `$0.0846`) — 전원 1라운드 통과
  - Wave 2 (2병렬): `SCRUM-169` (#13, `$0.0608`), `SCRUM-166` (#14, `$0.0671`) — 전원 1라운드 통과
  - Wave 3 (4병렬): `SCRUM-172` (#15, `$0.0749`), `SCRUM-171` (#16, `$0.1099`), `SCRUM-168` (#17, `$0.0791`, Qwen `R1` 오탐 `invalid` 판정), `SCRUM-167` (#18, `$0.1051`) — 전원 1라운드 통과
  - Wave 4: `SCRUM-173` (#19, `$0.1955`) — Qwen 1회차 `R1` 유효 결함(차선 변경 보류 시 `steering_offset = 0.0`으로 현 차선 오프셋·트레일러 내륜차 보정을 덮어쓰는 버그) 포착 → 2회차 수정·회귀 테스트 추가 후 통과
  - Wave 5: `SCRUM-174` (#20, `$0.0790`) — Qwen 지적 0건, `src/ets_ad/cli.py` `_MODE_CHOICES` 2종 보완 및 `tools.*` 78건 테스트 통과 확인 후 머지
- **비용 정산 (11건 전체):**
  - DeepSeek 실행 합계: `$0.6515` (실제 잔액 변화: `$8.85 → $8.20`, 차이 `$0.65`)
  - Qwen 검토 합계: `$0.3533`
  - **총합: `$1.0048`** (약 1시간 만에 11개 PR 구현 + 듀얼 모델 QA 검토 완료)
- **로컬 워킹 트리 주의:** `SCRUM-174` 머지 시점에 다른 세션의 실차 시운전 수정분(`tools/setup_ets2_integration.py` Win64 DLL 우선 추출, 로컬 `tools.py`, `tests/test_tools_console_ui.py`)이 로컬 `main`에 존재해 `git pull --ff-only`가 안전하게 중단되었으며, 사용자 수정분을 보호하기 위해 덮어쓰지 않고 유지했다.

> 책 소재: 11개의 자율주행 핵심 티켓을 최대 4병렬 DAG로 돌려 약 1시간, 총 비용 1달러($1.00)에 전부 구현·검증·머지까지 마친 기록 — 특히 Qwen이 `SCRUM-173`에서 차선 변경 보류 시 트레일러 내륜차 보정이 초기화되는 미묘한 버그를 잡아내며 자동 QA 파이프라인의 가치를 증명했다.
