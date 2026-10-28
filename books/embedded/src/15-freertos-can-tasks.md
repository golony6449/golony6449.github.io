# 15장 FreeRTOS로 CAN 수신 태스크 나누기

## 이 장에서

13장의 ESP32 장치는 `loop()` 하나에서 웹 요청 처리, CAN 수신, PID 요청, Bus-Off 복구를 모두 했다. 트래픽이 적고 응답이 빠를 때는 잘 돌아간다. 하지만 Wi-Fi 연결이 느려지고, CAN 오류가 반복되고, 로그를 SD 카드에 쓰기 시작하면 `loop()` 한 바퀴가 길어지면서 CAN 수신 큐가 넘치기 시작한다.

이 장은 그 일을 **FreeRTOS 태스크**로 나눈다. CAN 수신, OBD 요청·파싱, 경보·복구를 각각 태스크로 두고, 큐로 데이터를 넘기고, 우선순위와 스택을 설계한다. 대상은 ESP-IDF의 FreeRTOS다. Arduino-ESP32 코어도 내부적으로 ESP-IDF FreeRTOS를 쓰므로 개념은 같지만, 이 장의 코드는 ESP-IDF API(`freertos/...`, `driver/twai.h`)를 기준으로 한다.

**중요:** 이 장의 ESP32 코드는 이 환경에서 ESP-IDF로 빌드하지 못했다. API 이름과 동작은 ESP-IDF v5.4 공식 문서(legacy TWAI)와 FreeRTOS 문서로 대조했지만, 실제 보드에서 컴파일·실행하려면 **실물 확인 필요**다. 특히 사용하는 ESP-IDF/Arduino-ESP32 코어 버전에 따라 TWAI API가 다를 수 있다. ESP-IDF v6.x의 stable 문서는 `twai_node_*`라는 새 API를 설명한다. 이 장은 Arduino-ESP32 3.x·ESP-IDF 5.x에서 쓰는 `driver/twai.h`의 legacy API를 기준으로 하며, 코어 버전이 다르면 공식 예제를 먼저 확인한다.

이 장에서 다루는 것:

- FreeRTOS 태스크·스케줄러·우선순위·스택
- 큐의 복사 의미와 블로킹 타임아웃
- ISR에서 쓰는 `FromISR` API와 `portYIELD_FROM_ISR`
- TWAI 수신 큐와 경보(alert)
- Bus-Off 복구를 태스크로 설계하기
- CAN 수신·OBD 요청·경보 태스크의 코드 구조
- 우선순위 역전과 뮤텍스
- 태스크 스택·워치독·관측

## 15.1 왜 태스크로 나누는가

`loop()` 하나짜리 구조의 문제는 **가장 느린 작업이 전체 주기를 결정**한다는 것이다. 웹 응답을 기다리는 동안 CAN 프레임을 못 읽고, SD 카드 쓰기가 끝날 때까지 PID 요청이 밀린다. 웹의 이벤트 루프도 같은 문제를 겪지만, Node.js에서는 논블로킹 I/O와 워커 스레드로 완화한다. MCU에서는 RTOS 태스크가 그 역할을 한다.

FreeRTOS의 기본 개념은 다음과 같다.

| 개념 | 설명 | 웹 비유 |
|---|---|---|
| 태스크(task) | 독립적인 실행 흐름, 각자 스택을 가짐 | 워커 스레드, async 태스크 |
| 스케줄러(scheduler) | 준비된 태스크 중 우선순위가 높은 것을 실행 | 이벤트 루프 + 우선순위 큐 |
| 우선순위(priority) | 태스크마다 고정된 정수. 높을수록 먼저 실행 | `requestIdleCallback`보다 강한 개념 |
| 틱(tick) | 스케줄러의 시간 단위. `pdMS_TO_TICKS()`로 변환 | `setTimeout`의 ms와 비슷하지만 해상도가 유한 |
| 큐(queue) | 태스크 사이에 데이터를 복사해 넘기는 FIFO | `postMessage`, `MessageChannel` |
| 뮤텍스(mutex) | 공유 자원에 한 번에 하나만 접근 | `Atomics.wait`/락, 단 우선순위 상속이 있음 |
| 스택(stack) | 태스크마다 별도. 함수 호출·지역 변수 | 워커 스레드의 스택 |

ESP-IDF에서 태스크 스택 크기는 **바이트 단위**다. 바닐라 FreeRTOS는 워드 단위인 경우가 많으므로, ESP-IDF 문서와 예제를 기준으로 확인한다. `xTaskCreate()`는 스택과 태스크 제어 블록을 힙에서 동적으로 할당하고, `xTaskCreateStatic()`은 호출자가 준 메모리를 쓴다. `xTaskCreatePinnedToCore()`는 특정 코어에 고정한다.

```c
BaseType_t xTaskCreatePinnedToCore(
    TaskFunction_t task_code,
    const char *name,
    uint32_t stack_depth_bytes,
    void *params,
    UBaseType_t priority,
    TaskHandle_t *created_task,
    BaseType_t core_id);   /* 0, 1, tskNO_AFFINITY */
```

- ESP32는 듀얼코어다. 코어 0에는 Wi-Fi·프로토콜 스택 등 시스템 태스크가 많다. CAN 수신처럼 지연에 민감한 태스크를 코어 1에 고정하는 구성이 흔하다. 다만 시스템 태스크 배치는 ESP-IDF 버전·설정에 따라 다르므로, `vTaskList()`/Tracealyzer로 확인한다.
- 우선순위는 0(가장 낮음)부터 `configMAX_PRIORITIES - 1`까지다. ESP-IDF 기본 설정은 `configMAX_PRIORITIES = 25`이므로 0~24를 쓴다. 프로젝트의 `sdkconfig`에서 바뀔 수 있다.
- 스케줄러는 준비된 태스크 중 우선순위가 가장 높은 것을 실행한다. 같은 우선순위는 라운드 로빈(time slicing)으로 돌아간다.
- 우선순위를 높게 잡는다고 좋은 것이 아니다. 높은 태스크가 바쁘게 돌면 낮은 태스크가 굶는다. **우선순위는 "얼마나 급한가"이지 "얼마나 중요한가"가 아니다.**

## 15.2 태스크 스택과 우선순위 설계

태스크마다 스택이 필요하다. 함수 호출, 지역 변수, ISR 진입 시 문맥, `printf`의 내부 버퍼가 모두 스택을 쓴다. ESP-IDF에서 `uxTaskGetStackHighWaterMark(NULL)`은 현재 태스크의 **최소 여유 스택(바이트)**을 돌려준다. 이 값이 0에 가까우면 위험하다.

```c
void check_stack(void) {
    UBaseType_t free_bytes = uxTaskGetStackHighWaterMark(NULL);
    ESP_LOGI(TAG, "stack free: %u bytes", (unsigned)free_bytes);
}
```

- 처음에는 넉넉히 잡고(예: 4KB), 하이워터마크를 측정한 뒤 줄인다.
- `printf`/`ESP_LOG`는 스택을 많이 쓴다. 로그를 많이 넣는 태스크는 스택을 더 잡는다.
- 큰 버퍼는 스택이 아니라 정적/전역이나 힙에 둔다(14장).
- 스택 오버플로는 예외가 아니라 조용한 손상이다. ESP-IDF의 `CONFIG_FREERTOS_CHECK_STACKOVERFLOW`와 `CONFIG_FREERTOS_WATCHPOINT_END_OF_STACK`을 켜서 탐지한다(버전·설정 확인 필요).

이 장의 예제는 다음 구성을 쓴다. 우선순위와 스택은 **예시**이며, 실제 프로젝트에서는 측정으로 조정한다.

| 태스크 | 우선순위(예) | 스택(예) | 코어 | 역할 |
|---|---:|---:|---|---|
| `can_rx` | 12 | 4096 B | 1 | `twai_receive()` → 프레임 큐 |
| `alert` | 10 | 3072 B | 1 | TWAI 경보 대기, Bus-Off 복구 |
| `obd` | 9 | 4096 B | 1 | 200ms 주기 요청, 프레임 파싱, 상태 갱신 |
| `logger`(선택) | 4 | 4096 B | 0 | SD/UART 로그 배치 쓰기 |
| HTTP 서버 | ESP-IDF `httpd`가 생성 | 설정 | 0 | 최신 상태 JSON 제공 |

- `can_rx`가 가장 높은 이유는 드라이버 RX 큐가 넘치기 전에 빨리 꺼내야 하기 때문이다. 파싱·로그는 낮은 태스크로 미룬다.
- `alert`는 `can_rx`보다 낮지만 `obd`보다 높다. Bus-Off 복구는 통신 지속성에 직결된다.
- `obd`는 200ms 주기로 요청하고, 큐에서 프레임을 꺼내 파싱한다. 파싱이 오래 걸리면 `can_rx`가 큐에 쌓기만 하므로 수신은 계속된다.
- HTTP 서버는 ESP-IDF `httpd`가 자체 태스크로 돌린다. Arduino `WebServer`를 쓴다면 `handleClient()`를 별도 태스크나 `loop()`에서 호출해야 한다.

## 15.3 큐: 복사와 블로킹

FreeRTOS 큐는 **고정 크기 항목을 복사**해서 넘긴다. `xQueueCreate(length, item_size)`로 만들고, `xQueueSend()`는 `item_size` 바이트를 큐 저장 공간에 복사한다. 따라서 보낸 쪽의 지역 변수가 사라져도 큐의 데이터는 유효하다. 반대로 포인터를 보내면 가리키는 대상의 수명은 보낸 쪽이 책임져야 한다.

```c
typedef struct {
    uint32_t id;
    uint8_t dlc;
    uint8_t data[8];
    TickType_t tick;
} can_frame_t;

QueueHandle_t q = xQueueCreate(32, sizeof(can_frame_t));
if (q == NULL) {
    /* 큐 생성 실패: 힙 부족 */
}

can_frame_t f = { /* ... */ };
if (xQueueSend(q, &f, pdMS_TO_TICKS(10)) != pdPASS) {
    /* 10ms 안에 자리가 없었다: 드롭 정책 */
}
```

- `xQueueSend()`의 세 번째 인자는 블로킹 시간이다. `0`이면 즉시 반환하고, `portMAX_DELAY`면 자리가 생길 때까지 기다린다.
- 큐가 가득 차면 `errQUEUE_FULL`이 된다. ISR에서는 기다릴 수 없으므로 `xQueueSendFromISR()`를 쓰고, 실패하면 드롭하거나 오버플로 카운터를 올린다.
- `xQueueReceive()`도 같은 방식으로 타임아웃을 받는다. `portMAX_DELAY`는 영원히 기다린다는 뜻이므로, 워치독과 함께 쓸 때는 유한 타임아웃을 주는 편이 안전하다.
- 큐 길이는 "최악의 생산 속도 × 최악의 소비 지연"으로 정한다. 200ms 동안 초당 1,000프레임이 들어오면 200개가 필요하다. 32개짜리 큐는 그 상황에서 넘친다.
- 큐에 큰 구조체를 넣으면 복사 비용과 RAM 사용량이 커진다. 프레임은 8바이트 데이터만 복사하고, 해석된 값은 별도 상태로 두는 편이 낫다.

### ISR에서 큐로 넘기기

```c
static QueueHandle_t g_frame_q;

void IRAM_ATTR can_isr(void) {
    can_frame_t f = { /* 하드웨어 레지스터에서 읽은 값 */ };
    BaseType_t higher_priority_task_woken = pdFALSE;

    if (xQueueSendFromISR(g_frame_q, &f, &higher_priority_task_woken) != pdPASS) {
        g_rx_drops++;   /* ISR에서는 기다리지 않는다 */
    }
    portYIELD_FROM_ISR(higher_priority_task_woken);
}
```

- `xQueueSendFromISR()`는 `pxHigherPriorityTaskWoken`을 통해 "더 높은 우선순위 태스크가 깨어났는가"를 알려 준다. 그 값이 `pdTRUE`면 ISR을 나가기 전에 문맥 전환을 요청한다.
- FreeRTOS 문서는 "Never call a FreeRTOS API function that does not have FromISR in its name from an ISR"라고 못 박는다. `xQueueSend()` 일반형을 ISR에서 쓰면 안 된다.
- ESP-IDF TWAI 드라이버를 쓰면 이 ISR을 직접 작성하지 않는다. 드라이버가 내부 RX 큐에 넣고, 태스크가 `twai_receive()`로 꺼낸다. 하지만 "ISR은 넣기만, 처리는 태스크"라는 원리는 같다.

## 15.4 TWAI 수신 큐와 경보

legacy TWAI 드라이버는 다음 두 가지 큐를 제공한다.

1. **드라이버 RX 큐**: `twai_general_config_t::rx_queue_len` 크기. 수신 ISR이 프레임을 넣고, `twai_receive()`가 꺼낸다.
2. **드라이버 TX 큐**: `tx_queue_len` 크기. `twai_transmit()`이 프레임을 넣으면 드라이버가 버스로 보낸다.

`twai_receive(&msg, ticks_to_wait)`는 RX 큐가 비어 있으면 `ticks_to_wait`만큼 블로킹하고, 시간이 지나면 `ESP_ERR_TIMEOUT`을 돌려준다. 큐가 가득 차서 프레임을 잃으면 `TWAI_ALERT_RX_QUEUE_FULL` 경보가 발생하고, `twai_get_status_info().rx_missed_count`가 증가한다.

```c
twai_general_config_t g_config = TWAI_GENERAL_CONFIG_DEFAULT(
    (gpio_num_t)TX_PIN, (gpio_num_t)RX_PIN, TWAI_MODE_NORMAL);
g_config.rx_queue_len = 32;
g_config.tx_queue_len = 8;
g_config.alerts_enabled = TWAI_ALERT_BUS_OFF
                        | TWAI_ALERT_BUS_RECOVERED
                        | TWAI_ALERT_ERR_PASS
                        | TWAI_ALERT_ABOVE_ERR_WARN
                        | TWAI_ALERT_RX_QUEUE_FULL;
```

- `TWAI_GENERAL_CONFIG_DEFAULT(TX, RX, MODE)`의 순서는 **TX가 먼저**다. 13장에서 확인한 그대로다.
- `rx_queue_len`은 "드라이버가 몇 프레임을 버퍼링하는가"다. 응용 큐(`g_frame_q`)와 별개다. 둘 다 넘칠 수 있다.
- `TWAI_ALERT_RX_QUEUE_FULL`은 "드라이버 큐가 넘쳤다"는 뜻이다. 응용 큐가 넘친 것은 별도 카운터로 센다.
- 경보는 `twai_reconfigure_alerts()`로 실행 중에 바꿀 수 있고, `twai_read_alerts(&alerts, ticks)`로 읽는다. `ticks`에 `portMAX_DELAY`를 주면 경보가 올 때까지 블로킹한다.

경보 플래그의 의미는 다음과 같다.

| 경보 | 의미 | 대응 |
|---|---|---|
| `TWAI_ALERT_RX_DATA` | 프레임이 RX 큐에 들어옴 | 보통 사용하지 않음(수신 태스크가 처리) |
| `TWAI_ALERT_RX_QUEUE_FULL` | RX 큐가 가득 차 프레임 유실 | 소비 속도↑, `rx_queue_len`↑, 필터 축소 |
| `TWAI_ALERT_ABOVE_ERR_WARN` | 오류 카운터가 경고 한계(96) 초과 | 배선·종단·비트레이트 확인 |
| `TWAI_ALERT_ERR_PASS` | Error Passive 진입 | TEC/REC 로그, 원인 조사 |
| `TWAI_ALERT_BUS_OFF` | Bus-Off 진입 | 복구 절차 시작 |
| `TWAI_ALERT_RECOVERY_IN_PROGRESS` | 복구 중 | `twai_start()` 호출 금지 |
| `TWAI_ALERT_BUS_RECOVERED` | 복구 완료 | `twai_start()`로 재시작 |

TWAI 드라이버는 상태를 `twai_get_status_info()`로 제공한다. `state`, `msgs_to_rx`, `rx_missed_count`, `bus_error_count`, `tx_error_counter`, `rx_error_counter`를 로그에 남긴다. "통신이 안 된다"보다 "TEC=130, REC=0, bus_error=42"가 훨씬 유용하다.

## 15.5 Bus-Off 복구를 태스크로

13장에서는 `loop()`에서 `twai_get_status_info()`를 폴링해 Bus-Off를 확인했다. 태스크 구조에서는 **경보를 기다리는 태스크**를 두는 편이 깔끔하다. 아래 예제에서 `g_rx_queue_full`은 `_Atomic uint32_t`라고 가정한다.

```c
static void alert_task(void *arg) {
    uint32_t alerts;

    for (;;) {
        esp_err_t err = twai_read_alerts(&alerts, pdMS_TO_TICKS(1000));
        if (err == ESP_ERR_TIMEOUT) {
            esp_task_wdt_reset();
            continue;
        }
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "twai_read_alerts: %s", esp_err_to_name(err));
            vTaskDelay(pdMS_TO_TICKS(100));
            continue;
        }

        if (alerts & TWAI_ALERT_BUS_OFF) {
            ESP_LOGE(TAG, "bus-off: start recovery");
            twai_initiate_recovery();   /* Bus-Off에서만 유효 */
        }
        if (alerts & TWAI_ALERT_BUS_RECOVERED) {
            ESP_LOGI(TAG, "bus recovered: restart");
            twai_start();               /* 복구 완료 후 Stopped → Running */
        }
        if (alerts & (TWAI_ALERT_ERR_PASS | TWAI_ALERT_ABOVE_ERR_WARN)) {
            log_bus_status();
        }
        if (alerts & TWAI_ALERT_RX_QUEUE_FULL) {
            atomic_fetch_add(&g_rx_queue_full, 1u);
        }
        esp_task_wdt_reset();
    }
}
```

복구 순서는 다음과 같다.

```text
RUNNING
  │ TEC >= 256
  ▼
BUS_OFF ──twai_initiate_recovery()──→ RECOVERING
  │                                      │ 128번의 bus-free(11 recessive bits)
  │                                      ▼
  │                                   STOPPED
  │                                      │ twai_start()
  └──────────────────────────────────────┴──→ RUNNING
```

- `twai_initiate_recovery()`는 Bus-Off 상태에서만 유효하다. 호출하면 TX 큐가 비워지므로, 대기 중이던 요청은 사라진다. `obd` 태스크는 전송 실패를 정상 경로로 처리해야 한다.
- 복구 중에는 `twai_start()`를 호출하지 않는다. `TWAI_ALERT_BUS_RECOVERED`를 받은 뒤에 호출한다.
- 복구가 반복되면 배선·종단·비트레이트·전원을 먼저 고친다. 소프트웨어로 Bus-Off를 계속 복구하는 것은 증상 완화일 뿐이다.
- `twai_read_alerts()`에 `portMAX_DELAY`를 주면 경보가 없을 때 영원히 블로킹한다. TWDT에 감시되는 태스크라면 유한 타임아웃을 주고 주기적으로 `esp_task_wdt_reset()`을 호출한다.
- 경보 태스크가 죽으면 Bus-Off 복구가 멈춘다. 경보 태스크의 하이워터마크와 하트비트를 관측한다.

## 15.6 CAN 수신·OBD 태스크 코드

다음은 13장의 `handleFrame()`과 `checkBus()`를 태스크 구조로 옮긴 골격이다. Wi-Fi/HTTP 부분은 13.5절의 JSON 구조를 그대로 쓰되, `httpd` 핸들러가 `state_snapshot()`을 호출한다고 가정한다.

```c
#include <string.h>
#include <stdatomic.h>
#include <stdbool.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "driver/twai.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_task_wdt.h"

#define TAG "obd"
#define TX_PIN 22
#define RX_PIN 21
#define FRAME_QUEUE_LEN 32
#define REQUEST_INTERVAL_MS 200

typedef struct {
    uint32_t id;
    uint8_t dlc;
    uint8_t data[8];
    TickType_t tick;
} can_frame_t;

typedef struct {
    float rpm;
    float speed;
    float coolant;
    TickType_t last_update;
    uint32_t requests;
    uint32_t responses;
    uint32_t tx_failures;
    uint32_t app_drops;
    uint32_t driver_drops;
    bool bus_ok;
} vehicle_state_t;

static QueueHandle_t g_frame_q;
static SemaphoreHandle_t g_state_lock;
static vehicle_state_t g_state;
static _Atomic uint32_t g_requests;
static _Atomic uint32_t g_responses;
static _Atomic uint32_t g_tx_failures;
static _Atomic uint32_t g_app_drops;
static _Atomic uint32_t g_driver_drops;
static _Atomic uint32_t g_rx_queue_full;

static void state_set_bus(bool ok) {
    if (xSemaphoreTake(g_state_lock, pdMS_TO_TICKS(10)) == pdPASS) {
        g_state.bus_ok = ok;
        xSemaphoreGive(g_state_lock);
    }
}

static void state_update(uint8_t pid, float value) {
    if (xSemaphoreTake(g_state_lock, pdMS_TO_TICKS(10)) != pdPASS) {
        return;   /* 짧은 임계 구역: 실패하면 다음 표본에서 다시 시도 */
    }
    switch (pid) {
    case 0x0C: g_state.rpm = value; break;
    case 0x0D: g_state.speed = value; break;
    case 0x05: g_state.coolant = value; break;
    default: break;
    }
    g_state.last_update = xTaskGetTickCount();
    atomic_fetch_add(&g_responses, 1u);
    g_state.bus_ok = true;
    xSemaphoreGive(g_state_lock);
}

static bool parse_obd_frame(const can_frame_t *f, uint8_t *pid, float *value) {
    if (f->id != 0x7E8 || f->dlc < 4) return false;

    const uint8_t *d = f->data;
    if ((d[0] >> 4) != 0) return false;          /* Single Frame만 */
    uint8_t len = d[0] & 0x0F;
    if (len < 3 || len > 7 || f->dlc < 3 + len) return false;
    if (d[1] != 0x41) return false;              /* Mode 01 긍정 응답 */

    *pid = d[2];
    switch (*pid) {
    case 0x0C:
        if (len < 4) return false;
        *value = ((d[3] << 8) | d[4]) / 4.0f;
        return true;
    case 0x0D:
        if (len < 3) return false;
        *value = d[3];
        return true;
    case 0x05:
        if (len < 3) return false;
        *value = (int)d[3] - 40;
        return true;
    default:
        return false;
    }
}

static void request_pid(uint8_t pid) {
    twai_message_t msg = {};
    msg.identifier = 0x7DF;
    msg.extd = 0;
    msg.rtr = 0;
    msg.data_length_code = 8;
    msg.data[0] = 0x02;
    msg.data[1] = 0x01;
    msg.data[2] = pid;
    for (int i = 3; i < 8; i++) msg.data[i] = 0xCC;

    if (twai_transmit(&msg, pdMS_TO_TICKS(20)) == ESP_OK) {
        atomic_fetch_add(&g_requests, 1u);
    } else {
        atomic_fetch_add(&g_tx_failures, 1u);
    }
}

static void can_rx_task(void *arg) {
    twai_message_t msg;
    esp_task_wdt_add(NULL);

    for (;;) {
        esp_err_t err = twai_receive(&msg, pdMS_TO_TICKS(100));
        if (err == ESP_ERR_TIMEOUT) {
            esp_task_wdt_reset();
            continue;
        }
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "twai_receive: %s", esp_err_to_name(err));
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;   /* 워치독을 리셋하지 않는다: 지속 오류는 리셋으로 드러난다 */
        }

        can_frame_t f = {
            .id = msg.identifier,
            .dlc = msg.data_length_code,
            .tick = xTaskGetTickCount(),
        };
        memcpy(f.data, msg.data, sizeof f.data);

        if (xQueueSend(g_frame_q, &f, 0) != pdPASS) {
            atomic_fetch_add(&g_app_drops, 1u);
        }
        esp_task_wdt_reset();
    }
}

static void obd_task(void *arg) {
    static const uint8_t pids[] = {0x0C, 0x0D, 0x05};
    size_t pid_index = 0;
    TickType_t last_request = xTaskGetTickCount();
    esp_task_wdt_add(NULL);

    for (;;) {
        TickType_t now = xTaskGetTickCount();
        if (now - last_request >= pdMS_TO_TICKS(REQUEST_INTERVAL_MS)) {
            request_pid(pids[pid_index]);
            pid_index = (pid_index + 1) % (sizeof pids / sizeof pids[0]);
            last_request = now;
        }

        can_frame_t f;
        if (xQueueReceive(g_frame_q, &f, pdMS_TO_TICKS(20)) == pdPASS) {
            uint8_t pid;
            float value;
            if (parse_obd_frame(&f, &pid, &value)) {
                state_update(pid, value);
            }
        }
        esp_task_wdt_reset();
    }
}

static void log_bus_status(void) {
    twai_status_info_t st;
    if (twai_get_status_info(&st) != ESP_OK) return;
    atomic_store(&g_driver_drops, st.rx_missed_count);
    ESP_LOGW(TAG, "state=%d TEC=%lu REC=%lu bus_err=%lu rx_missed=%lu",
             (int)st.state,
             (unsigned long)st.tx_error_counter,
             (unsigned long)st.rx_error_counter,
             (unsigned long)st.bus_error_count,
             (unsigned long)st.rx_missed_count);
}

static void alert_task(void *arg) {
    uint32_t alerts;
    esp_task_wdt_add(NULL);

    for (;;) {
        esp_err_t err = twai_read_alerts(&alerts, pdMS_TO_TICKS(1000));
        if (err == ESP_ERR_TIMEOUT) {
            esp_task_wdt_reset();
            continue;
        }
        if (err != ESP_OK) {
            vTaskDelay(pdMS_TO_TICKS(100));
            continue;
        }

        if (alerts & TWAI_ALERT_BUS_OFF) {
            ESP_LOGE(TAG, "bus-off: recovery");
            state_set_bus(false);
            twai_initiate_recovery();
        }
        if (alerts & TWAI_ALERT_BUS_RECOVERED) {
            ESP_LOGI(TAG, "bus recovered");
            twai_start();
        }
        if (alerts & (TWAI_ALERT_ERR_PASS | TWAI_ALERT_ABOVE_ERR_WARN)) {
            log_bus_status();
        }
        if (alerts & TWAI_ALERT_RX_QUEUE_FULL) {
            atomic_fetch_add(&g_rx_queue_full, 1u);
        }
        esp_task_wdt_reset();
    }
}

void app_main(void) {
    twai_general_config_t g_config = TWAI_GENERAL_CONFIG_DEFAULT(
        (gpio_num_t)TX_PIN, (gpio_num_t)RX_PIN, TWAI_MODE_NORMAL);
    g_config.rx_queue_len = FRAME_QUEUE_LEN;
    g_config.tx_queue_len = 8;
    g_config.alerts_enabled = TWAI_ALERT_BUS_OFF
                            | TWAI_ALERT_BUS_RECOVERED
                            | TWAI_ALERT_ERR_PASS
                            | TWAI_ALERT_ABOVE_ERR_WARN
                            | TWAI_ALERT_RX_QUEUE_FULL;
    twai_timing_config_t t_config = TWAI_TIMING_CONFIG_500KBITS();
    twai_filter_config_t f_config = TWAI_FILTER_CONFIG_ACCEPT_ALL();

    ESP_ERROR_CHECK(twai_driver_install(&g_config, &t_config, &f_config));
    ESP_ERROR_CHECK(twai_start());

    g_frame_q = xQueueCreate(FRAME_QUEUE_LEN, sizeof(can_frame_t));
    g_state_lock = xSemaphoreCreateMutex();
    if (!g_frame_q || !g_state_lock) {
        ESP_LOGE(TAG, "queue/mutex creation failed");
        return;
    }

    esp_task_wdt_config_t wdt = {
        .timeout_ms = 5000,
        .idle_core_mask = 0,
        .trigger_panic = true,
    };
    esp_err_t wdt_err = esp_task_wdt_init(&wdt);
    if (wdt_err == ESP_ERR_INVALID_STATE) {
        wdt_err = esp_task_wdt_reconfigure(&wdt);   /* 기본 설정으로 이미 초기화된 경우 */
    }
    ESP_ERROR_CHECK(wdt_err);

    xTaskCreatePinnedToCore(can_rx_task, "can_rx", 4096, NULL, 12, NULL, 1);
    xTaskCreatePinnedToCore(alert_task, "alert", 3072, NULL, 10, NULL, 1);
    xTaskCreatePinnedToCore(obd_task, "obd", 4096, NULL, 9, NULL, 1);
}
```

### 코드에서 확인할 점

- `g_state`의 값(rpm·speed·coolant·last_update·bus_ok)은 뮤텍스로 보호하고, 요청·응답·드롭 카운터는 `_Atomic`으로 둔다. `state_snapshot()`은 뮤텍스 안에서 값을 복사한 뒤 원자 카운터를 읽어 합친다. 두 종류의 공유 데이터를 한 가지 규칙으로 억지로 묶지 않는다.
- `g_rx_queue_full`·`g_app_drops`·`g_driver_drops`는 여러 태스크/ISR 문맥에서 갱신될 수 있으므로 `_Atomic`을 쓴다. `volatile`은 원자성을 보장하지 않는다(14.3절).
- `state_update()`의 임계 구역은 짧다. 뮤텍스를 잡은 채 로그·JSON·네트워크를 하지 않는다.
- `xQueueSend(g_frame_q, &f, 0)`은 즉시 반환한다. 큐가 가득 차면 프레임을 버리고 `app_drops`를 올린다. OBD 응답은 요청마다 새로 오므로, 오래된 프레임을 버리는 것보다 새 프레임을 버리는 정책이 단순하다. 다만 "응답을 놓쳤다"는 카운터가 중요하다.
- `twai_receive()`의 100ms 타임아웃은 태스크가 영원히 블로킹하지 않게 한다. TWDT 리셋도 그 주기에 맞춘다.
- `obd_task`는 20ms마다 큐를 확인하고, 200ms마다 요청한다. `xQueueReceive`의 타임아웃이 20ms이므로, 큐가 비어 있으면 20ms 잠들고 다시 돈다. 이 정도면 CPU를 많이 쓰지 않는다.
- Bus-Off 복구 중에는 `obd_task`의 `twai_transmit()`이 실패할 수 있다. 실패를 카운터로 남기고 다음 주기에 다시 시도한다.
- `esp_task_wdt_add(NULL)`은 각 태스크가 자기 자신을 감시 대상에 추가한다. `app_main`에서 한 번에 추가하는 것이 아니라, 태스크 안에서 호출한다.
- HTTP 서버는 `httpd_start()`가 만든 태스크가 처리한다. 핸들러에서 `state_snapshot()`으로 복사본을 얻어 JSON을 만든다. 뮤텍스를 오래 잡지 않는다.

### 상태 스냅샷

```c
static bool state_snapshot(vehicle_state_t *out) {
    if (xSemaphoreTake(g_state_lock, pdMS_TO_TICKS(10)) != pdPASS) {
        return false;
    }
    *out = g_state;
    xSemaphoreGive(g_state_lock);

    out->requests = atomic_load(&g_requests);
    out->responses = atomic_load(&g_responses);
    out->tx_failures = atomic_load(&g_tx_failures);
    out->app_drops = atomic_load(&g_app_drops);
    out->driver_drops = atomic_load(&g_driver_drops);
    return true;
}
```

- 구조체 전체를 복사하므로, JSON을 만드는 동안 값이 바뀌지 않는다.
- 복사 비용은 구조체 크기에 비례한다. 필드를 줄이거나, 자주 읽는 값만 별도 원자 변수로 둔다.
- 뮤텍스를 잡지 못하면 `false`를 돌려주고, 핸들러는 이전 값을 유지하거나 `503`을 반환한다. 무한정 기다리지 않는다.

## 15.7 우선순위 역전과 뮤텍스

우선순위 스케줄러에는 **우선순위 역전(priority inversion)**이라는 함정이 있다.

```text
낮은 우선순위 L이 뮤텍스를 잡고 있다.
높은 우선순위 H가 그 뮤텍스를 기다리며 블록된다.
중간 우선순위 M이 준비되면, M이 L을 선점한다.
H는 M이 끝날 때까지 기다린다. H가 M보다 우선순위가 높은데도.
```

FreeRTOS 뮤텍스에는 **우선순위 상속(priority inheritance)**이 있다. H가 뮤텍스를 기다리면, L의 우선순위를 일시적으로 H까지 올려 M이 L을 선점하지 못하게 한다. L이 뮤텍스를 놓으면 원래 우선순위로 돌아간다. FreeRTOS 문서는 이렇게 설명한다.

> "It does not 'fix' priority inversion, but merely lessens its impact by ensuring that the inversion is always time bounded."

즉, 우선순위 상속은 **시간을 한정**할 뿐, 역전을 없애지 않는다. 또한 문서는 "it is not good practice to rely on it for correct system operation"라고 경고한다. 설계 원칙은 다음과 같다.

- 뮤텍스를 잡은 채 오래 걸리는 일(네트워크, 플래시, 로그)을 하지 않는다.
- 뮤텍스를 중첩해서 잡지 않는다. 중첩하면 상속 우선순위가 더 올라가고 분석이 어려워진다.
- 가능하면 뮤텍스 대신 **큐와 단일 소유자**를 쓴다. 상태를 한 태스크만 갱신하고, 다른 태스크는 큐로 요청/응답한다.
- `xSemaphoreTake()`에 유한 타임아웃을 준다. 무한 대기는 데드락을 숨긴다.
- ISR에서 뮤텍스를 쓰지 않는다. ISR에는 기다릴 태스크가 없고, 우선순위 상속도 의미가 없다.

이 장의 `g_state_lock`은 짧은 복사만 보호한다. JSON 생성, 로그 출력, HTTP 전송은 뮤텍스 밖에서 한다. 이것이 "락을 최소화"의 실제 의미다.

## 15.8 태스크 설계 체크리스트

- [ ] 각 태스크의 **최악 실행 시간**을 측정했는가
- [ ] 우선순위가 "급한 순서"인가, "중요한 순서"인가
- [ ] 스택 하이워터마크가 충분한가
- [ ] 큐 길이가 최악 생산 속도 × 최악 소비 지연을 견디는가
- [ ] 큐가 가득 찼을 때 정책(드롭/덮어쓰기/블로킹)이 코드에 있는가
- [ ] ISR에서는 `FromISR` API만 쓰는가
- [ ] 뮤텍스를 잡은 채 블로킹하지 않는가
- [ ] 워치독을 정상 완료 지점에서 리셋하는가
- [ ] Bus-Off 복구가 경보 태스크에서 도는가
- [ ] 복구 중 전송 실패를 정상 경로로 처리하는가
- [ ] 모든 태스크가 TWDT에 등록됐는가, 아니면 등록하지 않은 이유가 있는가
- [ ] 로그에 태스크별 하이워터마크·드롭·오류 카운터가 있는가

## 흔한 실수

| 실수 | 결과 | 확인 |
|---|---|---|
| 우선순위를 모두 높게 | 낮은 태스크 굶음, 시스템 태스크 지연 | 우선순위 표, 실행 시간 측정 |
| 태스크를 너무 많이 | 스택·문맥 전환 비용, 분석 어려움 | 태스크 수, CPU 사용률 |
| 스택을 감으로 결정 | 오버플로, 조용한 손상 | 하이워터마크, 스택 체크 옵션 |
| 큐 길이를 1~2로 | 수신 유실, `RX_QUEUE_FULL` | 최악 속도 × 지연 |
| 큐에 포인터 전달 | 수명 문제, 댕글링 포인터 | 값 복사, 소유권 규칙 |
| ISR에서 `xQueueSend` | 블로킹·크래시 | `FromISR` 변형 |
| `portMAX_DELAY` + 워치독 | 워치독 리셋 | 유한 타임아웃 |
| 뮤텍스 안에서 로그/HTTP | 우선순위 역전, 지연 | 임계 구역 최소화 |
| Bus-Off 후 바로 `twai_start()` | 복구 중 시작, 오류 반복 | `BUS_RECOVERED` 대기 |
| 복구만 반복 | 배선·종단 원인 미해결 | TEC/REC·bus_error 로그 |
| `twai_transmit` 실패 무시 | 응답 없는 요청, 카운터 불일치 | 실패 카운터·재시도 |
| 태스크별 워치독 미등록 | 일부 태스크가 죽어도 모름 | TWDT 등록·하트비트 |

## 장 요약

- FreeRTOS 태스크는 독립 스택과 우선순위를 가진 실행 흐름이다. ESP-IDF에서 스택 크기는 바이트 단위다.
- 큐는 항목을 복사한다. 길이·항목 크기·블로킹 타임아웃·가득 참 정책을 설계한다.
- ISR에서는 `FromISR` API만 쓰고, `pxHigherPriorityTaskWoken`과 `portYIELD_FROM_ISR`를 함께 쓴다.
- TWAI 드라이버 RX 큐(`rx_queue_len`)와 응용 큐는 별개다. 둘 다 오버플로를 관측한다.
- 경보 태스크가 `TWAI_ALERT_BUS_OFF`를 받아 `twai_initiate_recovery()`를 호출하고, `TWAI_ALERT_BUS_RECOVERED` 뒤에 `twai_start()`를 호출한다.
- CAN 수신은 높은 우선순위, 파싱·요청은 중간, 로그는 낮은 우선순위로 둔다. 우선순위는 측정으로 조정한다.
- 뮤텍스는 짧게. 우선순위 상속은 역전을 없애지 않고 시간을 한정할 뿐이다.
- 워치독은 정상 완료 지점에서 리셋하고, 태스크별 하이워터마크·드롭·오류 카운터를 남긴다.
- 이 장의 ESP32 코드는 ESP-IDF로 빌드·실행하지 못했으므로 실물에서 API·핀·스택을 확인해야 한다.

다음 장에서는 같은 펌웨어 문제를 Rust로 접근한다. 소유권이 메모리 오류를 컴파일 시점에 어떻게 막는지, `embedded-hal`과 Embassy의 async 실행기가 FreeRTOS와 무엇이 다른지 본다.

## 연습 문제

### 1. 태스크와 스택

ESP-IDF에서 스택 4096바이트인 태스크를 4개 만들려 한다.

1. 스택만으로 RAM을 얼마나 쓰는가?
2. `uxTaskGetStackHighWaterMark(NULL)`이 120을 돌려주면 무엇을 뜻하는가?
3. 스택을 2048로 줄여도 되는지 판단하는 절차를 쓰라.

### 2. 큐 길이

CAN 버스에서 초당 최대 1,500프레임이 들어오고, `obd_task`가 최악 300ms 동안 큐를 비우지 못한다.

1. 필요한 큐 길이는 몇 개인가?
2. 큐가 32개면 어떤 일이 생기는가?
3. 드라이버 RX 큐와 응용 큐 중 어느 쪽이 먼저 넘칠지 어떻게 알 수 있는가?

### 3. ISR과 큐

1. ISR에서 `xQueueSendFromISR()`의 세 번째 인자는 무엇인가?
2. 그 값이 `pdTRUE`일 때 ISR 끝에서 무엇을 해야 하는가?
3. ISR에서 `xQueueSend()`를 쓰면 왜 안 되는가?

### 4. Bus-Off 복구

다음 동작을 올바른 순서로 나열하라.

```text
A. twai_start()
B. TWAI_ALERT_BUS_OFF 수신
C. TWAI_ALERT_BUS_RECOVERED 수신
D. twai_initiate_recovery()
E. RECOVERING → STOPPED
```

### 5. 우선순위 역전

낮은 우선순위 태스크 L이 뮤텍스를 잡고, 높은 우선순위 H가 그 뮤텍스를 기다린다. 중간 우선순위 M이 계속 준비 상태다.

1. 우선순위 상속이 없으면 어떤 일이 생기는가?
2. FreeRTOS 뮤텍스의 우선순위 상속은 무엇을 보장하는가?
3. 그래도 설계에서 피해야 할 것은 무엇인가?

## 정답과 해설

### 1.

1. 4096 × 4 = 16,384바이트(16KB). 태스크 제어 블록·큐·힙도 별도다.
2. 태스크 생성 후 스택 여유가 최소 120바이트까지 줄었다는 뜻이다. 0에 가까우면 오버플로 위험이 크다.
3. 하이워터마크를 여러 부하 조건(최대 트래픽, 로그, Wi-Fi 재연결)에서 측정하고, 가장 작은 여유의 2배 이상을 남긴다. 줄인 뒤 다시 측정한다. `printf`·부동소수점·깊은 호출이 스택을 더 쓸 수 있다.

### 2.

1. 1,500프레임/초 × 0.3초 = 450개. 최소 450개, 여유를 두어 512개 이상.
2. 300ms 동안 450개가 들어오는데 32개만 저장되므로 418개 이상을 잃는다. `app_drops`가 증가하고 OBD 응답을 놓칠 수 있다.
3. `TWAI_ALERT_RX_QUEUE_FULL`과 `rx_missed_count`가 증가하면 드라이버 RX 큐가 넘친 것이다. 응용 큐는 `xQueueSend` 실패 카운터로 안다. 둘을 별도로 로그에 남긴다.

### 3.

1. `BaseType_t *pxHigherPriorityTaskWoken`. 전송이 더 높은 우선순위 태스크를 깨웠는지 돌려받는다.
2. `portYIELD_FROM_ISR(value)`를 호출해 ISR을 나가기 전에 문맥 전환을 요청한다.
3. 일반형은 블로킹할 수 있고, ISR에는 블로킹할 태스크 문맥이 없다. FreeRTOS 문서는 ISR에서 `FromISR`이 아닌 API를 절대 쓰지 말라고 한다.

### 4.

`B → D → E → C → A`. Bus-Off 경보를 받고, `twai_initiate_recovery()`로 복구를 시작하고, 복구가 끝나 STOPPED가 된 뒤 `TWAI_ALERT_BUS_RECOVERED`를 받고, `twai_start()`로 RUNNING으로 돌아간다.

### 5.

1. H는 L이 뮤텍스를 놓을 때까지 기다리는데, M이 L을 계속 선점하면 H는 무한정 기다릴 수 있다(unbounded priority inversion).
2. H가 기다리는 동안 L의 우선순위를 H까지 올려, M이 L을 선점하지 못하게 한다. 역전을 없애지는 않고 **시간을 한정**한다.
3. 뮤텍스를 잡은 채 오래 걸리는 일, 중첩 뮤텍스, 무한 대기, ISR에서 뮤텍스 사용. 가능하면 큐와 단일 소유자(gatekeeper) 구조로 바꾼다.
