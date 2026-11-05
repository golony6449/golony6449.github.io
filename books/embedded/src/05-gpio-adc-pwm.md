# 5장 GPIO·ADC·PWM: 핀으로 세상과 말하기

## 이 장에서

4장에서 전압·전류·접지를 배웠다. 이제 그 기초를 **핀**으로 옮긴다. MCU의 핀은 크게 세 가지 일을 한다.

- **디지털 입력**: 버튼, 스위치, 센서의 HIGH/LOW를 읽는다.
- **디지털 출력**: LED, 릴레이, 다른 칩을 켜고 끈다.
- **아날로그 입력(ADC)**: 전압을 숫자로 바꾼다.
- **PWM 출력**: 디지털 출력을 빠르게 켜고 꺼서 평균 전압·밝기·속도를 만든다.

웹 개발자에게 이 핀들은 **이벤트 소스와 출력 스트림**에 가깝다. 버튼 입력은 `addEventListener`, 폴링은 `setInterval`, 인터럽트는 콜백, ADC는 문자열을 숫자로 파싱하는 일, PWM은 듀티비만큼 켜지는 타이머다. 하지만 차이가 크다. 이벤트는 놓쳐도 다시 오지만, 전기 신호는 놓치면 사라지고, 잘못된 전류는 핀을 태운다.

이 장에서 다루는 것:

- 디지털 입력, 풀업/풀다운, 채터링과 디바운스
- 디지털 출력과 전류 한도, LED·릴레이·모터 구동
- 인터럽트와 폴링의 선택 기준
- ADC의 분해능·기준 전압·샘플링·감쇠
- 분압 회로로 12V를 안전하게 측정하는 방법
- PWM의 주기·주파수·듀티와 ESP32 LEDC
- ESP-IDF의 `gpio`, `adc_oneshot`, `ledc` API 대조

PC에서 확인할 수 있는 계산과 디바운스 로직은 파이썬으로 실행해 확인했다. ESP32 실물이 필요한 코드는 ESP-IDF 문서의 API와 대조만 했고, **실물 확인 필요**로 표시한다.

## 5.1 디지털 입력

### HIGH와 LOW를 읽는다

디지털 입력 핀은 전압을 HIGH 또는 LOW로 해석한다. 3.3V 계열 ESP32의 경계는 데이터시트 기준 `VIH ≥ 0.75 × VDD ≈ 2.475V`, `VIL ≤ 0.25 × VDD ≈ 0.825V`다. 그 사이 전압은 보장되지 않는다.

가장 흔한 입력은 버튼이다. 버튼을 누르면 핀이 GND에 연결되고, 떼면 풀업이 HIGH를 만든다. 이때 논리는 **눌림 = LOW**다. 코드에서 `0`을 "눌림"으로 읽는 것이 헷갈리면, 읽은 뒤 한 번 반전해 변수 이름을 명확히 한다.

```c
#include "driver/gpio.h"

#define BUTTON_GPIO GPIO_NUM_4

static void button_init(void) {
    gpio_config_t cfg = {
        .pin_bit_mask = 1ULL << BUTTON_GPIO,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_NEGEDGE,
    };
    ESP_ERROR_CHECK(gpio_config(&cfg));
}

static bool button_pressed(void) {
    return gpio_get_level(BUTTON_GPIO) == 0;
}
```

`gpio_config()`는 핀의 모드·풀업·풀다운·인터럽트 종류를 한 번에 설정한다. ESP32의 내부 풀업은 데이터시트 기준 45kΩ typ이므로, 긴 선이나 노이즈가 많은 환경에서는 외부 10kΩ 풀업이 낫다. GPIO34~39는 입력 전용이고 내부 풀업/풀다운이 없으므로 외부 저항이 필요하다.

### 채터링

기계식 버튼은 누르거나 뗄 때 접점이 몇 ms 동안 붙었다 떨어졌다 한다. 이를 **채터링(bouncing)**이라고 한다. 사람은 한 번 눌렀다고 생각하지만, 핀은 수십 번 HIGH/LOW를 오갈 수 있다. 이대로 이벤트를 세면 버튼 한 번에 카운터가 여러 번 올라간다.

해결책은 **디바운스(debounce)**다. 대표적인 방법은 "입력이 바뀐 뒤 일정 시간(예: 20ms) 동안 같은 값이 유지되면 그때 확정"하는 것이다.

```python
class Debounce:
    def __init__(self, stable=False):
        self.stable = stable
        self.candidate = stable
        self.candidate_since_ms = 0

    def update(self, raw, now_ms):
        if raw != self.candidate:
            self.candidate = raw
            self.candidate_since_ms = now_ms
        if self.candidate != self.stable and now_ms - self.candidate_since_ms >= 20:
            self.stable = self.candidate
        return self.stable
```

시뮬레이션으로 확인해 보자. 10~19ms 동안 1ms마다 튀고, 20ms부터 눌림이 유지되며, 100~109ms에 다시 튀는 입력을 만들었다.

```text
debounced HIGH at 40ms (raw=1)
debounced LOW at 130ms (raw=0)
raw edges=22, debounced edges=2, final=LOW
```

원시 입력은 22번 바뀌었지만, 디바운스 후에는 2번만 바뀌었다. 실제 코드에서는 `now_ms`를 `esp_timer_get_time() / 1000`이나 `xTaskGetTickCount()`로 받는다. 루프가 1ms마다 돌지 않아도 되지만, **샘플링 주기가 디바운스 시간보다 충분히 짧아야** 한다.

하드웨어 디바운스도 있다. 저항과 커패시터로 RC 필터를 만들면 `τ = R × C`로 완만해진다. 10kΩ·100nF면 `τ = 1ms`이고, 20ms를 원하면 100kΩ·200nF 같은 값을 쓴다. RC만으로는 히스테리시스가 없어 느린 에지에서 다시 튈 수 있으므로, 보통 소프트웨어 디바운스와 함께 쓴다.

### ESP-IDF 입력 API

| 할 일 | ESP-IDF API |
|---|---|
| 핀 설정 | `gpio_config()` |
| 값 읽기 | `gpio_get_level()` |
| 풀업/풀다운 | `gpio_set_pull_mode()`, `gpio_pullup_en()` |
| 입력만 켜기 | `gpio_input_enable()` |
| 인터럽트 종류 | `gpio_set_intr_type()` |
| 인터럽트 켜기 | `gpio_intr_enable()` |

`gpio_config()`는 기존 설정을 덮어쓴다. 주변장치가 이미 쓰는 핀에 입력만 추가하려면 `gpio_input_enable()`을 쓴다.

## 5.2 디지털 출력

### push-pull과 open-drain

디지털 출력에는 두 방식이 있다.

- **push-pull**: HIGH일 때 전원으로, LOW일 때 GND로 능동적으로 밀어낸다. 일반 GPIO 출력이 이것이다.
- **open-drain**: LOW로 당기기만 하고 HIGH는 풀업이 만든다. I2C, 여러 장치가 선을 공유하는 신호, 5V 장치와의 레벨 변환에 쓴다.

ESP-IDF에서는 `GPIO_MODE_OUTPUT`이 push-pull, `GPIO_MODE_OUTPUT_OD`가 open-drain이다.

```c
gpio_set_direction(GPIO_NUM_5, GPIO_MODE_OUTPUT);
gpio_set_level(GPIO_NUM_5, 1);   // HIGH
gpio_set_level(GPIO_NUM_5, 0);   // LOW
```

### 전류 한도

ESP32 데이터시트의 DC 특성은 최대 구동에서 `IOH 40mA typ`, `IOL 28mA typ`다. 누적 IO 출력 전류는 칩 1200mA, 모듈 1100mA다. 이 숫자들은 **"핀마다 40mA를 계속 써도 된다"는 뜻이 아니다.** 발열·전압 강하·누적 한도가 걸리고, 핀별 절대 최대 전류는 공개되어 있지 않다.

안전한 설계는 다음과 같다.

- LED: 직렬 저항으로 전류를 1~10mA 수준으로 제한한다.
- 릴레이·모터·솔레노이드: MCU 핀에 직접 연결하지 않는다. 트랜지스터/MOSFET/모터 드라이버를 쓴다.
- 유도성 부하: 플라이백 다이오드를 둔다.
- 여러 LED를 동시에 켤 때: 전체 전류와 발열을 계산한다.
- 부팅 중 상태가 중요한 핀(strapping pin): 데이터시트에서 확인한다.

3.3V에서 2.0V LED를 5mA로 켜려면 `R = (3.3 − 2.0) / 0.005 = 260Ω`이다. 270Ω을 쓰면 약 4.8mA다. 4장의 계산과 같다.

### 예: LED 점멸

```c
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define LED_GPIO GPIO_NUM_5

void app_main(void) {
    gpio_set_direction(LED_GPIO, GPIO_MODE_OUTPUT);
    while (1) {
        gpio_set_level(LED_GPIO, 1);
        vTaskDelay(pdMS_TO_TICKS(500));
        gpio_set_level(LED_GPIO, 0);
        vTaskDelay(pdMS_TO_TICKS(500));
    }
}
```

이 코드는 ESP32 실물에서 확인하지 못했다. **실물 확인 필요.** 핀 번호는 보드마다 다르므로, 사용하는 보드의 핀 배치와 strapping pin을 확인한다.

### active low 출력

릴레이 모듈과 일부 LED 모듈은 **active low**다. 출력 LOW가 "켜짐"이다. 코드에서 `gpio_set_level(pin, 0)`이 켜는 것인지, 데이터시트와 모듈 표기를 확인한다. 부팅 직후 핀이 LOW로 떨어지면 릴레이가 잠깐 켜질 수 있다. 초기 상태가 중요한 장치는 풀업/풀다운과 부팅 순서를 설계한다.

## 5.3 인터럽트 대 폴링

### 두 가지 읽기 방식

**폴링**은 메인 루프에서 주기적으로 `gpio_get_level()`을 읽는다. 단순하고 디버깅하기 쉽다. 대신 루프가 다른 일로 바쁘면 입력을 놓치고, 응답 지연이 생긴다.

**인터럽트**는 핀 상태가 바뀔 때 ISR(인터럽트 서비스 루틴)이 실행된다. 빠른 이벤트를 놓치지 않고 CPU를 낭비하지 않는다. 대신 ISR은 짧아야 하고, 공유 변수·큐를 조심해야 한다.

웹 비유로는 폴링이 `setInterval`로 상태를 확인하는 것이고, 인터럽트가 `addEventListener`에 가깝다. 다만 웹의 이벤트 루프와 달리 ISR은 **현재 실행 중인 코드를 즉시 가로챈다.** ISR 안에서 긴 작업을 하면 다른 인터럽트와 태스크가 지연된다.

### ISR 규칙

- ISR은 짧게. 로그 출력, 동적 할당, 블로킹 호출을 하지 않는다.
- 공유 변수는 `volatile`만으로 충분하지 않다. 32비트 읽기/쓰기의 원자성과 메모리 순서를 확인하고, 가능하면 큐로 넘긴다.
- FreeRTOS API는 `FromISR` 버전을 쓴다. `xQueueSendFromISR`, `portYIELD_FROM_ISR`.
- 채터링은 인터럽트를 여러 번 발생시킨다. ISR에서 시간을 기록하고, 태스크에서 디바운스한다.
- ISR 핸들러에 `IRAM_ATTR`이 필요한지는 인터럽트 할당 플래그(`ESP_INTR_FLAG_IRAM`)에 따라 다르다. ESP-IDF 문서를 확인한다.

```c
static QueueHandle_t button_events;

static void IRAM_ATTR button_isr(void *arg) {
    TickType_t now_ticks = xTaskGetTickCountFromISR();
    BaseType_t woken = pdFALSE;
    xQueueSendFromISR(button_events, &now_ticks, &woken);
    if (woken == pdTRUE) {
        portYIELD_FROM_ISR();
    }
}

void button_events_init(void) {
    button_events = xQueueCreate(8, sizeof(TickType_t));
    gpio_install_isr_service(0);
    gpio_isr_handler_add(BUTTON_GPIO, button_isr, NULL);
}
```

이 코드도 ESP32 실물에서 확인하지 못했다. **실물 확인 필요.** `gpio_install_isr_service()`는 전역 `gpio_isr_register()` 방식과 함께 쓸 수 없고, 한 번만 호출한다.

### 무엇을 고를까

| 상황 | 권장 |
|---|---|
| 버튼·센서 변화가 드물고 응답이 중요 | 인터럽트 + 큐 |
| 주기적으로 여러 입력을 훑음 | 폴링 |
| 입력이 매우 빠름(엔코더 등) | 전용 주변장치 또는 인터럽트 + 하드웨어 카운터 |
| 디바운스·상태 기계가 복잡 | 인터럽트로 시각만 받고 태스크에서 처리 |
| 배터리 절전 | 인터럽트/웨이크 사용, 폴링 최소화 |

인터럽트를 쓰면 "이벤트를 놓치지 않는다"는 장점이 있지만, **처리 시간이 길면 결국 큐가 넘친다.** 폴링은 단순하지만 주기가 길면 놓친다. 둘 다 실패 모드를 이해하고 고른다.

## 5.4 ADC: 아날로그를 숫자로

### 분해능과 기준 전압

ADC는 전압을 정해진 단계로 나눠 숫자로 바꾼다. `N`비트 ADC는 `2^N` 단계를 갖는다. 12비트면 4096단계(0~4095)다. 기준 전압 `V_ref`가 있으면 한 단계(LSB)는 다음과 같다.

```text
LSB = V_ref / 2^N
V = counts × V_ref / (2^N − 1)
```

기준 전압이 3.3V, 12비트라면 `LSB = 3.3 / 4096 ≈ 0.806mV`다. counts 2048은 약 1.65V다.

```python
def counts_to_voltage(counts, v_ref, bits):
    return counts / (2**bits - 1) * v_ref

for counts in (0, 1024, 2048, 3072, 4095):
    print(f"{counts:4d} -> {counts_to_voltage(counts, 3.3, 12):.4f}V")
```

```text
   0 -> 0.0000V
1024 -> 0.8252V
2048 -> 1.6504V
3072 -> 2.4756V
4095 -> 3.3000V
```

분해능은 "작은 전압 차이를 얼마나 구분하는가"다. 12비트라도 기준 전압이 흔들리거나 노이즈가 크면 실제 정밀도는 떨어진다. ADC의 정확도는 분해능만으로 결정되지 않는다.

### ESP32 ADC의 실제

ESP32의 ADC는 12비트가 기본이고, 내부 기준 전압은 명목 1.1V(실제 1.0~1.2V)다. 기준 전압이 작아 그대로는 0~1.1V만 잴 수 있다. 그래서 **감쇠(attenuation)**로 측정 범위를 넓힌다.

| 감쇠 | 권장 측정 범위(ESP-IDF) |
|---|---|
| `ADC_ATTEN_DB_0` | 약 100~950mV |
| `ADC_ATTEN_DB_2_5` | 약 100~1250mV |
| `ADC_ATTEN_DB_6` | 약 150~1750mV |
| `ADC_ATTEN_DB_12` | 약 150~2450mV |

`ADC_ATTEN_DB_11`은 예전 이름이고 `ADC_ATTEN_DB_12`와 같다. 권장 범위는 **정확도가 보장되는 범위**이지 절대 최대가 아니다. 그 위로 넣으면 선형성이 나빠지고, 절대 최대 3.6V를 넘으면 핀이 상한다.

ESP32의 ADC 입력은 0~3.3V 범위에서 동작하도록 설계되었지만, 데이터시트의 절대 최대는 3.6V다. 5V를 직접 넣지 않는다. 또한 ADC2는 Wi-Fi와 자원을 공유한다. ESP-IDF oneshot 드라이버는 충돌 보호를 넣었지만, Wi-Fi를 쓰는 동안에는 ADC1(GPIO32~39)을 쓰는 편이 안전하다. 칩 리비전·IDF 버전에 따라 제약 표현이 다르므로 `확인 필요`다.

ESP32 ADC는 선형성이 좋지 않아 보정이 필요할 수 있다. ESP-IDF는 `adc_oneshot_get_calibrated_result()`와 calibration API를 제공한다. 교정 없이 정밀 측정을 기대하지 않는다.

### ESP-IDF ADC oneshot 코드

```c
#include "esp_adc/adc_oneshot.h"

static adc_oneshot_unit_handle_t adc1;

static void adc_init(void) {
    adc_oneshot_unit_init_cfg_t unit_cfg = {
        .unit_id = ADC_UNIT_1,
    };
    ESP_ERROR_CHECK(adc_oneshot_new_unit(&unit_cfg, &adc1));

    adc_oneshot_chan_cfg_t chan_cfg = {
        .atten = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    // ESP32: ADC1_CHANNEL_6 = GPIO34 (입력 전용)
    ESP_ERROR_CHECK(adc_oneshot_config_channel(adc1, ADC_CHANNEL_6, &chan_cfg));
}

static int adc_read_raw(void) {
    int raw = 0;
    ESP_ERROR_CHECK(adc_oneshot_read(adc1, ADC_CHANNEL_6, &raw));
    return raw;
}
```

이 코드는 ESP32 실물에서 확인하지 못했다. **실물 확인 필요.** `ADC_CHANNEL_6`의 GPIO 매핑은 칩·보드마다 다르므로 `adc_oneshot_io_to_channel()`로 확인하거나 데이터시트의 표를 본다.

### 노이즈와 평균

ADC 값은 노이즈로 흔들린다. 대책은 다음과 같다.

- 여러 번 읽어 평균하거나 중앙값을 쓴다. 급한 스파이크에는 중앙값이 낫다.
- 샘플링 시간을 데이터시트 권장값에 맞춘다.
- 센서 입력에 작은 커패시터를 두어 고주파 노이즈를 줄인다(센서 출력 임피던스와 함께 계산).
- 전원·접지를 확인한다. ADC 노이즈의 상당 부분은 전원에서 온다.
- 가능하면 교정된 API를 쓴다.

평균은 정확도를 마법처럼 올리지 않는다. 계통 오차(기준 전압 오차, 분압 저항 오차)는 평균으로 사라지지 않는다.

## 5.5 분압으로 전압 측정

12V 배터리 전압을 ESP32 ADC로 읽으려면 12V를 ADC 범위로 낮춰야 한다. 4장의 분압 공식을 다시 쓴다.

```text
V_out = V_in × R2 / (R1 + R2)
V_in_max = V_adc_max × (R1 + R2) / R2
```

ESP32의 12dB 감쇠 권장 상한을 2.45V로 잡고, 최대 18V까지 재도록 `R1 = 68kΩ`, `R2 = 10kΩ`을 고르자.

```python
def divider(v_in, r_top, r_bottom):
    return v_in * r_bottom / (r_top + r_bottom)

for vin in (12.0, 14.4, 18.0, 24.0):
    print(f"{vin:4.1f}V -> {divider(vin, 68_000, 10_000):.3f}V")
```

```text
12.0V -> 1.538V
14.4V -> 1.846V
18.0V -> 2.308V
24.0V -> 3.077V
```

12V에서 1.54V, 14.4V(충전 중)에서 1.85V, 18V에서 2.31V다. 2.45V 기준으로 18V까지는 권장 범위 안이다. 24V 점프스타트는 3.08V로 권장 범위를 넘지만 3.6V 절대 최대보다는 낮다. 그래도 **그대로 차량에 연결하지 않는다.** 점프스타트·load dump에서는 24V보다 높은 과도가 올 수 있으므로, 15장에서 다루는 TVS·클램프·퓨즈가 필요하다.

ADC counts로 바꾸면 다음과 같다(2.45V 기준, 12비트).

```text
12.0V -> 1.538V, counts=2571
14.4V -> 1.846V, counts=3086
18.0V -> 2.308V, counts=3857
24.0V -> 3.077V, counts=4095 (포화)
```

입력 환산 1LSB는 약 4.7mV다. 즉 12V를 4.7mV 단위로 읽는다. 저항 1% 오차와 ADC 오차를 더하면 실제 정확도는 이보다 나쁘다.

### 분압 설계 체크리스트

- 최대 입력(명목값이 아니라 과도 전압)에서 ADC 권장 범위 안에 들어오는가?
- 분압 전류가 배터리를 방전시키지 않는가? (15장)
- 저항 전력이 정격의 절반 이하인가?
- ADC 입력 임피던스가 분압비를 흐리지 않는가?
- 입력 보호(직렬 저항, 클램프, TVS)가 있는가?
- 저항 허용 오차와 ADC 오차를 합친 정확도가 목적에 충분한가?

## 5.6 PWM

### 주기·주파수·듀티

PWM(Pulse Width Modulation)은 디지털 출력을 일정 주기로 켜고 끄는 것이다.

- **주기(period)**: 한 번 켜고 끄는 시간
- **주파수(frequency)**: `1 / 주기`
- **듀티(duty)**: 한 주기에서 HIGH인 비율

평균 전압은 `V_avg = V_supply × duty`다. 3.3V, 듀티 25%면 평균 0.825V다.

```python
def pwm_average(v_supply, duty):
    return v_supply * duty

for duty in (0.0, 0.25, 0.5, 0.75, 1.0):
    print(f"duty={duty * 100:5.1f}% -> 평균 {pwm_average(3.3, duty):.3f}V")
```

```text
duty=  0.0% -> 평균 0.000V
duty= 25.0% -> 평균 0.825V
duty= 50.0% -> 평균 1.650V
duty= 75.0% -> 평균 2.475V
duty=100.0% -> 평균 3.300V
```

용도별 주파수는 대략 다음과 같다.

| 용도 | 주파수 | 이유 |
|---|---|---|
| LED 밝기 | 1kHz 이상 | 눈에 깜빡임이 덜 보이게 |
| DC 모터 속도 | 20kHz 안팎 | 가청 소음 회피 |
| 서보 | 50Hz(20ms) | 1~2ms 펄스 폭으로 각도 지정 |
| 히터 | 수 Hz~수십 Hz | 열 관성으로 충분 |
| 오디오 | 수십 kHz | 가청 대역 밖 |

서보는 듀티가 아니라 **펄스 폭**이 중요하다. 20ms 주기에서 1.5ms는 7.5% 듀티다.

```python
def servo_duty(pulse_ms, period_ms=20.0):
    return pulse_ms / period_ms

for pulse in (1.0, 1.5, 2.0):
    print(f"서보 펄스 {pulse:.1f}ms -> duty {servo_duty(pulse) * 100:.1f}%")
```

```text
서보 펄스 1.0ms -> duty 5.0%
서보 펄스 1.5ms -> duty 7.5%
서보 펄스 2.0ms -> duty 10.0%
```

### 주파수와 분해능의 트레이드오프

PWM은 타이머 클록을 나눠 만든다. 주파수가 높을수록 한 주기에 들어가는 카운트가 줄어들어 듀티 분해능이 낮아진다. ESP-IDF LEDC 문서의 예를 보면 5kHz에서 13비트(8192단계)가 가능하고, 40MHz에서는 1비트(50% 고정)만 가능하다. 20MHz·3비트는 불가능하고 2비트는 가능하다.

즉 "주파수를 높이면 밝기 단계가 거칠어진다." LED는 1kHz·10비트면 충분하고, 모터는 20kHz에서 8~10비트 정도를 쓴다. `ledc_find_suitable_duty_resolution()`로 가능한 분해능을 확인할 수 있다.

### ESP-IDF LEDC 코드

```c
#include "driver/ledc.h"

static void pwm_init(void) {
    ledc_timer_config_t timer = {
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .duty_resolution = LEDC_TIMER_13_BIT,
        .timer_num = LEDC_TIMER_0,
        .freq_hz = 5000,
        .clk_cfg = LEDC_AUTO_CLK,
    };
    ESP_ERROR_CHECK(ledc_timer_config(&timer));

    ledc_channel_config_t channel = {
        .gpio_num = GPIO_NUM_18,
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .channel = LEDC_CHANNEL_0,
        .intr_type = LEDC_INTR_DISABLE,
        .timer_sel = LEDC_TIMER_0,
        .duty = 0,
        .hpoint = 0,
    };
    ESP_ERROR_CHECK(ledc_channel_config(&channel));
}

static void pwm_set_percent(int percent) {
    // 13비트: 0~8191. 50% = 4096.
    uint32_t duty = (uint32_t)(8192 * percent / 100);
    if (duty > 8191) duty = 8191;
    ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, duty);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0);
}
```

이 코드는 ESP32 실물에서 확인하지 못했다. **실물 확인 필요.** 타이머를 채널보다 먼저 설정해야 첫 펄스부터 올바른 주파수가 나온다. `ledc_set_duty()` 뒤에 `ledc_update_duty()`를 호출해야 적용된다. ESP32-C3 등 일부 칩은 low-speed 모드만 지원한다.

### PWM을 아날로그처럼

PWM 출력을 RC 저역 통과 필터에 넣으면 평균 전압을 아날로그처럼 쓸 수 있다. 시정수가 PWM 주기보다 충분히 길어야 리플이 줄어든다. 반대로 LED·모터처럼 관성이 있는 부하는 필터 없이도 평균 효과를 낸다.

## 5.7 ESP-IDF 대조표

| 개념 | ESP-IDF API | 확인 |
|---|---|---|
| 입력 설정 | `gpio_config()`, `gpio_set_direction()` | 문서 |
| 입력 읽기 | `gpio_get_level()` | 문서 |
| 출력 쓰기 | `gpio_set_level()` | 문서 |
| 풀업/풀다운 | `gpio_set_pull_mode()` | 문서 |
| 인터럽트 | `gpio_install_isr_service()`, `gpio_isr_handler_add()` | 문서 |
| ADC 단위 | `adc_oneshot_new_unit()` | 문서 |
| ADC 채널 | `adc_oneshot_config_channel()` | 문서 |
| ADC 읽기 | `adc_oneshot_read()` | 문서 |
| ADC 교정 | `adc_oneshot_get_calibrated_result()` | 문서 |
| PWM 타이머 | `ledc_timer_config()` | 문서 |
| PWM 채널 | `ledc_channel_config()` | 문서 |
| PWM 듀티 | `ledc_set_duty()`, `ledc_update_duty()` | 문서 |

표의 API는 ESP-IDF v5.x 문서를 기준으로 했다. v6.x에서는 TWAI처럼 API가 바뀔 수 있으므로, 프로젝트의 IDF 버전에 맞는 문서를 본다.

## 5.8 흔한 실수

| 증상 | 원인 후보 | 확인 방법 | 조치 |
|---|---|---|---|
| 버튼이 한 번에 여러 번 | 채터링, 디바운스 없음 | 이벤트 간격 로그 | 20ms 디바운스, RC |
| 입력이 제멋대로 | 플로팅, 풀업 없음 | 핀 전압 | 풀업/풀다운 설정 |
| LED가 너무 밝거나 핀이 뜨거움 | 저항 없음/작음 | 전류 계산 | 직렬 저항 |
| 모터를 핀에 직결해 보드 손상 | 과전류, 유도 전압 | 데이터시트, 전류 측정 | 드라이버, 플라이백 |
| ISR에서 시스템 멈춤 | 긴 작업, 블로킹, 로그 | ISR 코드 | 큐로 넘기고 태스크 처리 |
| ADC 값이 튐 | 노이즈, 기준 전압, 접지 | 평균·중앙값, 전원 파형 | 필터, 접지, 교정 |
| ADC가 포화 | 입력이 권장 범위 초과 | counts 4095 | 분압비 조정, 클램프 |
| 12V를 ADC에 직결 | 보호 없음 | 입력 전압 | 분압·TVS·퓨즈 |
| PWM이 안 먹음 | `update_duty` 누락, 타이머 순서 | 코드 | `ledc_update_duty()` 호출 |
| 서보가 떨림 | 주파수/펄스 폭 오류, 전원 부족 | 파형, 전원 | 50Hz·1~2ms, 별도 전원 |

## 장 요약

- 디지털 입력은 풀업/풀다운으로 기준을 정하고, 기계식 접점은 디바운스한다.
- 디지털 출력은 핀 전류 한도를 지키고, 부하는 트랜지스터/드라이버로 구동한다.
- 폴링은 단순하고, 인터럽트는 빠르지만 ISR을 짧게 유지해야 한다.
- ADC는 분해능·기준 전압·감쇠·노이즈가 함께 정확도를 결정한다.
- ESP32 ADC는 12비트, 내부 기준 1.1V, 감쇠로 범위를 넓힌다. ADC2는 Wi-Fi와 자원을 공유한다.
- 분압은 명목값이 아니라 최대 입력에서 검증한다. 12V를 그대로 ADC에 넣지 않는다.
- PWM은 주파수와 듀티로 평균 전압을 만든다. 주파수와 분해능은 트레이드오프다.
- ESP-IDF에서는 `gpio`, `adc_oneshot`, `ledc` API로 각각을 다룬다.
- 실물이 필요한 코드는 보드·핀·IDF 버전에서 확인해야 한다.

다음 장에서는 이 핀 위에 **버스**를 올린다. I2C와 SPI는 여러 장치가 선을 공유하는 방법을 배운다. 풀업, 오픈 드레인, 레벨, 타이밍이 다시 나오므로 4·5장의 내용이 그대로 쓰인다.

## 연습 문제

### 1. (기초) 입력과 디바운스

1. 풀업 10kΩ, 3.3V에서 버튼을 눌렀을 때 흐르는 전류는?
2. 채터링이란 무엇인가?
3. 20ms 디바운스에서 입력이 5ms 동안 튀다가 안정되면, 확정까지 최소 몇 ms가 걸리는가?

### 2. (기초) 출력 전류

1. 3.3V에서 2.0V LED를 8mA로 켜려면 저항은 몇 Ω인가?
2. ESP32 데이터시트의 `IOH 40mA typ`를 "핀마다 40mA를 계속 써도 된다"로 해석하면 왜 위험한가?
3. 릴레이를 MCU 핀에 직접 연결하면 안 되는 이유는?

### 3. (중급) ADC

12비트 ADC, 기준 전압 3.3V다.

1. LSB는 몇 mV인가?
2. counts 2048은 몇 V인가?
3. ESP32의 12dB 감쇠 권장 상한이 2.45V일 때, 기준 전압을 2.45V로 보면 LSB는 몇 mV인가?

### 4. (중급) 분압

12V를 ESP32 ADC(12dB 감쇠, 권장 상한 2.45V)로 재려고 `R1=68kΩ`, `R2=10kΩ`을 썼다.

1. 12V, 14.4V, 18V에서 출력 전압을 구하라.
2. 2.45V 기준으로 18V의 counts를 구하라.
3. 24V 점프스타트에서 출력은? 이때 필요한 보호는 무엇인가?

### 5. (심화) PWM 설계

3.3V, 5kHz PWM으로 LED 밝기를 조절하려 한다.

1. 13비트 분해능이 가능한가? 가능하다면 듀티 단계는 몇 개인가?
2. 듀티 25%의 평균 전압은?
3. 서보를 같은 타이머로 제어하려면 주파수를 어떻게 바꿔야 하는가? 그때 분해능은 어떻게 되는가?

## 정답과 해설

### 1.

1. `3.3 / 10k = 0.33mA`
2. 기계식 접점이 붙었다 떨어졌다를 반복해 한 번의 눌림이 여러 번의 HIGH/LOW 전이로 보이는 현상이다.
3. 입력이 안정된 시점부터 20ms다. 튀는 동안에는 후보가 계속 바뀌므로, 마지막 변화 후 20ms가 지나야 확정된다. 위 시뮬레이션에서는 20ms에 안정된 입력이 40ms에 확정됐다.

### 2.

1. `R = (3.3 − 2.0) / 0.008 = 162.5Ω`. 160Ω 또는 180Ω을 쓰고 실제 전류를 다시 계산한다.
2. 40mA는 최대 구동·특정 조건의 typ 값이고, 누적 IO 전류 한도·발열·전압 강하가 따로 있다. 핀별 절대 최대 전류도 공개되어 있지 않다. 설계는 훨씬 낮은 전류로 잡는다.
3. 릴레이 코일은 수십 mA 이상을 쓰고 유도성 부하라서, MCU 핀의 전류 한도를 넘고 역기전력으로 핀이 손상될 수 있다. 트랜지스터/MOSFET과 플라이백 다이오드를 쓴다.

### 3.

1. `3.3 / 4096 ≈ 0.806mV`
2. `2048 / 4095 × 3.3 ≈ 1.650V`
3. `2.45 / 4096 ≈ 0.598mV`. 다만 ESP32의 실제 ADC는 선형성·노이즈 때문에 이 분해능을 그대로 신뢰할 수 없다.

### 4.

1. `12 × 10/78 ≈ 1.538V`, `14.4 × 10/78 ≈ 1.846V`, `18 × 10/78 ≈ 2.308V`
2. `2.308 / 2.45 × 4095 ≈ 3857`
3. `24 × 10/78 ≈ 3.077V`. 권장 범위를 넘고, load dump에서는 더 높다. TVS/제너 클램프, 직렬 저항, 퓨즈, 필요하면 절연·보호 회로를 둔다. 이 책은 부품 값을 싣지 않는다.

### 5.

1. 가능하다. 13비트면 `2^13 = 8192`단계다. 다만 5kHz에서 가능한 최대 분해능인지 `ledc_find_suitable_duty_resolution()`로 확인한다.
2. `3.3 × 0.25 = 0.825V`
3. 서보는 50Hz가 필요하므로 타이머 주파수를 50Hz로 바꾼다. 주파수가 낮아지면 같은 클록에서 분해능은 높아지지만, 서보는 듀티 분해능보다 펄스 폭 정확도가 중요하다. LED와 서보를 같은 타이머에 묶으면 주파수를 공유하므로, 타이머를 분리하거나 소프트웨어로 펄스를 만든다.
