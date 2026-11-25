# 17장 합치는 순간 터지는 네 개의 지뢰

## 17.1 "근데 화면이 까맣게 나와"

Matter 등록까지 마치고 보드를 본 필자가 말했다.

> "근데 화면이 까맣게 나와"

당연했다. 지금 올라간 것은 화면 드라이버가 없는 Matter 전용 데모(`demos/01_matter`)였다. 10장에서 일부러 모듈마다 데모를 따로 만들었으니, 화면과 Matter와 센서가 한 펌웨어에서 같이 도는 것은 아직 한 번도 없었다.

> "아 그럼 펌웨어 통합까지 하자 워크플로 돌려줘"

확인해 보니 그사이 다른 세션에서 홈서버 센서 API(SCRUM-239, 18장)도 머지되어, **통합 일감(SCRUM-242)의 선행 6건이 모두 끝나 있었다.** 모듈을 합치면 끝날 줄 알았다. 합치는 순간에만 터지는 지뢰가 네 개 있었다.

> **질문 노트** — "근데 화면이 까맣게 나와" → 모듈별 데모(`01_matter`)에는 화면이 빠져 있다. 그걸 하나로 합치는 것이 펌웨어 통합이다.

## 17.2 지뢰 ①: I2C 드라이버 두 개

코드를 합치기 전에 헤더를 읽다가 충돌을 먼저 발견했다(**문헌 기반**, SDK 소스 확인).

| 누가 | 어떤 I2C 드라이버 |
|---|---|
| `ESP32_Display_Panel 1.0.0`(터치 GT911, IO 확장 CH422G) | ESP-IDF **구형** `<driver/i2c.h>` (`i2c_driver_install`) |
| Arduino ESP32 `3.3.12`의 `<Wire.h>`(SHT40, RTC 쪽) | ESP-IDF 5.5의 **신형** `<driver/i2c_master.h>` (`i2c_new_master_bus`) |

ESP-IDF 5.5는 한 바이너리에 신형과 구형 I2C 드라이버가 함께 링크되기만 해도, `setup()`에 들어가기 전에 `CONFLICT! driver_ng is not allowed to be used with the legacy driver`를 띄우고 멈춘다. `02_io`(Wire만 씀)와 `03_ui`(Display Panel만 씀)를 따로 돌릴 때는 드러나지 않는다. **합칠 때만 터지는 버그**다.

해결: SHT40 드라이버, RTC 시계, `02_io`에서 `<Wire.h>`를 걷어내고 `<driver/i2c.h>`로 통일했다. 통합 펌웨어에서는 보드 초기화(`g_board.begin()`)가 이미 열어 둔 `I2C_NUM_0`(SDA=GPIO8, SCL=GPIO9)을 SHT40과 RTC가 함께 쓴다.

> **웹 개발자 시선** — 한 앱에 서로 호환되지 않는 React 17과 18 런타임이 같이 번들되어, 페이지가 뜨기도 전에 죽는 상황이다.

## 17.3 지뢰 ②: 세 태스크의 교차 락

통합 펌웨어에서는 FreeRTOS 태스크 세 개가 동시에 돈다.

1. **CHIP 태스크**: Matter 앱 콜백을 실행한다
2. **LVGL 태스크**: LVGL 뮤텍스를 잡은 채로 터치 콜백을 실행한다
3. **Arduino `loopTask`**: 제어, 센서, NVS, HTTP를 실행한다

Matter 콜백 안에서 LVGL 뮤텍스를 잡거나, 터치 콜백 안에서 Matter API를 부르면 서로를 기다리는 교차 락(데드락)이 생길 수 있다.

해결: 두 콜백은 **값만 적고 바로 돌아간다.** 스핀락(`portMUX_TYPE`)으로 보호한 `PendingMatterEvents`, `PendingUiEvents`에 "무엇이 바뀌었다"만 기록한다. 이벤트를 꺼내 처리하는 것은 `loop()` 하나뿐이다. `loop()`가 이벤트를 순수 C++17 조정자 `src/app/thermostat_app.*`에 넘기면, 조정자가 돌려준 `SyncActions`대로 NVS, Matter, 화면에 반영한다.

조정자가 순수 C++이라 까다로운 동기화를 PC에서 먼저 시험할 수 있었다.

- 앱에서 바꾼 값이 다시 앱으로 되돌아가는 에코 루프 막기
- 앱에서 `Heat`를 골라도 반복 모드 유지하기
- 유지 신호 중에는 화면에 계속 `난방 중`을 보여 주고, Matter에는 잠깐 `대기`를 보내기
- 원격 센서가 3번 연속 실패하면 보드 센서로 바꾸기

`test/test_thermostat_app.cpp` 10/10, 전체 7개 스위트 **93/93 통과**(**실측**).

> **웹 개발자 시선** — 스핀락으로 지킨 대기열 + `loop()` 하나만 소비 = Redux/Flux의 단방향 데이터 흐름이다. 여러 곳에서 상태를 직접 고치지 않고, 액션만 던지면 한 곳에서 처리한다.

## 17.4 지뢰 ③: 한 시간짜리 첫 빌드

주니어(DeepSeek)가 통합 펌웨어 구현, 커밋 3건, 호스트 테스트 93/93을 25분 만에 끝냈다. 그런데 마지막 ESP32 컴파일이 45분이 넘도록 끝나지 않았다.

> "왜이렇게 오래걸려? 좀 있으면 1시간이야."

> "다시 도는건 아니지?"

> "어휴.."

빌드 폴더의 중간 산출물(`.o`, `.libsdetect.d`)과 돌고 있는 `cc1plus` 프로세스를 뜯어보니, 병목 두 개가 겹쳐 있었다(**실측**).

**범인 ① 쓰지 않는 LVGL 예제 500개.** Waveshare 오프라인 묶음의 `lv_conf.h`에 `LV_BUILD_EXAMPLES 1`과 데모 5종(`WIDGETS`, `BENCHMARK`, `STRESS`, `MUSIC`, `KEYPAD`)이 모두 켜져 있었다. `lvgl/src/examples`와 `lvgl/src/demos`에는 쓰지 않는 C 파일이 약 500개 있었다. `03_ui` 혼자 빌드할 때는 포함 경로(`-I`)가 20개뿐이라 금방 끝났다. Matter와 합치자 포함 경로 약 300개 × 파일 약 700개를 전처리하느라 시간이 폭발했다.
- 조치: 전역 라이브러리 폴더는 건드리지 않고, 13장의 프로젝트 전용 sketchbook에만 `examples`와 `demos`를 뺀 가벼운 `lvgl`을 두었다. C 파일이 약 700개에서 **192개**로 줄었다.

**범인 ② `#include <Matter.h>` 한 줄의 위치.** `thermostat_main.ino` 맨 위에 `#include <Matter.h>`가 있었다. Arduino CLI는 라이브러리를 찾을 때 파일을 위에서부터 훑다가, 모르는 헤더를 하나 만날 때마다 **파일 맨 위부터 전처리(`g++ -E`)를 다시 돌린다.** 그래서 아래쪽 라이브러리 15개를 하나씩 찾을 때마다 40초짜리 `<Matter.h>` 전처리를 15번, 10분 넘게 반복하고 있었다.
- 조치: `#include <Matter.h>`와 `#include "thermostat_matter.h"`를 include 목록 맨 끝으로 옮겼다. 11분 동안 하나도 못 찾던 탐지가 5분 만에 뚫렸고, 그 뒤로는 분당 20~25개씩 나아갔다(**실측**).

> **감탄 노트** — `#include` 두 줄을 맨 아래로 옮겼더니, 11분 동안 멈춰 있던 라이브러리 탐지가 5분 만에 뚫렸다.

> **웹 개발자 시선** — LVGL 예제 제외는 `tsconfig`의 `exclude`가 빠져서 `node_modules` 안의 테스트와 스토리북 파일까지 트랜스파일하던 것을 고친 것과 같다.

## 17.5 지뢰 ④: 마지막 1초의 대소문자

모든 파일이 컴파일을 마치고 마지막 링커(`ld.exe`) 단계에 들어간 순간, `multiple definition of ArduinoMatter::...` 오류가 쏟아졌다(**실측**).

원인은 폴더 이름이었다. ESP32 내장 라이브러리 폴더는 `Matter`(대문자 M), 이 프로젝트의 폴더는 `src/matter`(소문자 m)였다. 대소문자를 구분하지 않는 Windows 파일시스템에서는 두 라이브러리의 빌드 결과 `libraries\Matter\objs.a`와 `libraries\matter\objs.a`가 **같은 파일 하나**가 된다. 그런데 `arduino-cli`는 둘을 다른 라이브러리로 보고, 같은 `objs.a`를 링커에 두 번 넘겼다.

해결: `src/matter`를 `src/matter_ep`로 이름을 바꾸고(`git mv`), 모듈 목록 두 줄을 고쳤다. 이미 만들어 둔 `.o` 423개를 그대로 써서 바로 링크에 성공했다.

| 통합 펌웨어(**실측**) | 사용량 |
|---|---|
| 플래시 | 2,324,499바이트 (3MB 앱 파티션의 73%) |
| RAM | 163,664바이트 (327KB의 49%) |

> **웹 개발자 시선** — 리눅스 CI에서는 통과하는데 Windows나 macOS 노트북에서만 파일명 대소문자로 터지는 고전 버그다. 이번에는 반대로 Windows가 둘을 하나로 합쳐 버렸다.

## 17.6 한 몸으로 켜지다

> "머지하고 업로드까지 해줘"

통합 펌웨어를 보드에 14.1초 만에 올리고 부팅 로그를 봤다(**실측**).

```text
[main] SmartThings DIY thermostat - integrated firmware (SCRUM-242)
[main] NVS load status=1
[main] already commissioned
[main] UI ready
[main] SHT40 not detected (graceful skip)
[main] NTP sync started (KST)
[main] RTC saved from system time
```

한 번에 확인된 것이 네 가지다.

1. I2C 드라이버 충돌 패닉이 없다. 17.2의 `<driver/i2c.h>` 통일이 맞았다.
2. `already commissioned`. 16장에서 등록한 SmartThings 연결이 NVS에 남아, 다시 등록하지 않고 Wi-Fi와 Matter에 돌아왔다.
3. `UI ready`. 800×480 터치 화면이 Matter와 함께 떴다.
4. `NTP sync started (KST)` → `RTC saved from system time`. Wi-Fi가 붙자 한국 시각을 받아 보드 RTC에 저장했다.

`demos/02_io`의 구형 I2C 회귀 빌드(플래시 32%, RAM 14%), 호스트 C++ 93/93, 파이썬 도구 테스트 31/31도 통과했다. 마지막에 GitHub의 PR 생성 API가 잠깐 502와 500 오류를 냈다. 필자의 승인을 받아 `main`에 머지 커밋으로 바로 반영했다. 통합에 든 DeepSeek 비용은 약 0.23달러였다(**실측**).

> **감탄 노트** — 통합 펌웨어의 첫 부팅에서 패닉 없이 `already commissioned` → `UI ready` → `NTP sync started (KST)` → `RTC saved`까지 한 번에 지나갔다.

## 알게 된 점

- 따로 잘 도는 모듈을 합칠 때만 나타나는 버그가 있다. 드라이버 버전 충돌, 태스크 사이의 교차 락, 전처리 시간의 곱셈 폭발, OS의 대소문자 무시. 통합은 복사·붙여넣기가 아니라 따로 설계하는 단계다.
- 콜백은 기록만 하고, 처리는 한 곳에서 한다. 그래야 동시성 문제를 PC 테스트로 끌어올 수 있다.
- 빌드가 느리면 기다리지 말고 중간 산출물과 프로세스를 연다. 원인은 보통 "쓰지 않는 것을 처리하는 중"이다.
- 이름은 대소문자만 다르게 짓지 않는다. 내 컴퓨터의 파일시스템이 그 둘을 구분한다는 보장이 없다.
