# 13장 ESP32로 만드는 OBD-II 웹 게이지

## 이 장에서

앞 장까지는 PC와 ELM327로 차량 데이터를 읽었다. 이 장에서는 그 읽기를 **작은 장치**로 옮긴다. ESP32가 차량의 OBD-II 포트에서 직접 CAN 프레임을 받아 엔진 회전수·차속·냉각수 온도를 해석하고, Wi-Fi로 접속한 브라우저에 보여 준다.

ELM327은 OBD-II를 편하게 읽는 도구다. 반면 이 장의 장치는 **원시 CAN 프레임을 직접 다룬다.** 그만큼 배선·전원·종단·타이밍을 직접 책임져야 한다. 대신 어댑터 내부에서 무슨 일이 일어나는지 보이고, 응답이 늦거나 끊길 때 어디를 봐야 하는지 알게 된다.

이 장의 실습은 **정차 상태의 읽기 전용**이다. 장치가 버스에 보내는 것은 OBD-II Mode 01(현재 데이터) 요청뿐이다. DTC 삭제(Mode 04), UDS 쓰기·리셋·액추에이터 구동은 보내지 않는다. 9장의 안전 계약을 먼저 읽고 시작한다.

이 장에서 다루는 것:

- 전체 구조와 필요한 부품
- OBD 포트·CAN 트랜시버·전원 배선
- 종단 저항과 차량 12V 주의
- 벤치에서 listen-only로 첫 프레임 받기
- ESP32 TWAI 설정과 OBD 요청·응답 파싱
- Wi-Fi 웹 화면
- 완성 스케치와 시험 순서
- 아두이노 + MCP2515 대안
- 문제 해결

## 13.1 전체 구조

```text
┌─────────────┐      Wi-Fi      ┌──────────────┐
│  브라우저    │ ◀─────────────▶ │ ESP32        │
│ (휴대폰·PC)  │   HTTP / JSON   │ 웹 서버      │
└─────────────┘                 │ TWAI         │
                                └───┬──────┬───┘
                                    │ TX/RX│ 3.3V
                                ┌───▼──────▼───┐
                                │ SN65HVD230   │
                                │ CAN 트랜시버  │
                                └───┬──────┬───┘
                                    │CANH  │CANL
                    OBD-II 6번 ─────┘      └───── OBD-II 14번
                    OBD-II 16번 +12V ── 퓨즈 ── 12V→5V 강압 ── ESP32 5V
                    OBD-II 4/5번 GND ─────────────────────── 공통 GND
```

- ESP32는 3.3V 논리다. CAN 트랜시버도 **3.3V용(SN65HVD230 등)** 을 쓴다. 5V 전용 트랜시버(TJA1050, MCP2551 등)를 레벨 시프터 없이 직결하면 ESP32 입력이 손상될 수 있다.
- 차량 OBD 포트의 16번은 배터리 +12V다. ESP32에 직접 연결하지 않고, **퓨즈 → 12V→5V 강압 모듈 → ESP32 5V** 순서로 넣는다.
- CAN_H/CAN_L은 꼬인 선(twisted pair)으로 짧게 연결한다. 접지선도 함께 지나가게 한다.
- 차량 버스는 이미 양 끝이 종단되어 있다. **차량에는 120Ω을 추가하지 않는다.** 벤치에서만 종단을 붙인다.

### 필요한 것

| 부품 | 비고 |
|---|---|
| ESP32 개발 보드 | TWAI(CAN) 컨트롤러 내장. Arduino-ESP32 코어 사용 |
| 3.3V CAN 트랜시버 모듈 | SN65HVD230 계열. 5V 전용이면 레벨 시프터 필요 |
| OBD-II 커넥터/브레이크아웃 | 16핀 J1962. 케이블형이 배선하기 편함 |
| 퓨즈 + 퓨즈 홀더 | 16번 전원 보호. 정격은 소비전류와 배선 허용전류로 계산 |
| 12V→5V 강압 모듈 | 입력 범위·출력 전류 확인. 차량 과도 전압 대비 |
| 멀티미터 | 도통·전압·종단 확인 |
| (벤치용) USB-CAN 어댑터 | CANable 등 SocketCAN/SLCAN 지원 제품 |
| (벤치용) 120Ω 저항 2개 | 벤치 버스 양 끝 종단 |
| 점퍼선·커넥터·케이스 | 12V 배선은 브레드보드보다 단자·커넥터 권장 |

### 이 장에서 만들지 않는 것

- CAN 트래픽을 조작하거나 다른 ECU를 제어하는 장치
- DTC를 지우거나 UDS 세션을 바꾸는 기능
- 차량에 영구 설치하는 제품 수준의 전원·보호 회로
- 주행 중 사용하는 화면

이 장의 장치는 **정차 중 데이터 읽기**까지다. 그 이상은 9장의 경고를 다시 읽고, 제조사 문서와 전문가의 검토를 먼저 받는다.

## 13.2 배선

### OBD-II 커넥터

OBD-II 16핀 커넥터에서 이 장치가 쓰는 핀은 다음뿐이다.

| OBD 핀 | 신호 | 연결 |
|---|---|---|
| 6 | CAN-H | 트랜시버 CANH |
| 14 | CAN-L | 트랜시버 CANL |
| 16 | 배터리 +12V | 퓨즈 → 강압 모듈 입력 + |
| 4 | chassis ground | 강압 모듈 입력 −, 공통 GND |
| 5 | signal ground | 공통 GND |

- 6/14번이 CAN이다. 7/15번 K-line, 2/10번 J1850 등은 이 장치가 쓰지 않는다. **나머지 핀을 임의로 프로빙하지 않는다.**
- 4번과 5번은 차량 내부에서 연결되어 있을 수 있지만, 항상 그런 것은 아니다. 멀티미터로 도통을 확인하고, 둘 다 공통 GND에 연결한다.
- 16번은 시동 스위치와 무관하게 배터리 전원이 남아 있을 수 있다. 배선을 만질 때는 **OBD 커넥터를 뽑고** 작업한다.
- 16번에서 직접 ESP32의 5V 핀으로 선을 끌지 않는다. 반드시 퓨즈와 강압 모듈을 거친다.

### ESP32와 트랜시버

공식 Arduino-ESP32 TWAI 예제는 SN65HVD230을 예로 들고, RX=GPIO21, TX=GPIO22를 쓴다. 핀 번호는 보드마다 다를 수 있으므로 **사용하는 보드의 핀아웃으로 확인**한다.

| ESP32 | SN65HVD230 모듈 | 비고 |
|---|---|---|
| GPIO21 | RXD | ESP32가 받는 선. 트랜시버의 수신 출력 |
| GPIO22 | TXD | ESP32가 보내는 선. 트랜시버의 송신 입력 |
| 3.3V | VCC | SN65HVD230은 3.3V |
| GND | GND | 공통 접지 |
| — | CANH | OBD 6번 |
| — | CANL | OBD 14번 |

- 모듈 표기가 `TX`/`RX`인지 `TXD`/`RXD`인지 확인한다. ESP32의 TX는 트랜시버의 TXD(입력)로, ESP32의 RX는 트랜시버의 RXD(출력)로 간다. **같은 이름끼리 직결하는 것이 아니다.**
- 모듈에 `RS`(slope control) 핀이 있으면 데이터시트의 권장 회로를 따른다. 임의로 생략하지 않는다.
- 5V 전용 트랜시버를 쓸 때는 TXD/RXD 레벨 시프터를 넣는다. 3.3V CAN 트랜시버가 가장 단순하다.

### 종단 저항

CAN 버스는 양 끝이 120Ω으로 종단되어야 한다. 차량 버스에는 이미 종단이 있으므로 **추가하지 않는다.**

- 차량 전원을 끄고 OBD 6/14번 사이 저항을 잰다. 약 60Ω이면 양 끝 120Ω이 병렬로 보이는 정상 상태다.
- 120Ω이 나오면 한쪽 종단이 없거나 측정 위치가 다를 수 있다. 그래도 차량에 임의로 저항을 추가하지 말고 정비 문서를 확인한다.
- 벤치에서는 노드 두 개를 양 끝에 두고 각각 120Ω을 붙인다. 노드 하나만 있을 때는 그 노드에 120Ω 하나를 붙여 시험할 수 있지만, 실제 버스와 같은 조건은 아니다.
- MCP2515 모듈처럼 보드에 120Ω 저항이 붙은 제품은 차량에 연결하기 전에 **점퍼/저항을 제거하거나 분리**한다. 그대로 두면 차량 종단과 병렬이 되어 버스가 불안정해진다.

### 전원과 과도 전압

차량의 12V는 "깨끗한 12V"가 아니다. 시동·충전·점프·부하 차단 때 전압이 크게 흔들린다. 자동차 전장에서는 배터리와 발전기가 분리될 때 수십 V의 과도 전압(load dump)이 생길 수 있고, 12V 차량에서는 보통 40V 수준으로 클램프된다고 알려져 있다. 출처에 따라 최대 120V까지 표현하기도 한다.

따라서:

- ESP32 개발 보드를 12V에 직접 연결하지 않는다.
- 퓨즈를 넣고, 입력 범위가 넓은 자동차용 강압 모듈을 쓴다.
- 가능하면 TVS 다이오드·과전압 보호가 있는 모듈을 쓴다.
- 첫 시험은 USB 전원으로 하고, 차량 전원은 마지막에 연결한다.
- 장치를 꽂아 둔 채로 두면 배터리가 소모된다. 사용하지 않을 때는 분리한다.
- 12V 배선은 브레드보드에 꽂지 않는다. 단자대·커넥터·절연 튜브를 쓴다.

퓨즈 정격은 "이 정도면 된다"는 숫자를 그대로 쓰지 않는다. 장치의 최대 소비전류를 재고, 배선의 허용전류와 강압 모듈의 정격을 확인해 **최대 소비전류보다 크고 배선 허용전류보다 작은 값**을 고른다. 애매하면 전기·자동차 전문가에게 확인한다.

## 13.3 벤치에서 먼저

차량에 바로 꽂지 않는다. 벤치에서 CAN 프레임을 주고받을 수 있게 만든 뒤 차량으로 간다.

### 벤치 구성

```text
[ESP32 + SN65HVD230] ── CANH/CANL ── [USB-CAN 어댑터]
        │                                   │
       120Ω                                120Ω
        │                                   │
       GND ─────────────────────────────── GND
```

- 양 끝에 120Ω을 둔다.
- ESP32는 USB로, USB-CAN은 PC USB로 전원을 공급한다. 공통 GND를 연결한다.
- PC에서는 SocketCAN(`can0`) 또는 SLCAN(`/dev/ttyACM0`, Windows COM)으로 인터페이스를 올린다.
- CAN을 보내는 쪽과 받는 쪽이 모두 있어야 ACK가 성립한다. listen-only 노드만 있으면 송신이 ACK 오류로 실패할 수 있다. 벤치에는 **정상 모드 노드를 하나 이상** 둔다.

### 1단계: 수신만 하기

ESP32를 normal mode로 두되 요청은 보내지 않는다. normal mode는 수신한 프레임에 ACK를 보내므로, PC가 보낸 프레임이 ACK 오류 없이 완료된다. 차량처럼 다른 노드가 ACK를 대신해 주는 환경에서 **수동 관찰만** 할 때는 listen-only를 쓴다.

```cpp
#include <Arduino.h>
#include "driver/twai.h"

#define RX_PIN 21
#define TX_PIN 22

void setup() {
  Serial.begin(115200);

  twai_general_config_t g_config = TWAI_GENERAL_CONFIG_DEFAULT(
      (gpio_num_t)TX_PIN, (gpio_num_t)RX_PIN, TWAI_MODE_NORMAL);
  twai_timing_config_t t_config = TWAI_TIMING_CONFIG_500KBITS();
  twai_filter_config_t f_config = TWAI_FILTER_CONFIG_ACCEPT_ALL();

  if (twai_driver_install(&g_config, &t_config, &f_config) != ESP_OK) {
    Serial.println("TWAI 드라이버 설치 실패");
    return;
  }
  if (twai_start() != ESP_OK) {
    Serial.println("TWAI 시작 실패");
    return;
  }
  Serial.println("수신 전용 시작 (요청은 보내지 않음)");
}

void loop() {
  twai_message_t msg;
  if (twai_receive(&msg, pdMS_TO_TICKS(1000)) != ESP_OK) {
    return;
  }
  Serial.printf("%03X [%d]", msg.identifier, msg.data_length_code);
  for (int i = 0; i < msg.data_length_code; i++) {
    Serial.printf(" %02X", msg.data[i]);
  }
  Serial.println();
}
```

PC에서 가짜 OBD 응답을 보낸다.

```bash
# Linux SocketCAN
cansend can0 7E8#04410C1AF8CCCCCC

# SLCAN이면 python-can으로 같은 프레임을 보낸다
python - <<'PY'
import can
bus = can.Bus(interface="slcan", channel="COM8", bitrate=500000)
bus.send(can.Message(arbitration_id=0x7E8, is_extended_id=False,
                     data=bytes.fromhex("04 41 0C 1A F8 CC CC CC")))
bus.shutdown()
PY
```

ESP32 시리얼에 `7E8 [8] 04 41 0C 1A F8 CC CC CC`가 찍히면 물리 계층과 프레임 수신이 정상이다.

벤치에서 ESP32를 listen-only로 두면 ACK할 노드가 없어 PC의 `cansend`가 ACK 오류로 실패할 수 있다. 이때는 ESP32를 normal mode로 두거나, 정상 모드 노드를 하나 더 붙인다. listen-only는 차량처럼 ACK를 대신해 주는 다른 ECU가 있을 때 수동 관찰용으로 쓴다.

- `0x7E8`은 엔진 ECU의 OBD 응답 주소다.
- `04`는 ISO-TP Single Frame의 길이 4다.
- `41 0C 1A F8`은 Mode 01 PID 0C(rpm) 응답이다.
- `CC`는 패딩이다.

### 2단계: 요청 보내기

listen-only 모드에서는 요청을 보낼 수 없다. `TWAI_MODE_NORMAL`로 바꾸고 `7DF`로 요청을 보낸다. PC의 `candump`로 ESP32가 보낸 프레임을 확인하고, PC가 `7E8` 응답을 돌려준다.

```text
ESP32 → 7DF  [8] 02 01 0C CC CC CC CC CC
PC    → 7E8  [8] 04 41 0C 1A F8 CC CC CC
```

- `02` = Single Frame, 길이 2
- `01` = Mode 01
- `0C` = PID 0C
- 나머지는 패딩

요청과 응답이 오가면 3단계에서 웹 화면을 붙인다.

### 3단계: 차량에서

차량에서는 다음 순서를 지킨다.

1. 차량을 정차하고 P, 주차 브레이크를 확인한다.
2. OBD 커넥터를 뽑은 상태에서 배선·퓨즈·극성을 확인한다.
3. 6/14번 저항을 재서 차량 종단을 확인한다.
4. ESP32를 USB 전원으로 켜고 listen-only로 프레임이 보이는지 확인한다.
5. 정상 모드로 바꿔 Mode 01 요청을 보낸다.
6. 값이 계기판과 맞는지 확인한다.
7. 장치를 분리하고 배선을 정리한다.

차량에서 listen-only로 아무 프레임도 보이지 않으면, 시동 상태(ACC/ON/엔진 시동)와 CAN 핀, 비트레이트를 확인한다. 일부 차량은 게이트웨이가 진단 요청 전까지 버스를 조용히 유지한다. 이때는 정상 모드로 요청을 보내야 응답이 올 수 있다. 그래도 안 되면 7장의 ELM327 점검 순서로 돌아가 차량 자체의 OBD 응답을 먼저 확인한다.

## 13.4 TWAI 설정과 OBD 요청

### TWAI 초기화

```cpp
bool twaiBegin() {
  twai_general_config_t g_config = TWAI_GENERAL_CONFIG_DEFAULT(
      (gpio_num_t)TX_PIN, (gpio_num_t)RX_PIN, TWAI_MODE_NORMAL);
  twai_timing_config_t t_config = TWAI_TIMING_CONFIG_500KBITS();
  twai_filter_config_t f_config = TWAI_FILTER_CONFIG_ACCEPT_ALL();

  if (twai_driver_install(&g_config, &t_config, &f_config) != ESP_OK) {
    return false;
  }
  if (twai_start() != ESP_OK) {
    return false;
  }
  return true;
}
```

- `TWAI_GENERAL_CONFIG_DEFAULT(TX, RX, MODE)`의 순서는 **TX가 먼저**다. 공식 예제와 같은 순서인지 확인한다.
- `TWAI_TIMING_CONFIG_500KBITS()`는 쏘렌토 OBD CAN과 같은 500kbps 설정이다. 차량 버스가 250kbps라면 다른 매크로를 쓴다.
- `TWAI_FILTER_CONFIG_ACCEPT_ALL()`은 모든 프레임을 받는다. 처음에는 필터를 열어 두고, 동작을 확인한 뒤 필요한 ID만 받는다.
- ESP-IDF의 최신 버전은 `twai_node_*`라는 새 API를 제공한다. Arduino-ESP32 코어에 포함된 예제와 API가 다를 수 있으므로, 컴파일 오류가 나면 사용하는 코어 버전의 공식 예제를 확인한다.

### 요청 프레임

```cpp
void requestPid(uint8_t pid) {
  twai_message_t msg = {};
  msg.identifier = 0x7DF;          // 기능 주소: 모든 OBD ECU
  msg.extd = 0;                    // 11비트 표준 ID
  msg.rtr = 0;
  msg.data_length_code = 8;
  msg.data[0] = 0x02;              // ISO-TP SF, 길이 2
  msg.data[1] = 0x01;              // Mode 01
  msg.data[2] = pid;
  for (int i = 3; i < 8; i++) {
    msg.data[i] = 0xCC;            // 패딩
  }
  twai_transmit(&msg, pdMS_TO_TICKS(20));
}
```

- OBD-II 요청은 `7DF`(기능 주소)로 보낸다. 엔진 ECU는 `7E8`로 응답한다.
- 한 번에 PID 하나를 요청한다. 여러 PID를 묶는 방법은 7.3절에 있다.
- 요청 주기를 너무 짧게 하지 않는다. 이 장의 예제는 200ms 간격으로 세 PID를 번갈아 읽는다.
- 응답이 없을 때 재시도는 1~2회로 제한한다. 무한 재시도는 버스와 어댑터에 부담을 준다.

### 응답 파싱

```cpp
void handleFrame(const twai_message_t &msg) {
  if (msg.extd || msg.rtr) return;
  if (msg.identifier != 0x7E8) return;      // 엔진 ECU 응답만
  if (msg.data_length_code < 4) return;

  const uint8_t *d = msg.data;
  if ((d[0] >> 4) != 0) return;             // Single Frame만 처리
  uint8_t len = d[0] & 0x0F;
  if (len < 3 || len > 7) return;
  if (d[1] != 0x41) return;                 // Mode 01 긍정 응답

  uint8_t pid = d[2];
  const uint8_t *p = &d[3];

  if (pid == 0x0C && len >= 4) {
    g_rpm = ((p[0] << 8) | p[1]) / 4.0f;
  } else if (pid == 0x0D && len >= 3) {
    g_speed = p[0];
  } else if (pid == 0x05 && len >= 3) {
    g_coolant = (int)p[0] - 40;
  } else {
    return;
  }
  g_lastUpdate = millis();
}
```

- `41`은 Mode 01의 긍정 응답이다. `41` 뒤의 PID가 요청한 PID와 같은지 확인한다.
- ISO-TP SF의 길이 필드는 **PCI 뒤에 오는 데이터 바이트 수**다. `04 41 0C 1A F8`이면 길이 4, 데이터는 `41 0C 1A F8`이다.
- 긴 응답(FF/CF)은 이 코드에서 처리하지 않는다. VIN처럼 8바이트를 넘는 응답은 3장의 ISO-TP 조립 코드를 붙인다. 이 장의 세 PID는 모두 Single Frame이다.
- `0x7E8`만 받도록 필터링했다. 기능 주소로 요청하면 다른 ECU가 `7E9` 등으로 응답할 수 있으므로, 엔진 값만 필요하면 `7E8`을 확인한다.

### 버스 상태와 복구

TWAI는 오류 카운터와 상태를 제공한다.

```cpp
void checkBus() {
  twai_status_info_t status;
  if (twai_get_status_info(&status) != ESP_OK) return;

  if (status.state == TWAI_STATE_BUS_OFF) {
    g_busOk = false;
    twai_initiate_recovery();
  } else if (status.state == TWAI_STATE_STOPPED) {
    twai_start();
  }

  if (status.tx_error_counter > 0 || status.rx_error_counter > 0) {
    Serial.printf("TEC=%lu REC=%lu bus_errors=%lu\n",
                  (unsigned long)status.tx_error_counter,
                  (unsigned long)status.rx_error_counter,
                  (unsigned long)status.bus_error_count);
  }
}
```

- TEC/REC가 증가하면 배선·종단·비트레이트를 먼저 의심한다.
- Bus-Off는 전송 오류가 누적된 상태다. 복구 절차를 넣지 않으면 장치가 조용히 멈춘다.
- `TWAI_STATE_RECOVERING`에서는 `twai_start()`를 호출하지 않는다. 상태를 확인하고 복구가 끝난 뒤 시작한다.
- 오류 로그에는 시각·TEC·REC·bus_errors를 남긴다. "통신이 안 된다"보다 훨씬 유용하다.

## 13.5 Wi-Fi 웹 화면

ESP32의 `WebServer`로 JSON API와 HTML을 제공한다. 브라우저는 500ms마다 `/api`를 폴링한다.

```cpp
#include <WiFi.h>
#include <WebServer.h>

const char *WIFI_SSID = "YOUR_WIFI_SSID";
const char *WIFI_PASS = "YOUR_WIFI_PASSWORD";

WebServer server(80);

void handleApi() {
  char buf[256];
  snprintf(buf, sizeof(buf),
           "{\"rpm\":%s,\"speed\":%s,\"coolant\":%s,"
           "\"age_ms\":%lu,\"requests\":%lu,\"responses\":%lu,"
           "\"timeouts\":%lu,\"bus_ok\":%s}",
           isnan(g_rpm) ? "null" : String(g_rpm, 1).c_str(),
           isnan(g_speed) ? "null" : String(g_speed).c_str(),
           isnan(g_coolant) ? "null" : String(g_coolant).c_str(),
           (unsigned long)(g_lastUpdate ? millis() - g_lastUpdate : 0),
           (unsigned long)g_requests,
           (unsigned long)g_responses,
           (unsigned long)g_timeouts,
           g_busOk ? "true" : "false");
  server.send(200, "application/json", buf);
}
```

- 실제 SSID/비밀번호를 코드에 커밋하지 않는다. `secrets.h` 같은 별도 파일에 두고 `.gitignore`에 넣거나, 빌드 시 정의한다.
- 웹 서버는 같은 Wi-Fi의 브라우저에서만 접근한다. 공유기 포트 포워딩으로 인터넷에 노출하지 않는다.
- 인증이 없는 읽기 전용 화면이다. 외부 네트워크에 열지 않는다.
- `snprintf`의 `%s`에 `String(...).c_str()`을 넘길 때는 임시 객체의 수명이 해당 문장 끝까지이므로 안전하다. 더 명확하게 하려면 값을 먼저 `char` 배열로 만든다.
- `isnan()`은 `<math.h>` 또는 Arduino 코어에서 사용할 수 있다. 컴파일 오류가 나면 `#include <math.h>`를 추가한다.

HTML은 최소한으로 만든다.

```cpp
const char INDEX_HTML[] PROGMEM = R"rawliteral(
<!doctype html>
<html lang="ko">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OBD-II 웹 게이지</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; background:#0f1419; color:#e6edf3;
         margin:0; padding:24px; }
  h1 { font-size:20px; margin:0 0 16px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; }
  .card { background:#161b22; border:1px solid #30363d; border-radius:12px; padding:16px; }
  .label { color:#8b949e; font-size:13px; }
  .value { font-size:34px; font-weight:700; font-variant-numeric:tabular-nums; }
  .unit { color:#8b949e; font-size:14px; margin-left:4px; }
  #status { margin-top:16px; color:#8b949e; font-size:13px; }
  #status.err { color:#f85149; }
</style>
<main>
  <h1>OBD-II 웹 게이지</h1>
  <div class="grid">
    <div class="card"><div class="label">엔진 회전수</div>
      <div><span class="value" id="rpm">--</span><span class="unit">rpm</span></div></div>
    <div class="card"><div class="label">차속</div>
      <div><span class="value" id="speed">--</span><span class="unit">km/h</span></div></div>
    <div class="card"><div class="label">냉각수</div>
      <div><span class="value" id="coolant">--</span><span class="unit">°C</span></div></div>
  </div>
  <p id="status">연결 중…</p>
</main>
<script>
async function tick() {
  const status = document.getElementById("status");
  try {
    const res = await fetch("/api", { cache: "no-store" });
    const d = await res.json();
    for (const key of ["rpm", "speed", "coolant"]) {
      document.getElementById(key).textContent =
        d[key] === null ? "--" : Number(d[key]).toFixed(key === "rpm" ? 0 : 1);
    }
    status.className = d.bus_ok ? "" : "err";
    status.textContent = (d.bus_ok ? "업데이트 " : "응답 없음 · ") +
      (d.age_ms / 1000).toFixed(1) + "초 전";
  } catch (e) {
    status.className = "err";
    status.textContent = "오류: " + e.message;
  }
}
setInterval(tick, 500);
tick();
</script>
</html>
)rawliteral";
```

- `PROGMEM`은 플래시에 문자열을 둔다. ESP32에서는 `PROGMEM`이 필수는 아니지만, 큰 HTML을 RAM에 두지 않는 습관은 좋다.
- `rawliteral` 구분자는 HTML 안에 `)rawliteral"`이 없도록 고른다.
- 화면에는 현재 값만 표시하고, VIN·주행거리·위치를 넣지 않는다.
- 값이 `--`로 남으면 CAN 응답이 없는 것이다. Wi-Fi 문제와 CAN 문제를 구분해서 본다.

## 13.6 완성 스케치

아래는 세 PID를 번갈아 요청하고, 웹 화면과 JSON을 제공하는 최소 스케치다. Wi-Fi SSID/비밀번호는 자리표시자다.

```cpp
#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <math.h>
#include "driver/twai.h"

// 실제 값을 커밋하지 않는다. secrets.h 등으로 분리한다.
const char *WIFI_SSID = "YOUR_WIFI_SSID";
const char *WIFI_PASS = "YOUR_WIFI_PASSWORD";

#define RX_PIN 21
#define TX_PIN 22
#define OBD_REQUEST_ID 0x7DF
#define ENGINE_RESPONSE_ID 0x7E8
#define REQUEST_INTERVAL_MS 200
#define RESPONSE_TIMEOUT_MS 500

// 13.5절의 카드 HTML로 바꾸면 보기 좋아진다. 여기서는 컴파일되는 최소 HTML을 둔다.
const char INDEX_HTML[] PROGMEM = R"rawliteral(
<!doctype html>
<html lang="ko">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OBD-II 웹 게이지</title>
<h1>OBD-II 웹 게이지</h1>
<pre id="values">--</pre>
<script>
setInterval(async () => {
  const res = await fetch("/api", { cache: "no-store" });
  document.getElementById("values").textContent =
    JSON.stringify(await res.json(), null, 2);
}, 500);
</script>
</html>
)rawliteral";

WebServer server(80);

float g_rpm = NAN;
float g_speed = NAN;
float g_coolant = NAN;
uint32_t g_lastUpdate = 0;
uint32_t g_lastRequest = 0;
uint32_t g_lastResponse = 0;
uint32_t g_requests = 0;
uint32_t g_responses = 0;
uint32_t g_timeouts = 0;
bool g_busOk = false;
bool g_twaiReady = false;

const uint8_t PIDS[] = {0x0C, 0x0D, 0x05};
const size_t PID_COUNT = sizeof(PIDS) / sizeof(PIDS[0]);
size_t g_pidIndex = 0;

bool twaiBegin() {
  twai_general_config_t g_config = TWAI_GENERAL_CONFIG_DEFAULT(
      (gpio_num_t)TX_PIN, (gpio_num_t)RX_PIN, TWAI_MODE_NORMAL);
  twai_timing_config_t t_config = TWAI_TIMING_CONFIG_500KBITS();
  twai_filter_config_t f_config = TWAI_FILTER_CONFIG_ACCEPT_ALL();

  if (twai_driver_install(&g_config, &t_config, &f_config) != ESP_OK) {
    return false;
  }
  return twai_start() == ESP_OK;
}

void requestPid(uint8_t pid) {
  twai_message_t msg = {};
  msg.identifier = OBD_REQUEST_ID;
  msg.extd = 0;
  msg.rtr = 0;
  msg.data_length_code = 8;
  msg.data[0] = 0x02;
  msg.data[1] = 0x01;
  msg.data[2] = pid;
  for (int i = 3; i < 8; i++) msg.data[i] = 0xCC;

  if (twai_transmit(&msg, pdMS_TO_TICKS(20)) == ESP_OK) {
    g_requests++;
  }
}

void handleFrame(const twai_message_t &msg) {
  if (msg.extd || msg.rtr) return;
  if (msg.identifier != ENGINE_RESPONSE_ID) return;
  if (msg.data_length_code < 4) return;

  const uint8_t *d = msg.data;
  if ((d[0] >> 4) != 0) return;
  uint8_t len = d[0] & 0x0F;
  if (len < 3 || len > 7) return;
  if (d[1] != 0x41) return;

  uint8_t pid = d[2];
  const uint8_t *p = &d[3];

  if (pid == 0x0C && len >= 4) {
    g_rpm = ((p[0] << 8) | p[1]) / 4.0f;
  } else if (pid == 0x0D && len >= 3) {
    g_speed = p[0];
  } else if (pid == 0x05 && len >= 3) {
    g_coolant = (int)p[0] - 40;
  } else {
    return;
  }

  g_lastUpdate = millis();
  g_lastResponse = millis();
  g_responses++;
  g_busOk = true;
}

void checkBus() {
  twai_status_info_t status;
  if (twai_get_status_info(&status) != ESP_OK) return;

  if (status.state == TWAI_STATE_BUS_OFF) {
    g_busOk = false;
    twai_initiate_recovery();
  } else if (status.state == TWAI_STATE_STOPPED) {
    twai_start();
  }
}

String makeJson() {
  char buf[256];
  snprintf(buf, sizeof(buf),
           "{\"rpm\":%s,\"speed\":%s,\"coolant\":%s,"
           "\"age_ms\":%lu,\"requests\":%lu,\"responses\":%lu,"
           "\"timeouts\":%lu,\"bus_ok\":%s}",
           isnan(g_rpm) ? "null" : String(g_rpm, 1).c_str(),
           isnan(g_speed) ? "null" : String(g_speed).c_str(),
           isnan(g_coolant) ? "null" : String(g_coolant).c_str(),
           (unsigned long)(g_lastUpdate ? millis() - g_lastUpdate : 0),
           (unsigned long)g_requests,
           (unsigned long)g_responses,
           (unsigned long)g_timeouts,
           g_busOk ? "true" : "false");
  return String(buf);
}

void handleRoot() {
  server.send_P(200, "text/html", INDEX_HTML);
}

void handleApi() {
  server.send(200, "application/json", makeJson());
}

void setup() {
  Serial.begin(115200);
  delay(200);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(250);
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("http://");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("Wi-Fi 연결 실패: CAN 수신은 계속 시도한다");
  }

  g_twaiReady = twaiBegin();
  Serial.println(g_twaiReady ? "TWAI 시작" : "TWAI 초기화 실패");

  server.on("/", handleRoot);
  server.on("/api", handleApi);
  server.begin();
  Serial.println("HTTP 서버 시작");
}

void loop() {
  server.handleClient();

  uint32_t now = millis();
  if (g_twaiReady && now - g_lastRequest >= REQUEST_INTERVAL_MS) {
    g_lastRequest = now;
    requestPid(PIDS[g_pidIndex]);
    g_pidIndex = (g_pidIndex + 1) % PID_COUNT;
  }

  if (g_twaiReady) {
    twai_message_t rx;
    while (twai_receive(&rx, 0) == ESP_OK) {
      handleFrame(rx);
    }
    checkBus();
  }

  if (g_lastUpdate && now - g_lastUpdate > 2000) {
    g_busOk = false;
  }
  if (g_lastRequest && g_lastResponse < g_lastRequest &&
      now - g_lastRequest > RESPONSE_TIMEOUT_MS) {
    g_timeouts++;
    g_lastResponse = now;       // 같은 요청을 여러 번 세지 않는다
  }

  delay(1);
}
```

- `INDEX_HTML`은 13.5절의 HTML을 같은 파일 위쪽에 둔다.
- `Wi-Fi 연결 실패`여도 CAN 루프는 돈다. 웹 화면이 필요하면 재부팅하거나 Wi-Fi 재연결 코드를 추가한다.
- `delay(1)`은 `server.handleClient()`가 너무 자주 돌지 않게 하면서 CAN 요청 주기를 유지한다. `delay(500)`처럼 길게 잡으면 웹 응답이 느려진다.
- Bus-Off 복구는 `checkBus()`에서 시도한다. 복구가 반복되면 배선·종단·비트레이트를 먼저 고친다.
- 요청 타임아웃 카운터는 "응답이 한 번도 없을 때"를 세는 단순 구현이다. PID별 통계가 필요하면 PID마다 마지막 요청·응답 시각을 따로 둔다.

### 시험 순서

1. **컴파일**: Arduino IDE에서 ESP32 보드를 고르고, `driver/twai.h`가 포함된 코어인지 확인한다.
2. **벤치 수신**: listen-only 스케치로 PC가 보낸 `7E8` 프레임이 시리얼에 찍히는지 본다.
3. **벤치 요청**: 정상 모드로 바꿔 `7DF` 요청이 `candump`에 보이고, PC가 `7E8` 응답을 돌려주는지 본다.
4. **웹 화면**: 차량 없이 `g_rpm` 등을 가짜 값으로 채워 브라우저에 표시되는지 본다.
5. **차량 listen-only**: 차량에서 프레임이 보이는지 확인한다.
6. **차량 요청**: Mode 01 요청을 보내고, 값이 계기판과 맞는지 확인한다.
7. **장시간**: 10~30분 두고 응답 끊김·Bus-Off·Wi-Fi 끊김을 확인한다.

## 13.7 아두이노 + MCP2515 대안

ESP32 대신 아두이노 우노와 MCP2515 모듈을 쓸 수도 있다. MCP2515는 SPI-CAN 컨트롤러이고, MCP_CAN 라이브러리로 제어한다.

### 배선

| 아두이노 우노 | MCP2515 모듈 | 비고 |
|---|---|---|
| 5V | VCC | 모듈 전압 확인. 3.3V 모듈이면 3.3V |
| GND | GND | 공통 접지 |
| 10 | CS | 라이브러리 예제의 기본 CS |
| 2 | INT | 라이브러리 예제의 기본 INT |
| 11 | SI (MOSI) | 우노 하드웨어 SPI |
| 12 | SO (MISO) | 우노 하드웨어 SPI |
| 13 | SCK | 우노 하드웨어 SPI |
| — | CANH | OBD 6번 |
| — | CANL | OBD 14번 |

- 우노 R3의 하드웨어 SPI 핀은 11(MOSI)/12(MISO)/13(SCK)이다. 보드 실크와 공식 핀아웃으로 다시 확인한다.
- MCP2515 모듈의 크리스탈이 8MHz인지 16MHz인지 확인한다. `MCP_CAN::begin()`의 클록 인자와 맞춰야 한다.
- 모듈에 120Ω 종단 저항이나 점퍼가 있으면 차량 연결 전에 제거한다.
- MCP2515는 5V 모듈이 많다. ESP32와 함께 쓸 때는 3.3V 모듈이거나 레벨 시프터가 필요하다.

### 읽기 코드

```cpp
#include <SPI.h>
#include <mcp_can.h>

#define CAN_CS 10
#define CAN_INT 2

MCP_CAN CAN0(CAN_CS);

void setup() {
  Serial.begin(115200);
  if (CAN0.begin(MCP_ANY, CAN_500KBPS, MCP_8MHZ) != CAN_OK) {
    Serial.println("MCP2515 초기화 실패: 크리스탈·배선 확인");
    return;
  }
  CAN0.setMode(MCP_NORMAL);
  pinMode(CAN_INT, INPUT);
}

void requestPid(byte pid) {
  byte req[8] = {0x02, 0x01, pid, 0xCC, 0xCC, 0xCC, 0xCC, 0xCC};
  CAN0.sendMsgBuf(0x7DF, 0, 8, req);
}

void loop() {
  requestPid(0x0C);
  delay(200);

  unsigned long rxId;
  byte len = 0;
  byte buf[8];
  if (CAN0.checkReceive() == CAN_MSGAVAIL) {
    CAN0.readMsgBuf(&rxId, &len, buf);
    if ((rxId & 0x1FFFFFFF) == 0x7E8 && len >= 4 &&
        (buf[0] >> 4) == 0 && buf[1] == 0x41 && buf[2] == 0x0C) {
      float rpm = ((buf[3] << 8) | buf[4]) / 4.0f;
      Serial.println(rpm);
    }
  }
}
```

- `MCP_8MHZ`/`MCP_16MHZ`는 모듈의 크리스탈에 맞춘다. 예제는 8MHz 기준이다.
- `sendMsgBuf(0x7DF, 0, 8, req)`의 두 번째 인자 `0`은 표준 ID를 뜻한다.
- `checkReceive()`/`readMsgBuf()`는 라이브러리 버전에 따라 이름이 다를 수 있다. 사용하는 라이브러리의 예제를 확인한다.
- 이 경로는 웹 화면 대신 시리얼 출력까지다. 웹으로 보내려면 ESP32 경로를 쓰거나, 우노에 Wi-Fi 모듈을 붙여 같은 JSON 구조를 만든다.

## 13.8 문제 해결

| 증상 | 원인 후보 | 확인 | 조치 |
|---|---|---|---|
| 시리얼에 프레임이 없음 | CANH/CANL 반전, 종단 없음, 비트레이트 불일치 | 멀티미터 도통, 6/14 저항, `ATDPN`/버스 속도 | 배선 교차, 벤치 120Ω, 500k 설정 |
| `TWAI 드라이버 설치 실패` | 핀 충돌, 이미 설치됨, 코어 API 불일치 | 사용 GPIO, 부팅 로그 | 다른 GPIO, 리셋, 코어 예제 확인 |
| 요청은 보이는데 응답 없음 | 시동 OFF, 게이트웨이 대기, PID 미지원 | 계기판 상태, ELM327로 같은 PID 확인 | ON/시동, 다른 PID, 물리 주소 시도 |
| 값이 계속 `--` | `0x7E8` 필터 오류, SF 길이 오해 | `candump` 원시 프레임, 시리얼 로그 | 응답 ID·PCI·PID 확인 |
| TEC/REC 증가 | 종단 중복/누락, 배선 스텁, 속도 불일치 | 차량 6/14 저항, 모듈 120Ω | 모듈 120Ω 제거(차량 종단은 유지), 선 shorten, 500k 확인 |
| Bus-Off 반복 | 배선 불량, 전원 불안정, 과도 전압 | 오류 카운터, 전원 파형 | 퓨즈·강압·접지·TVS 점검 |
| Wi-Fi는 되는데 화면이 멈춤 | `delay()` 과다, 서버 루프 누락 | 시리얼, `handleClient` 호출 | 루프에서 서버 처리, 긴 지연 제거 |
| 차량에서만 리셋 | 크랭킹·load dump, 전원 부족 | 전압 로그, 리셋 원인 | USB 전원 분리, 자동차용 강압·TVS |
| 배터리 방전 | 16번 상시 전원 | 사용 후 전압 | 사용 후 분리, 슬립·스위치 |

- 벤치에서는 되고 차량에서만 안 되면, 전원·접지·종단·게이트웨이를 먼저 본다. 코드를 의심하는 순서를 뒤로 미룬다.
- 차량에서 리셋이 반복되면 12V 과도 전압을 의심한다. 개발 보드의 USB 전원과 차량 전원을 동시에 연결하지 않는다.
- CAN 오류는 "프레임이 안 온다"보다 **TEC/REC와 bus_error_count**가 먼저 알려 준다. 로그에 남긴다.

## 13.9 체크리스트

- [ ] 정차·P·주차 브레이크를 확인했는가
- [ ] OBD 6/14/16/4/5번 핀을 데이터시트·차량 문서로 확인했는가
- [ ] 16번 전원에 퓨즈와 강압 모듈을 넣었는가
- [ ] ESP32 3.3V와 트랜시버 전압이 맞는가
- [ ] TX→TXD, RX→RXD로 교차 연결했는가
- [ ] 차량에 120Ω을 추가하지 않았는가
- [ ] 벤치에서 listen-only 수신을 확인했는가
- [ ] 벤치에서 요청/응답을 확인했는가
- [ ] `0x7E8`, `41`, PID, SF 길이를 검사하는가
- [ ] Bus-Off 복구와 오류 카운터 로그가 있는가
- [ ] Wi-Fi 자격 증명을 코드·깃에 남기지 않았는가
- [ ] 웹 서버를 인터넷에 노출하지 않았는가
- [ ] 읽기 서비스만 보내는가
- [ ] 사용 후 장치를 분리했는가

## 장 요약

- ESP32 + 3.3V CAN 트랜시버로 OBD-II 포트에서 직접 CAN 프레임을 읽을 수 있다.
- OBD 6/14번은 CAN, 16번은 배터리 +12V, 4/5번은 접지다. 12V는 퓨즈·강압·보호를 거쳐야 한다.
- 차량 버스에는 120Ω을 추가하지 않는다. 벤치에서만 양 끝 종단을 붙인다.
- 첫 시험은 listen-only로 수신만 확인하고, 그다음 정상 모드로 Mode 01 요청을 보낸다.
- 요청은 `7DF`, 엔진 응답은 `7E8`이다. `41 <PID>`와 ISO-TP SF 길이를 확인해 값을 파싱한다.
- Wi-Fi 웹 서버는 최신 값만 JSON으로 제공하고, 브라우저가 주기적으로 폴링한다.
- Bus-Off·TEC/REC·응답 타임아웃을 로그로 남겨야 "안 된다"를 "어디가 안 되는가"로 바꿀 수 있다.
- MCP2515는 SPI-CAN 대안이지만, 크리스탈·종단·레벨·라이브러리 차이를 확인해야 한다.
- 이 장의 장치는 정차 상태의 읽기 전용이다. 쓰기·삭제·액추에이터 제어로 확장하지 않는다.

다음 장에서는 차 없이 CAN을 반복하는 가상 실습실을 연다. vcan, python-can virtual, 가짜 ECU, ELM327-emulator, 로그 재생으로 지금까지의 코드를 책상 위에서 시험한다. 무엇을 어떤 순서로 익힐지는 20장에서 정리한다.

## 연습 문제

### 1. 배선과 전원

1. OBD 6번, 14번, 16번, 4/5번은 각각 무엇인가?
2. ESP32와 SN65HVD230을 쓸 때 트랜시버 전원은 몇 V인가?
3. 차량 버스에 120Ω을 추가하면 왜 문제인가?
4. 16번 전원을 ESP32 5V 핀에 직접 연결하면 왜 위험한가?

### 2. TWAI 설정

1. `TWAI_GENERAL_CONFIG_DEFAULT`의 인자 순서는 무엇인가?
2. 쏘렌토 OBD CAN에 맞는 비트레이트 매크로는 무엇인가?
3. listen-only 모드에서 OBD 요청을 보낼 수 없는 이유는 무엇인가?
4. 벤치에서 listen-only만 있으면 `cansend`가 실패할 수 있는 이유는 무엇인가?

### 3. 응답 파싱

다음 CAN 프레임을 해석하라.

```text
7E8  04 41 0C 1A F8 CC CC CC
7E8  03 41 0D 50 CC CC CC CC
7E8  03 41 05 7B CC CC CC CC
```

1. 각 프레임의 PID와 값을 구하라.
2. 첫 바이트 `04`의 뜻은 무엇인가?
3. `CC`는 무엇인가?

### 4. 전원과 버스 오류

1. load dump란 무엇인가?
2. 퓨즈·강압 모듈·TVS를 어디에 넣어야 하는가?
3. 첫 시험을 USB 전원으로 하는 이유는 무엇인가?
4. TEC와 REC는 무엇인가?
5. Bus-Off 상태에서 어떤 복구 절차가 필요한가?
6. 오류 로그에 남겨야 할 값을 세 가지 쓰라.

### 5. 웹 서버

1. `server.handleClient()`를 메인 루프에서 호출하지 않으면 어떻게 되는가?
2. `delay(500)`을 넣으면 웹 화면에 어떤 영향이 있는가?
3. Wi-Fi 비밀번호를 코드에 커밋하면 왜 문제인가?

## 정답과 해설

### 1.

1. 6번 CAN-H, 14번 CAN-L, 16번 배터리 +12V, 4/5번 접지(chassis/signal ground).
2. SN65HVD230은 3.3V다. 5V 전용 트랜시버는 레벨 시프터가 필요하다.
3. 차량 버스는 이미 양 끝이 120Ω으로 종단되어 있다. 추가하면 병렬 저항이 낮아져 통신이 불안정해진다. 120Ω은 벤치에서만 붙인다.
4. 16번은 배터리 전원이라 과도 전압과 전류가 크다. 퓨즈·강압·TVS 없이 연결하면 보드가 손상되거나 화재 위험이 있다.

### 2.

1. `(TX, RX, MODE)` 순서다. 공식 예제와 사용하는 코어의 시그니처를 확인한다.
2. `TWAI_TIMING_CONFIG_500KBITS()`. 차량이 250kbps면 그에 맞는 매크로를 쓴다.
3. listen-only는 전송을 하지 않고 ACK도 보내지 않는 관찰 모드다. 요청 프레임을 보낼 수 없다.
4. 송신에는 다른 노드의 ACK가 필요하다. listen-only 노드는 ACK하지 않으므로, 정상 모드 노드가 하나 더 필요하다.

### 3.

1. `04 41 0C 1A F8` → PID `0C`, rpm `(0x1A × 256 + 0xF8) / 4 = 1726`. `03 41 0D 50` → PID `0D`, 80km/h. `03 41 05 7B` → PID `05`, `0x7B − 40 = 83°C`.
2. ISO-TP Single Frame의 데이터 길이다. `04`면 PCI 뒤에 4바이트(`41 0C 1A F8`)가 온다.
3. OBD-II에서 권장하는 패딩 바이트다. 길이 필드에 포함되지 않는다.

### 4.

1. 발전기와 배터리가 분리될 때 생기는 큰 과도 전압이다. 12V 차량에서도 수십 V까지 올라갈 수 있다.
2. 16번 전원 입력 쪽에 퓨즈, 그 뒤에 강압 모듈, 입력단에 TVS를 둔다. ESP32와 트랜시버는 강압된 전원으로 동작시킨다.
3. 차량 전원의 과도 전압·접지 문제를 배제하고, 배선과 CAN 통신 자체를 먼저 검증하기 위해서다.
4. TEC는 송신 오류 카운터, REC는 수신 오류 카운터다. 값이 커지면 버스 품질이 나쁘다는 신호다.
5. Bus-Off를 인지하고 복구 절차를 호출한 뒤, 복구가 끝나면 다시 시작한다. 복구가 반복되면 배선·종단·비트레이트를 고친다.
6. TEC, REC, bus_error_count(또는 rx_missed_count)와 발생 시각을 남긴다.

### 5.

1. 클라이언트 요청을 처리하지 못해 웹 페이지가 응답하지 않는다.
2. 500ms 동안 루프가 멈춰 CAN 수신·요청과 웹 응답이 모두 느려진다. 짧은 `delay(1)`이나 비블로킹 루프를 쓴다.
3. 같은 네트워크의 누구나 Wi-Fi에 접속해 장치를 볼 수 있고, 저장소 이력에도 남는다. `secrets.h` 등으로 분리하고 `.gitignore`에 넣는다.
