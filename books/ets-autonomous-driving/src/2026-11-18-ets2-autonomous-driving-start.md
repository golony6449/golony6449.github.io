# 2026-11-18 — 프로젝트 시작: 유로트럭 시뮬레이터 2 기반 자율주행 연구

## 23:01 (KST) — 프로젝트 규칙 수립 (`GEMINI.md`)

- 빈 저장소(`ets-autonomous-driving`)에서 작업을 시작하기 전에, 앞으로 진행할 모든 작업과 대화 내용을 빠짐없이 기록하기 위해 집필 노트 규칙을 먼저 세웠다.
- 사용자: "모든 작업 시작하긴 전에. 모든 작업에 대해 집필노트 작성하도록 gemini.MD에 추가해워"
- 전역 설정(`~/.gemini/GEMINI.md`)과 현재 프로젝트(`GEMINI.md`) 중 어디에 적용할지, 노트 저장 경로를 어떻게 할지 확인한 결과, 사용자는 다음을 선택했다.
  - 적용 대상: 현재 프로젝트(`D:\Programming\ets-autonomous-driving\GEMINI.md`)만 새로 생성하여 추가
  - 기록 경로 및 기준: 작업 중인 레포의 `docs/journal/YYYY-MM-DD-<주제>.md` (`sky-scanner` 기준: 대화·발언 원문·삽질·결정·책 소재 포함)
- 이에 따라 `GEMINI.md`를 생성하고 한국어 원칙, Antigravity 도구 규칙, 집필 노트 작성 규칙을 명시했다.

> 책 소재: 새 프로젝트를 열면서 코드 한 줄 짜기 전에 "모든 과정을 집필 노트로 남기는 규칙"부터 못 박고 시작한 첫 장면.

---

## 23:04 (KST) — 연구 주제 선언 및 브레인스토밍 시작

- 사용자가 본격적인 프로젝트 방향을 제시했다.
- 사용자: "자 우리 이제 여기서는 자율주행을 연구해보려고 해. 실체 자로 해볼수는 없으니, 그나마 현실적인 유로트럭 시뮤레이터2를 베이스로 해볼꺼야. 슈퍼파워 스킬 활용해서 내용을 조금씩 채워볼까?"
- 판단: 새 프로젝트의 설계·방향 정립 단계이므로 `superpowers:brainstorming` 스킬을 적용하기로 했다. 먼저 사용자가 이 연구를 통해 무엇을 탐구하고 어떤 모습의 자율주행을 만들어보고 싶은지(목적과 기대 모습)를 예시로 유도하지 않고 열린 질문으로 확인하기로 했다.

## 23:10 (KST) — 1차 목표 설정: 출발지에서 도착지까지 무사 도착

- 사용자: "출발지에서 출발한 화물이 도착지 까지 무사하게 도착하는 걸 1차 목표로 하고 싶어."
- 목표가 "출발지~도착지 화물 무사 도착(End-to-End 주행 완수)"으로 1차 정의되었다.
- 다음 단계로, 이 연구를 통해 사용자가 어떤 측면(목적과 탐구하고 싶은 핵심)을 가장 중점적으로 다뤄보고 싶은지 확인하여 연구 방법론과 아키텍처 방향을 좁히기로 했다.

## 23:14 (KST) — 핵심 연구 관심사: 인지 → 판단(근거 포함) → 제어

- 사용자:
  > "인식 -> 판단 -> 행동 과정을 경험해보고 싶어.
  > 특히 최근 트렌드인, 카메라로 어떻게 라인과 사물, 신호등 등을 인식하고
  > 이렇게 인식한 데이터로 어떻게 판단을 내리고 + 판단 근거는 어떻게 세우고,
  > 결론을 내린 걸 어떻게 차량에 실제 동작으로 반영하는가."
- 이로써 연구의 방향성이 명확해졌다:
  1. 단순 블랙박스 End-to-End 딥러닝보다, **카메라(영상) 기반 인지 → 근거가 드러나는 판단 로직 → 실제 차량(트럭) 조향·가감속 제어**로 이어지는 파이프라인 전체를 직접 경험·해석하는 것이 핵심이다.
  2. 특히 "판단 근거를 어떻게 세우는가"에 무게가 있으므로, 각 프레임/상황마다 왜 감속·정지·차선 유지·차선 변경을 결정했는지 추적·관찰할 수 있는 구조가 중요해진다.
- 다음 질문으로, 1차 목표인 "출발지에서 도착지까지"의 구체적인 주행 범위(도심/고속도로, 야드 출차·후진 도킹 주차 포함 여부 등)를 확인하기로 했다.

## 23:23 (KST) — 슈퍼파워(`superpowers`) 스킬 로드 상태 확인

- 사용자: "슈퍼파워 스킬 로딩 되어있어?"
- 현재 세션에 `superpowers` 플러그인 스킬 15종(`using-superpowers`, `brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`, `test-driven-development` 등)이 로드되어 있으며, `using-superpowers`와 `brainstorming` 스킬을 읽고 절차(요구사항 구체화 → 접근법 비교 → 설계 문서 작성 → 계획 수립)대로 진행 중임을 안내했다. 또한 직전 질문(1차 목표의 주행 범위)을 객관식 선택 UI(`ask_question`)로 바로 응답할 수 있게 함께 제시했다.

## 23:25 (KST) — 주행 범위 결정: 1차 도로 구간 완주 → 2차 야드·후진 도킹 확장

- 사용자: "1번을 먼저 하고, 추후에는 2번까지."
- 결정 사항:
  - **1차 목표:** 출발지 회사 입구(차도 진입)부터 시내 신호등·교차로·고속도로를 거쳐 목적지 회사 입구까지 무사히 도착하는 전방 도로 주행 완주.
  - **2차 목표:** 상차 마당 출차 및 목적지 하차 도크 트레일러 후진 주차까지 확장.
- 로컬 환경 확인(`Do recon`):
  - GPU: `NVIDIA GeForce RTX 3060 Laptop GPU (6144 MiB VRAM)` — ETS2 게임 렌더링과 자율주행 비전 모델이 같은 GPU를 나눠 써야 하므로, 인식 모델의 경량화·추론 속도(FPS)·VRAM 예산 관리가 핵심 제약 조건이 된다.
  - 게임 환경: `C:\Users\seongheum\Documents\Euro Truck Simulator 2` 폴더 확인 완료(로컬 PC에 ETS2 설치 및 프로필 존재).
- 다음으로, "카메라 인식"의 경계와 내 차 상태(속도·기어 등)·내비게이션 경로 정보의 수집 방식을 어떻게 조합할지 사용자에게 질문했다.

## 23:28 (KST) — 센서·데이터 경계 확정 및 3가지 아키텍처 접근법 비교

- 사용자 선택:
  > "(Recommended) 실제 자율주행차 방식: 전방 도로(차선·사물·신호등)는 카메라 영상으로 인식하고, 내 차 상태(속도·조향각 등 CAN 데이터 역할)와 내비 정보는 Telemetry SDK/미니맵으로 수신"
- 이로써 입력 경계가 실제 자율주행차와 동일한 역할 분담으로 확정되었다:
  - **외부 환경 인지(카메라):** 전방 화면 캡처를 통해 차선, 앞차/주변 차량, 신호등, 표지판 등을 비전/AI로 인식.
  - **자차 상태 및 경로(CAN + SD Map 역할):** 속도, RPM, 기어, 현재 조향각, 제한속도 등은 ETS2 Telemetry SDK(공유 메모리)로 정확히 읽고, 주행 경로 안내는 미니맵(Route Advisor) 및 텔레메트리를 결합.
- 로컬 하드웨어 확인 결과(`RTX 3060 Laptop GPU 6GB VRAM`, ETS2 로컬 설치 완료)를 바탕으로, "인식 → 판단(+근거) → 행동"을 구현할 3가지 아키텍처 접근법을 설계하여 사용자에게 비교·제시했다:
  1. **접근법 1 (추천): 계층형 화이트박스 파이프라인** — 경량 비전 AI(YOLO + 차선 검출/BEV) + 명시적 판단 엔진(상태기계·TTC·비용함수 기반 `DecisionRationale` 근거 객체 생성) + 가상 게임패드(`vgamepad`) 기반 횡/종방향 연속 제어기(Pure Pursuit/Stanley + PID).
  2. **접근법 2: 하이브리드 System 1 / System 2 (DriveVLM 스타일)** — 실시간 제어는 접근법 1의 고속 루프(20~30Hz)가 맡고, 복잡한 교차로·이례 상황 해석만 비동기 VLM(1~2Hz)이 고수준 판단 근거를 보태는 구조.
  3. **접근법 3: 데이터 기반 모방학습(Imitation Learning) 정책 신경망** — 주행 데이터를 수집해 인식 벡터로부터 조작량을 출력하는 신경망 학습.

> 교훈: 게임과 자율주행 모델이 한 GPU(6GB VRAM)에서 함께 돌아야 하는 환경에서는, 처음부터 무거운 단일 모델보다 계층별 예산과 판단 근거가 명확한 모듈형 파이프라인이 실험과 디버깅 모두에 유리하다.

## 23:34 (KST) — 접근법 결정: "1, 2, 3 다 해보고 싶어" → 4단계 플러그형 연구 로드맵 수립

- 사용자: "1,2,3 다 해보고 싶어."
- 에이전트의 판단 및 아키텍처 구조화:
  - 세 가지 접근법(방식 1 화이트박스 파이프라인, 방식 2 VLM 하이브리드, 방식 3 모방학습 신경망)을 각각 따로 버리는 코드로 만들면 중복이 크고 비교가 어렵다.
  - 따라서 **화면 캡처·Telemetry SDK·가상 패드 제어·실시간 HUD·주행 데이터 로거를 공통 플랫폼**으로 구축하고, 판단/제어 모듈만 같은 인터페이스(`PerceptionFrame + EgoState -> DecisionOutput(판단 근거 포함) -> ControlCommand`)로 갈아끼우거나 결합할 수 있는 **플러그형 아키텍처**로 설계하기로 했다.
  - 특히 Phase 1에서부터 **주행 데이터 로거**를 내장하면, Phase 1 화이트박스 주행이나 사용자의 수동 주행 중에 자동으로 `{영상, 텔레메트리, 인식 결과, 조작량, 판단 근거}` 데이터셋이 쌓여 Phase 3(모방학습)의 학습 데이터로 바로 이어진다.
- 수립한 4단계 로드맵:
  - **Phase 1:** 공통 플랫폼 + 방식 1(계층형 화이트박스: 경량 비전 + 명시적 판단 근거 엔진 + 연속 제어기 + HUD/데이터 로거) → 1차 목표(도로 구간 완주) 달성
  - **Phase 2:** 방식 2(System 1 고속 루프 + System 2 비동기 VLM 상황 추론 결합) 확장
  - **Phase 3:** 방식 3(로거로 수집된 주행 데이터 기반 모방학습 신경망 정책) 학습 및 방식 1·2와 비교 실험
  - **Phase 4:** 2차 주행 범위 확장(상차 마당 출차 ~ 목적지 하차 도크 트레일러 후진 주차)
- 전체 로드맵과 Phase 1 상세 설계를 `docs/superpowers/specs/2026-11-18-ets2-autonomous-driving-design.md`에 작성하고 빌더 관점 자가 검토(Builder check)를 수행했다.

> 책 소재: "셋 다 해보고 싶다"는 요구를 산만한 백화점식 개발이 아니라, 앞 단계가 뒷 단계의 부품과 학습 데이터를 자연스럽게 만들어 주는 3단계 진화형 아키텍처로 풀어낸 순간.

## 23:39 (KST) — 설계 보강: 모드 선택 및 실시간/리플레이 비교 아키텍처 추가

- 사용자: "모드 선택 가능하게해서 비교해보면서 할수 있을까?"
- 에이전트의 설계 반영:
  - 방식 1(화이트박스), 방식 2(VLM 하이브리드), 방식 3(모방학습 신경망)이 모두 동일한 `PlannerProtocol` 인터페이스(`decide(ego, perception) -> DecisionOutput`)를 구현하도록 표준화하고, 이를 관리하는 **`ModeManager` (모드 선택 및 비교 엔진)**를 아키텍처에 추가했다.
  - 지원할 3가지 비교 방식:
    1. **실시간 모드 전환 (Hot-Swap):** 주행 중 키보드 단축키(`F1`: 화이트박스, `F2`: VLM 하이브리드, `F3`: 모방학습, `F4`: 수동 주행+기록)나 HUD에서 멈추지 않고 즉시 주행 모드를 전환.
    2. **섀도우 비교 모드 (Shadow Mode — 실제 자율주행 업계 방식):** 실제 트럭 조작은 주 모드(Active Planner)가 담당하되, 비교 대상 모드(Shadow Planner)도 같은 프레임에 대해 판단과 근거를 계산하여 HUD에 두 모드의 목표 속도·조향각·판단 근거 차이를 나란히 표시하고 로그에 동시 기록.
    3. **동일 구간 리플레이 벤치마크 (Replay Comparison):** 저장된 주행 녹화본(`data/recordings/<session_id>/`) 하나에 방식 1·2·3을 모두 통과시켜, 완전히 동일한 도로·신호·앞차 상황에서 세 모드가 각각 어떤 판단 근거로 어떻게 다르게 행동하는지 정량·시각적으로 비교.

> 책 소재: 테슬라 등 실제 자율주행 개발에서 새 모델을 검증할 때 쓰는 '섀도우 모드(Shadow Mode)'와 동일 프레임 비교 구조를 유로트럭 연구 플랫폼에 그대로 도입한 장면.

## 23:43 (KST) — Phase 1 서브에이전트 위임 및 다음 일감(Phase 2~) 병렬 설계 시작

- 사용자: "좋아. 서브에이트에게 맡겨보고. 메인은 나랑 다름 일감 설계하자"
- 구현 주체 판단(`deepseek-delegate` 규칙 1번 적용):
  - `구현 주체: Gemini 서브에이전트(self) — 사용자 직접 지정(1번): Phase 1 구현 계획 작성 및 TDD 구현은 서브에이전트에 백그라운드 위임하고, 메인 세션은 사용자와 다음 일감 설계를 병렬 진행`
- 파일 충돌 방지 조치:
  - 메인 세션이 `docs/journal/`과 다음 일감 설계 문서(`docs/superpowers/specs/`)를 계속 작성하므로, 서브에이전트는 `docs/superpowers/plans/2026-11-18-phase1-whitebox-platform-plan.md`, `pyproject.toml`, `config/default.toml`, `.gitignore`, `src/ets_ad/**`, `tests/**`만 담당하고 `GEMINI.md`와 `docs/journal/**`은 수정하지 않도록 경계를 분리했다.

## 23:46 (KST) — 두 번째 설계 주제: 실제 ETS2 인게임 연동 및 실주행 튜닝 설계

- Phase 1 계획 작성 및 기본 파이프라인 TDD 구현을 서브에이전트(`0ba40f7d-2bfe-4ec6-8188-018b9fe0e5b3`)에 백그라운드로 위임한 뒤, 메인 세션에서 다음 설계 주제를 선정했다.
- 사용자 선택:
  > "실제 ETS2 인게임 연동 상세 — 게임 카메라 시점·미니맵·Telemetry 플러그인·가상 패드 바인딩 및 실주행 튜닝 설계"
- 판단: 파이프라인 코드가 완성되더라도 실제 게임의 해상도·카메라 시점(실내 운전석 vs 범퍼/루프 카메라)·Telemetry SDK DLL 설치·ViGEmBus 가상 패드 드라이버 및 `controls.sii` 축 바인딩·캘리브레이션 도구가 준비되어야 즉시 실주행 실험에 들어갈 수 있다. 먼저 이 PC의 실제 ETS2 설정(`Documents\Euro Truck Simulator 2`)과 설치 경로, 드라이버 상태를 조사(`Do recon`)하기로 했다.

## 23:49 (KST) — 로컬 ETS2 환경 정밀 조사(`Do recon`) 및 4대 잠재 함정 사전 발굴

실제 인게임 연동을 설계하기 위해 로컬 PC의 ETS2 설정(`Documents\Euro Truck Simulator 2\config.cfg`, `game.log.txt`, 프로필 `controls.sii`)과 스팀 설치 폴더를 조사한 결과, 실주행 단계에서 큰 삽질로 이어질 뻔한 4가지 중요한 사실을 미리 찾아냈다.

1. **함정 1 — 스팀 설치 경로 이원화로 인한 텔레메트리 플러그인 미로드:**
   - `C:\Program Files (x86)\Steam\steamapps\common\Euro Truck Simulator 2\bin\win_x64\plugins\ETSSharedMemoryMapPlugin64v2.dll`에 플러그인 파일이 존재하지만,
   - `game.log.txt` 확인 결과 실제 실행 중인 게임 바이너리는 **`D:\SteamLibrary\steamapps\common\Euro Truck Simulator 2\bin\win_x64\eurotrucks2.exe`** (버전 `1.62.3.3`)였고, `D:\SteamLibrary\...` 쪽에는 `plugins\` 폴더 자체가 없어 플러그인이 로드되지 않고 있었다.

2. **함정 2 — `ETSSharedMemoryMapPlugin64v2.dll` 바이너리 역분석을 통한 정확한 공유 메모리 규격 확보:**
   - 흔히 알려진 `Local\SCSTelemetry`와 달리, 보유 중인 `ETSSharedMemoryMapPlugin64v2.dll`의 PE `.text`/`.rdata` 섹션을 파이썬으로 역분석한 결과 공유 메모리 맵 이름은 **`SCSTelemetrySharedv2`** (`telemetry_state_t_v100`)임을 확인했다.
   - `scs_telemetry_init`의 채널 등록 명령어(`mov qword ptr [rsp+0x20], <offset>`, `mov dword ptr [rsp+0x28], <type>`)를 파싱하여 1바이트 오차 없는 정확한 필드 오프셋 테이블을 추출했다:
     - `0x02d` (45): `local.scale` (float)
     - `0x03d` (61): `job.cargo.damage` (float — 화물 손상률)
     - `0x11d` (285): `truck.world.placement` (`dplacement`: double X,Y,Z + float Heading,Pitch,Roll)
     - `0x145` (325): `truck.local.velocity.linear` (`fvector`: float vx,vy,vz)
     - `0x1bd` (445): `truck.speed` (float, m/s)
     - `0x1c1` (449): `truck.engine.rpm` (float)
     - `0x1c5` (453): `truck.engine.gear` (int32), `0x1c9` (457): `truck.displayed.gear` (int32)
     - `0x1cd`~`0x1d9` (461~473): `truck.input.steering / throttle / brake / clutch` (float)
     - `0x1dd`~`0x1e9` (477~489): `truck.effective.steering / throttle / brake / clutch` (float)
     - `0x1ed` (493): `truck.cruise_control` (float, m/s)
     - `0x1f5` (501): `truck.brake.parking` (bool), `0x1f6` (502): `truck.brake.motor` (bool), `0x1f7` (503): `truck.brake.retarder` (uint32)
     - `0x230` (560): `truck.lblinker` (bool), `0x231` (561): `truck.rblinker` (bool)
     - `0x265` (613): `truck.navigation.distance` (float, 목적지까지 남은 거리 m)
     - `0x269` (617): `truck.navigation.time` (float, 남은 시간 s)
     - `0x26d` (621): `truck.navigation.speed.limit` (float, 현재 도로 제한속도 m/s)

3. **함정 3 — 4K 전체화면(`3840x2160`) 및 인게임 주행 보조 간섭:**
   - `config.cfg`에서 현재 `r_mode_width "3840"`, `r_mode_height "2160"`, `r_fullscreen "1"`, 그리고 인게임 자동 긴급제동 `g_emergency_brake "2"`가 켜져 있음을 확인했다.
   - 자율주행 실험 시에는 HUD 오버레이 공존과 캡처 지연을 위해 보더리스 창 모드(또는 1920x1080/1280x720 캡처 다운스케일)와 인게임 긴급제동 간섭 제어 설정이 필요하다.

4. **함정 4 — 기존 레이싱 휠(`controls.sii`) 바인딩 및 페달 데드존(`10%`):**
   - 활성 프로필(`bb0162`, `steam_profiles\626230313632\controls.sii`)에 DirectInput 레이싱 휠(`VID 346E, PID 0005`, MOZA 휠 베이스)이 `device joy`로 매핑되어 있고, 스로틀·브레이크 데드존(`c_throt_dz`, `c_brake_dz`)이 `0.10(10%)`으로 설정되어 있었다.
   - 가상 Xbox 패드(`ViGEmBus` 미설치 상태 확인)를 연결할 때 기존 휠 설정(`joy`)을 덮어쓰지 않고 보조 장치(`joy2`)로 공존시키며, 제어기 출력에서 10% 데드존을 보상(Deadzone Compensation)해야 미세 가감속이 먹힌다.

> 교훈: 문서를 쓰기 전에 실제 설치 폴더와 바이너리(`.dll`), 설정 파일(`.cfg`, `.sii`)을 먼저 열어보면, 나중에 며칠씩 헤맬 "왜 데이터가 안 들어오지? 왜 브레이크를 5% 밟았는데 차가 안 줄지?" 같은 삽질을 시작 전에 통째로 없앨 수 있다.

## 00:03 (KST, 11-19) — 인게임 연동 상세 결정: 1번 운전석 시점 기본(+6번 범퍼 비교) & MOZA 휠 공존 바인딩

- 사용자 결정:
  1. **카메라 시점:** "(Recommended) 1번 운전석 시점(Interior Camera) 기본 + 6번 범퍼 카메라 비교 지원: 실제 운전 감각과 몰입감을 살리되, 와이퍼/대시보드 가림 영역을 마스킹한 전방 ROI 사용"
  2. **조작 장치 바인딩:** "(Recommended) MOZA 휠(device joy) 유지 + 가상 패드를 보조 슬롯(device joy2)으로 공존 매핑 (스크립트로 controls.sii 자동 백업 후 패치)"
- 이에 따라 인게임 연동 상세 설계서(`docs/superpowers/specs/2026-11-18-ets2-ingame-integration-design.md`)를 작성하여 다음 5가지를 구체화했다:
  1. **플러그인 자동 배포 및 진단 도구(`tools/setup_ets2_integration.py`):** `C:\Program Files (x86)\...`에 있던 `ETSSharedMemoryMapPlugin64v2.dll`을 실제 게임 실행 경로(`D:\SteamLibrary\...\bin\win_x64\plugins\`)로 설치·검증하고 ViGEmBus 드라이버 상태를 점검.
  2. **1번 운전석 시점(`interior`) vs 6번 범퍼 시점(`bumper`) 듀얼 카메라 프리셋:** 해상도 독립적인 정규화 ROI(`[0.0, 1.0]`)와 시점별 대시보드/핸들 마스킹 및 BEV 원근 변환(Homography) 행렬 분리.
  3. **MOZA 휠(`device joy`) + 가상 패드(`device joy2`) 공존 및 운전자 개입 감지(Driver Takeover):** `controls.sii` 백업/패치와 10% 페달 데드존 보상, 그리고 운전자가 실제 MOZA 휠이나 페달을 조작하면 이를 감지해 즉시 자율주행을 해제하는 실차형 제어권 이양(Takeover) 로직.
  4. **인게임 설정 최적화 가이드:** `g_emergency_brake`(인게임 자동 긴급제동 간섭 방지), `g_cam_steering "0"`(조향 시 시선 회전 고정), 보더리스 창 모드 설정.
  5. **대화형 ROI·시점·패드 캘리브레이션 도구(`tools/calibrate_ets2.py`):** 실제 게임 화면 캡처 위에 전방 사다리꼴 ROI와 미니맵 ROI, BEV 변환 결과, 텔레메트리 수신값을 실시간으로 띄워 맞추는 도구.

> 책 소재: 기존에 쓰던 레이싱 휠(MOZA) 설정을 지우지 않고 가상 패드와 나란히 묶어 두니, 자율주행 중에 위험할 때 핸들을 잡거나 브레이크를 밟아 제어권을 가로채는 진짜 자율주행차의 '운전자 개입(Takeover)'까지 자연스럽게 구현할 수 있게 되었다.

## 00:04 (KST, 11-19) — 서브에이전트 Phase 1 계획 수립 및 전체 코어 TDD 구현 완료 보고

- 백그라운드로 위임했던 서브에이전트(`0ba40f7d-2bfe-4ec6-8188-018b9fe0e5b3`)가 Phase 1 구현 계획서와 전체 모듈 TDD 구현 및 검증을 완료했다.
  - **구현 주체:** Gemini 서브에이전트(`self`) — 사용자 지정(1번)
  - **산출물:**
    - 계획서: `docs/superpowers/plans/2026-11-18-phase1-whitebox-platform-plan.md`
    - 코어 패키지: `src/ets_ad/` (`config.py`, `telemetry/`, `capture/`, `perception/`, `decision/`, `control/`, `actuation/`, `hud/`, `recorder/`, `pipeline.py`, `cli.py`)
    - 앞서 역분석해 전달한 `ETSSharedMemoryMapPlugin64v2.dll` (`SCSTelemetrySharedv2`)의 정확한 바이트 오프셋 테이블과 `controls.sii`의 `0.10` 페달 데드존 보상까지 모두 반영됨.
  - **테스트 결과:** `uv run pytest -v` 실행 결과 7개 테스트 파일, **25개 단위/통합 테스트 전체 통과 (`25 passed in 0.54s`)**.
