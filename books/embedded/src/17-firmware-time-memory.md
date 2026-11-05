# 17장 펌웨어의 시간과 메모리

## 이 장에서

13장에서 MCU의 큰 구조를 보았고, 16장에서 ESP32가 CAN 프레임을 받아 웹 화면까지 보내는 장치를 만들었다. 그 장치는 `loop()` 하나와 몇 개의 전역 변수로도 돌아간다. 하지만 응답이 간헐적으로 끊기고, 며칠 뒤에 멈추고, 메모리가 조금씩 줄어드는 문제를 만나면 "코드가 맞는데 왜?"라는 질문이 남는다.

이 장은 그 질문에 답하기 위한 **펌웨어의 시간과 메모리 모델**을 다룬다. 웹 개발자가 이미 아는 이벤트 루프, 가비지 컬렉션, `await`, 큐에 대응시키면서, MCU에서는 무엇이 사라지고 무엇을 직접 책임져야 하는지 설명한다. 16장의 TWAI 수신 코드를 예로 계속 사용한다.

이 장의 코드는 **PC(Linux gcc)에서 실제로 컴파일·실행해 확인한 것**과, MCU에서만 의미가 있어 **실물 확인이 필요한 것**을 구분해 표시한다. ESP32용 코드는 18장에서 FreeRTOS 태스크로 확장한다.

이 장에서 다루는 것:

- 플래시·SRAM·스택·힙·정적 메모리의 역할
- 동적 할당을 피하는 이유와 고정 블록 풀
- `volatile`이 보장하는 것과 보장하지 않는 것
- ISR에서 해도 되는 일과 안 되는 일
- ISR과 메인 루프 사이의 락 없는 SPSC 링 버퍼
- 시간 비교·오버플로·주기 태스크·최악 지연
- 워치독이 감시하는 것과 리셋 지점
- 웹의 이벤트 루프·GC·`await`와의 대응

## 17.1 프로그램이 사는 자리

웹 애플리케이션은 OS가 준 가상 메모리 위에서 산다. 변수를 만들면 힙에 객체가 생기고, GC가 더 이상 참조되지 않는 객체를 회수한다. 스택은 함수 호출마다 자동으로 늘고 줄어들며, 스택이 넘치면 보통 예외나 프로세스 종료로 끝난다.

MCU에는 그런 안전망이 없다. 메모리 영역은 링커 스크립트가 정하고, 스택과 힙은 같은 SRAM을 **위아래에서 서로 밀어 가며** 쓴다. 한쪽이 넘치면 다른 쪽 데이터를 조용히 덮어쓴다. 예외가 아니라 손상이다.

| 영역 | 무엇이 들어가나 | 전원이 끊기면 | 특징 |
|---|---|---|---|
| Flash | 프로그램 코드, `const` 상수, 문자열 리터럴 | 유지 | 쓰기 횟수 제한, 바이트 단위 쓰기 어려움 |
| SRAM `.data` | 초깃값이 있는 전역·정적 변수 | 사라짐 | 시작 시 Flash에서 복사됨 |
| SRAM `.bss` | 0으로 초기화되는 전역·정적 변수 | 사라짐 | Flash에 공간을 차지하지 않음 |
| SRAM heap | `malloc`/`new`로 할당한 블록 | 사라짐 | 조각화·실패·느린 할당 |
| SRAM stack | 지역 변수, 함수 호출 정보, ISR 문맥 | 사라짐 | 넘치면 조용한 손상 |
| NVS/EEPROM | 설정, 보정값, 부팅 카운터 | 유지 | 쓰기 수명·속도 제한 |

전형적인 단일 주소 공간 MCU(Cortex-M 등)의 배치를 단순화하면 다음과 같다. 실제 순서와 경계는 링커 스크립트가 정한다.

```text
낮은 주소
┌────────────────────────────────────┐
│ Flash: .text(코드), .rodata(상수)   │  전원이 끊겨도 유지
├────────────────────────────────────┤
│ SRAM: .data(초깃값 있는 전역)       │
│       .bss(0으로 초기화되는 전역)    │
├────────────────────────────────────┤
│       heap → (위로 자람)            │
│                  ...               │
│       ← stack (아래로 자람)          │
└────────────────────────────────────┘
높은 주소
```

힙과 스택이 같은 SRAM을 마주 보며 자란다. 그래서 힙을 많이 쓰면 스택 여유가 줄고, 큰 지역 배열 하나가 힙 데이터를 덮어쓸 수 있다. 스택 오버플로가 예외가 아니라 **조용한 손상**이 되는 이유다.

PC에서도 같은 구조를 볼 수 있다. 다음 C 프로그램을 `gcc -O0`으로 빌드해 실행하면 각 영역의 주소가 대략 어떻게 나뉘는지 확인할 수 있다. 주소 값 자체는 OS·ASLR·빌드마다 달라지므로 **순서와 간격만** 보면 된다.

```c
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

int g_initialized = 42;      /* .data */
int g_zero;                  /* .bss */
const char g_text[] = "ro";  /* .rodata */
static int s_static;          /* .bss */

int main(void) {
    int local = 7;            /* stack */
    int *heap = malloc(sizeof *heap);
    if (!heap) return 1;
    *heap = 9;

    printf("text/rodata (&g_text) : %p\n", (void *)g_text);
    printf("data       (&g_init)  : %p\n", (void *)&g_initialized);
    printf("bss        (&g_zero)  : %p\n", (void *)&g_zero);
    printf("bss static (&s_static): %p\n", (void *)&s_static);
    printf("heap       (heap)     : %p\n", (void *)heap);
    printf("stack      (&local)   : %p\n", (void *)&local);
    free(heap);
    return 0;
}
```

필자의 Linux 환경에서 실행한 결과는 다음과 같았다. 주소는 매 실행마다 달라질 수 있다.

```text
text/rodata (&g_text) : 0x60da5916d004
data       (&g_init)  : 0x60da5916f010
bss        (&g_zero)  : 0x60da5916f018
bss static (&s_static): 0x60da5916f01c
heap       (heap)     : 0x60da9912b2a0
stack      (&local)   : 0x7fff6daee64c
```

- 코드·상수는 낮은 주소, 전역·정적 변수는 그다음, 힙은 더 높은 주소, 스택은 매우 높은 주소에 있다. MCU에서는 이 배치를 링커 스크립트가 정한다.
- `const`라고 해서 항상 Flash에 가는 것은 아니다. 컴파일러·링커·최적화 수준에 따라 SRAM에 복사될 수 있다. AVR에서는 큰 상수 테이블에 `PROGMEM`과 `pgm_read_*`가 필요하다.
- 전역·정적 변수는 프로그램이 끝날 때까지 자리를 차지한다. "편해서 전역"으로 두면 RAM 예산이 금방 사라진다.
- 지역 변수는 스택에 있다. 큰 배열을 지역 변수로 두면 스택 오버플로 위험이 커진다.

### 지도(map)와 크기 확인

"컴파일된다"와 "보드에 들어간다"는 다르다. 링커가 만든 map 파일과 `size` 명령으로 실제 사용량을 본다.

```bash
gcc -Os -Wl,-Map=firmware.map -o firmware firmware.c
size firmware
```

map 파일에서는 `.text`, `.data`, `.bss`, `_heap_start`, `_stack_top` 같은 기호를 찾는다. ESP-IDF에서는 빌드 디렉터리의 `.map` 파일과 `idf.py size`를 쓴다. 스택 사용량은 정적으로 알기 어렵기 때문에 RTOS의 스택 하이워터마크(18장)나 스택 페인팅으로 측정한다.

## 17.2 동적 할당을 피하는 이유

웹에서는 `new`, `[]`, 객체 리터럴을 자유롭게 쓴다. GC가 회수하므로 "만들고 잊는" 코드가 자연스럽다. MCU에서는 그 습관이 다음 문제를 만든다.

1. **실패를 처리해야 한다.** `malloc`은 NULL을 돌려줄 수 있다. 웹의 `new`가 예외를 던지는 것과 비슷해 보이지만, MCU에는 그 예외를 받아 줄 런타임이 없고, NULL 검사를 빠뜨리면 바로 손상으로 이어진다.
2. **조각화된다.** 크기가 다른 블록을 반복해서 할당·해제하면, 총 여유 공간은 충분해도 연속된 큰 블록이 없어질 수 있다. 8바이트·64바이트 블록을 번갈아 쓰다 보면 100바이트가 남아 있어도 64바이트 할당이 실패한다.
3. **시간이 예측되지 않는다.** 할당자는 free list를 뒤지고, 필요하면 병합·분할한다. 최악 실행 시간이 입력과 단편화 상태에 좌우된다. 실시간 제어 루프에 넣기 어렵다.
4. **ISR에서 쓸 수 없다.** 인터럽트 문맥에서 할당자를 건드리면 메인 루프와의 경쟁, 재진입, 긴 실행 시간 문제가 생긴다. 13장에서 `malloc`을 ISR 금지 목록에 넣은 이유다.

대안은 **처음에 크기를 정하고, 그 안에서만 움직이는 것**이다. 가장 단순한 형태가 고정 크기 블록 풀이다. 블록을 미리 배열로 잡고, free list로 연결한다. 할당은 free list의 머리를 떼는 일이라 O(1)이고, 해제는 머리에 붙이는 일이라 역시 O(1)이다. 조각화는 생기지 않는다. 대신 블록 크기가 고정이라, 큰 객체가 필요하면 다른 풀을 두거나 설계를 바꿔야 한다.

```c
#define BLOCK_SIZE 32u
#define BLOCK_COUNT 8u

typedef union block {
    union block *next;
    uint8_t bytes[BLOCK_SIZE];
} block;

typedef struct {
    block blocks[BLOCK_COUNT];
    block *free_list;
    size_t used;
    size_t peak;
} pool;

static void pool_init(pool *p) {
    p->free_list = NULL;
    p->used = 0;
    p->peak = 0;
    for (size_t i = BLOCK_COUNT; i > 0; i--) {
        p->blocks[i - 1u].next = p->free_list;
        p->free_list = &p->blocks[i - 1u];
    }
}

static void *pool_alloc(pool *p) {
    if (!p->free_list) return NULL;
    block *b = p->free_list;
    p->free_list = b->next;
    p->used++;
    if (p->used > p->peak) p->peak = p->used;
    return b->bytes;
}

static int pool_free(pool *p, void *ptr) {
    uintptr_t first = (uintptr_t)&p->blocks[0];
    uintptr_t last = (uintptr_t)&p->blocks[BLOCK_COUNT - 1u];
    uintptr_t at = (uintptr_t)ptr;
    if (at < first || at > last || (at - first) % sizeof(block) != 0u) {
        return -1; /* 이 풀의 블록이 아니다 */
    }
    block *blk = (block *)ptr;
    blk->next = p->free_list;
    p->free_list = blk;
    p->used--;
    return 0;
}
```

- `union`으로 free list 포인터와 데이터 공간을 겹쳐 쓴다. 사용 중일 때는 `bytes`가, 비어 있을 때는 `next`가 유효하다.
- `blocks` 배열은 정적·전역으로 잡는다. 함수 안에 두면 스택을 크게 차지한다.
- `pool_free()`는 포인터가 이 풀의 범위 안에 있는지 확인해야 한다. 범위 밖 포인터를 넣으면 free list가 깨진다.
- `peak`는 최대 동시 사용량이다. 이 값으로 풀 크기를 조정한다.
- 블록 크기는 `_Alignof(max_align_t)`의 배수로 잡는 것이 안전하다. 32바이트는 대부분의 MCU에서 충분하지만, `double`·64비트 정수를 넣는다면 확인한다.

이 코드를 PC에서 8블록으로 시험하면, 8개를 할당한 뒤 9번째가 NULL을 돌려주고, 두 개를 해제한 뒤 재사용되며, 최대 사용량이 8로 기록된다. 필자의 실행 결과는 `pool: 8 blocks x 32 bytes, peak 8, no malloc`이었다.

### 그래도 동적 할당이 필요할 때

- **부팅 시에만** 할당하고 이후 해제하지 않는다. 조각화가 생기지 않는다.
- 크기별로 풀을 나눈다. 16/32/64/128바이트 풀처럼 고정한다.
- 할당 실패를 정상 경로로 처리한다. "메모리가 없으면 기능을 끄고 계속 동작" 같은 정책을 정한다.
- 할당·해제를 한 태스크로 몰아넣어 경쟁을 없앤다(18장).
- 힙 사용량·최대치·실패 횟수를 카운터로 남긴다. 웹의 메모리 프로파일러에 해당한다.

ESP32처럼 RAM이 수백 KB인 칩에서도 Wi-Fi·TLS·JSON·버퍼가 겹치면 빠듯해진다. "동적 할당을 절대 쓰지 않는다"가 아니라, **핵심 경로(ISR, 제어 루프, 통신 파서)에서는 쓰지 않고, 경계가 분명한 곳에서만 쓴다**가 현실적인 규칙이다.

## 17.3 `volatile`은 무엇을 보장하지 않는가

`volatile`은 임베디드 C에서 가장 많이 오해되는 키워드다. 결론부터 말하면:

- **보장하는 것**: 컴파일러가 그 변수의 읽기·쓰기를 최적화로 없애거나, 다른 관찰 가능한 부작용과 함부로 재배열하지 못하게 한다.
- **보장하지 않는 것**: 원자성, 스레드/인터럽트 사이의 동기화, 메모리 순서.

C 표준 해설(cppreference)은 이렇게 못 박는다.

> "volatile variables are not suitable for communication between threads; they do not offer atomicity, synchronization, or memory ordering."

ISR과 메인 루프는 엄밀히 말해 별도 스레드가 아니지만, 컴파일러 입장에서는 **프로그램 흐름 밖에서 값이 바뀔 수 있는 대상**이다. 그래서 "ISR이 갱신하는 플래그"에는 `volatile`이 필요하다. 하지만 `volatile`이 붙었다고 해서 32비트 변수의 읽기-수정-쓰기가 한 번에 일어나는 것은 아니다.

```c
volatile bool g_stop;   /* ISR이 true로 바꾼다 */

void main_loop(void) {
    while (!g_stop) {
        /* ... */
    }
}
```

- `g_stop`이 `volatile`이 아니면 컴파일러는 "이 루프 안에서 값이 바뀌지 않는다"고 판단해 `while (1)`로 최적화할 수 있다.
- `volatile`이면 매번 메모리에서 읽는다. 그래서 루프를 빠져나올 수 있다.
- 하지만 `g_stop`을 읽는 순간과 다음 문장 사이에 ISR이 끼어들 수 있다. 여러 변수를 함께 갱신한다면 "일관된 스냅샷"은 보장되지 않는다.

### 원자성과 메모리 순서

C11부터는 `_Atomic`과 `<stdatomic.h>`가 있다. 다음은 32비트 카운터를 여러 문맥에서 안전하게 증가시키는 예다.

```c
#include <stdatomic.h>

_Atomic uint32_t g_frames;

void count_frame(void) {
    atomic_fetch_add_explicit(&g_frames, 1u, memory_order_relaxed);
}
```

- `atomic_fetch_add`는 읽기-수정-쓰기를 원자적으로 한다. `g_frames++`는 아니다.
- `memory_order_relaxed`는 원자성만 보장하고 다른 메모리 접근의 순서는 보장하지 않는다. 통계 카운터에는 충분하다.
- 데이터를 **발행**할 때는 `release`, 소비할 때는 `acquire`를 쓴다. 17.5절의 링 버퍼가 그 예다.
- 8비트 AVR에서 16비트 변수를 읽는 동안 ISR이 쓰면 반쪽 값이 나올 수 있다. 32비트 Cortex-M의 정렬된 32비트 접근은 원자적이지만, 그것도 컴파일러·정렬 조건에 달려 있다. 확신이 없으면 `_Atomic`이나 인터럽트 차단을 쓴다.

`volatile`과 `_Atomic`은 대체 관계가 아니다. 하드웨어 레지스터처럼 "값이 언제든 바뀌고, 읽는 것 자체가 부작용"인 대상에는 `volatile`이 맞다. 여러 문맥이 공유하는 데이터에는 `_Atomic`, 뮤텍스, 큐, 인터럽트 차단이 맞다. ESP32 듀얼코어에서는 `volatile`만으로 부족하다.

## 17.4 ISR에서 해도 되는 일과 안 되는 일

13장의 원칙을 시간·메모리 관점에서 다시 정리한다. ISR은 **지금 실행 중인 코드를 즉시 중단**한다. ISR이 길어지면 메인 루프의 주기가 밀리고, 다른 인터럽트를 놓치고, 워치독이 걸린다.

| ISR에서 | 이유 |
|---|---|
| 플래그 설정, 카운터 증가 | 가장 짧다. `volatile`/`_Atomic` 필요 |
| 하드웨어 레지스터 읽기/쓰기 | 본래 목적 |
| 링 버퍼·RTOS 큐에 넣기 | 짧고, 처리는 다른 문맥으로 미룬다 |
| `delay()`, 긴 루프 | 다른 인터럽트·메인 루프를 막는다 |
| `printf`, 파일 I/O, 네트워크 | 내부 버퍼·블로킹·재진입 문제 |
| `malloc`/`free` | 조각화, 실행 시간 예측 불가, 재진입 |
| 뮤텍스 대기 | ISR에는 "기다릴 태스크"가 없다. 데드락 |
| RTOS API의 일반형 | ISR에서는 `...FromISR` 변형만 |

ESP-IDF TWAI 드라이버는 수신 프레임을 **드라이버 내부 RX 큐**에 넣고, `twai_receive()`가 그 큐에서 꺼낸다. 응용 코드는 ISR을 직접 쓰지 않고, 태스크에서 `twai_receive()`를 호출한다. 이 구조가 "ISR은 넣기만, 처리는 태스크"의 실제 예다. TWAI 드라이버의 ISR은 IRAM 설정(`CONFIG_TWAI_ISR_IN_IRAM`)에 따라 캐시가 꺼진 상태에서도 동작해야 하므로, ISR 안에서 복잡한 일을 하지 않는다.

FreeRTOS를 쓸 때 ISR에서 큐에 넣는 코드는 다음과 같다.

```c
static QueueHandle_t g_rx_queue;

void IRAM_ATTR can_isr(void) {
    uint32_t id = read_can_id();
    BaseType_t higher_priority_task_woken = pdFALSE;

    xQueueSendFromISR(g_rx_queue, &id, &higher_priority_task_woken);
    portYIELD_FROM_ISR(higher_priority_task_woken);
}
```

- `xQueueSendFromISR`는 태스크를 깨울 수 있다. `higher_priority_task_woken`이 `pdTRUE`면 ISR을 나가기 전에 문맥 전환을 요청한다.
- ISR에서는 `xQueueSend`(일반형)를 쓰지 않는다.
- 큐가 가득 차면 `errQUEUE_FULL`이 된다. ISR에서는 기다릴 수 없으므로 **버리거나 오버플로 카운터를 올린다.** 정책을 정해야 한다.

실제 ESP32 TWAI에서는 드라이버가 이 일을 대신 해 주므로, 응용 ISR을 직접 작성할 일은 줄어든다. 대신 `twai_receive()`의 타임아웃, RX 큐 길이, 경보(alert) 처리(18장)를 설계해야 한다.

## 17.5 락 없는 SPSC 링 버퍼

ISR과 메인 루프 사이에서 바이트를 넘기는 가장 흔한 구조는 **단일 생산자·단일 소비자(SPSC) 링 버퍼**다. 생산자가 하나, 소비자가 하나면 인덱스 두 개만으로 락 없이 동작한다.

```text
data:  [ d0 ][ d1 ][ d2 ][    ][    ][    ][    ]
         ↑tail              ↑head
```

- `head`는 생산자가 쓰는 위치, `tail`은 소비자가 읽는 위치다.
- 생산자만 `head`를 쓰고, 소비자만 `tail`을 쓴다. 서로의 인덱스는 읽기만 한다.
- `head - tail`이 용량과 같으면 가득 참, `head == tail`이면 비었음이다. 인덱스를 단조 증가시키고 `& (CAP - 1)`로 슬롯을 감싸면, 한 칸을 비워 둘 필요가 없다.
- `CAP`은 2의 거듭제곱으로 두어 모듈로 연산을 마스크로 바꾼다.

다음은 C11 원자 연산으로 구현한 SPSC 링 버퍼다. 생산자 스레드와 소비자 스레드를 만들어 100만 개를 순서대로 주고받는 시험까지 포함한다.

```c
#include <stdatomic.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define CAP 1024u

struct spsc_ring {
    _Atomic size_t head; /* 생산자만 쓴다 */
    _Atomic size_t tail; /* 소비자만 쓴다 */
    uint32_t data[CAP];
};

static struct spsc_ring q;

static bool push(uint32_t v) {
    size_t h = atomic_load_explicit(&q.head, memory_order_relaxed);
    size_t t = atomic_load_explicit(&q.tail, memory_order_acquire);
    if (h - t == CAP) return false;          /* 가득 참 */
    q.data[h & (CAP - 1u)] = v;
    atomic_store_explicit(&q.head, h + 1u, memory_order_release);
    return true;
}

static bool pop(uint32_t *v) {
    size_t t = atomic_load_explicit(&q.tail, memory_order_relaxed);
    size_t h = atomic_load_explicit(&q.head, memory_order_acquire);
    if (h == t) return false;                /* 비었음 */
    *v = q.data[t & (CAP - 1u)];
    atomic_store_explicit(&q.tail, t + 1u, memory_order_release);
    return true;
}
```

메모리 순서가 핵심이다.

- 생산자는 데이터를 쓴 뒤 `head`를 `release`로 저장한다. 이 저장은 "데이터 쓰기가 head 갱신보다 먼저 완료됐다"를 소비자에게 알린다.
- 소비자는 `head`를 `acquire`로 읽는다. 이 읽기가 생산자의 `release` 저장과 동기화되면, 소비자는 생산자가 쓴 데이터를 확실히 본다.
- 소비자는 데이터를 읽은 뒤 `tail`을 `release`로 저장한다. 생산자는 `tail`을 `acquire`로 읽어 "이 슬롯을 다시 써도 된다"를 확인한다.
- 각 인덱스는 한쪽만 쓰므로, 자기 인덱스를 읽는 것은 `relaxed`로 충분하다.

`volatile`만으로는 이 보장이 없다. cppreference도 "volatile accesses are not atomic (concurrent read and write is a data race) and do not order memory"라고 설명한다. 단일 코어 MCU에서 ISR과 메인 루프만 있다면 컴파일러 배리어와 인터럽트 차단으로 비슷한 효과를 낼 수 있지만, C11 원자 연산이 의도를 더 분명하게 표현하고 듀얼코어에서도 동작한다.

PC에서 시험한 결과는 다음과 같다.

```text
ringbuf: 1000000 items, order ok, capacity 1024
```

- 용량 1024에서 실제 저장 가능한 항목은 **1024**다. `head - tail == CAP`을 가득 참으로 정의하고 한 칸을 비우지 않기 때문이다. 13.4절의 8비트 인덱스 예제처럼 한 칸을 비워 두는 방식과 다르다.
- `size_t`가 32비트라면 `head`가 2^32에서 0으로 돌아간다. 부호 없는 정수의 뺄셈은 모듈로 연산이므로 `h - t`는 여전히 올바른 개수를 준다. 다만 `head`와 `tail`의 차이가 2^31을 넘으면 해석이 깨질 수 있으므로, 버퍼 용량은 그보다 훨씬 작게 잡는다.
- 16비트 인덱스를 쓰는 MCU에서는 `CAP`을 2의 거듭제곱으로 두고 `uint16_t` 뺄셈을 쓴다. 8비트 인덱스는 256바이트 전용이다(13.4절).

### 오버플로 정책

링 버퍼는 언젠가 넘친다. 생산 속도가 소비 속도보다 빠르면 반드시 그렇다. 정책을 코드로 명시한다.

| 정책 | 동작 | 적합한 경우 |
|---|---|---|
| 새 데이터 버리기 | `push`가 실패하고 오버플로 카운터 증가 | 최신 값이 중요하지 않은 로그 |
| 오래된 데이터 덮어쓰기 | `tail`을 밀어 가장 오래된 항목 폐기 | 최신 값이 중요한 센서 표본 |
| 생산자 블로킹 | 소비자가 비울 때까지 대기 | 태스크 문맥, 실시간 마감이 없을 때 |
| 연결 리셋 | 오버플로 시 세션을 끊고 다시 시작 | 줄 중간이 잘리면 파싱이 깨지는 OBD 응답 |

OBD-II 응답은 줄 중간이 잘리면 `41 0C`의 바이트 해석이 어긋난다. 그래서 **오버플로가 나면 그 응답은 버리고, 오버플로 카운터를 올리고, 다음 요청부터 다시 시작**하는 편이 안전하다. "가장 최근 바이트만 남기기"는 하지 않는다.

버퍼 크기는 평균이 아니라 **최악의 생산 속도 × 최악의 소비 지연**으로 계산한다. ELM327이 38400 baud면 초당 약 3,840바이트다. 256바이트 버퍼는 60ms마다 비워야 한다. 메인 루프가 화면 갱신·Wi-Fi 처리로 60ms 이상 멈추면 넘친다. 1024바이트라면 약 266ms의 여유가 생긴다. 물론 ELM327 내부 버퍼(512바이트)도 별도로 넘칠 수 있다.

## 17.6 시간: `millis()`와 `await`의 차이

웹의 `setTimeout`, `setInterval`, `await`는 이벤트 루프가 시간을 관리해 준다. MCU에서는 타이머 인터럽트, RTOS 틱, 또는 `millis()` 같은 카운터를 직접 읽는다. 중요한 차이는 **평균이 아니라 최악 지연**을 봐야 한다는 점이다.

### 오버플로를 견디는 비교

32비트 `millis()`는 약 49.7일마다 0으로 돌아간다. `now >= last + period`로 비교하면 오버플로 순간에 한 번 오동작할 수 있다. 뺄셈으로 비교한다.

```c
static uint32_t last_toggle;

uint32_t now = millis();
if (now - last_toggle >= 500u) {
    last_toggle = now;
    toggle_led();
}
```

부호 없는 뺄셈은 모듈로 2^32로 계산되므로, `now`가 `last_toggle`보다 작아도 올바른 경과 시간이 나온다. 이 패턴은 FreeRTOS의 `xTaskGetTickCount()`에도 그대로 적용된다.

### 주기 태스크

`vTaskDelay(100)`은 "지금부터 100틱 후"다. 처리 시간이 매번 달라지면 주기가 밀린다. 고정 주기에는 `xTaskDelayUntil()`을 쓴다.

```c
TickType_t last_wake = xTaskGetTickCount();
for (;;) {
    do_work();
    xTaskDelayUntil(&last_wake, pdMS_TO_TICKS(100));
}
```

- `vTaskDelay`는 상대 지연, `xTaskDelayUntil`은 절대 시각 기준이다. ESP-IDF 문서는 `xTaskDelayUntil`을 "고정 주기 실행"에 쓴다고 설명한다.
- 주기가 처리 시간보다 짧으면 태스크는 쉬지 못하고 계속 밀린다. 그때는 주기를 늘리거나 작업을 나눈다.
- `delay()`/`vTaskDelay()`는 그동안 다른 일을 못 하는 **블로킹**이다. RTOS에서는 그 시간에 다른 태스크가 돌 수 있지만, 같은 태스크의 다른 작업은 멈춘다.

### 최악 지연(WCET)과 지터

웹에서 "평균 응답 20ms"면 충분할 수 있다. 임베디드에서는 "최악 200ms"가 문제를 만든다. 다음을 측정한다.

- ISR 지연: 인터럽트가 발생한 시각부터 ISR 첫 명령까지
- 태스크 지연: 이벤트 발생부터 태스크가 깨어날 때까지
- 처리 시간: 파싱·로깅·전송에 걸리는 최대 시간
- 블로킹: 플래시 쓰기, Wi-Fi 연결, `malloc`, 파일 I/O

측정 도구는 GPIO 토글 + 로직 분석기, `esp_timer_get_time()`, RTOS의 실행 시간 통계(`vTaskGetRunTimeStats`) 등이다. GPIO 토글은 "코드 어디서 시간이 걸리는지"를 오실로스코프/로직 분석기로 바로 보여 준다.

### 샘플링 주기와 필터의 시간 예산

주기 태스크에서 센서를 읽고 필터를 적용하면, 제어 주기 안에 **읽기 + 필터 + 전송**이 모두 들어가야 한다. 필터의 표본당 연산이 작아도, 창 크기·나눗셈·정렬이 늘어나면 WCET가 변한다. 30장의 고정소수점 EMA는 메모리 O(1)이고 표본당 곱셈 1·나눗셈 1이라 이런 예산에 넣기 쉽다. 반대로 이동 평균은 합계 오버플로와 창 크기만큼의 메모리를, 중앙값은 정렬 비용을 확인해야 한다.

또한 주기 태스크의 **지터**는 샘플링 간격을 흔든다. `vTaskDelayUntil()`로 주기를 맞춰도 ISR·우선순위·플래시 쓰기 때문에 표본 간격이 달라진다. 타임스탬프를 찍고 실제 `dt`로 필터 계수를 계산하거나, 고정 `dt`를 쓸 때는 지터 한계를 문서화한다. 샘플링·타임스탬프·정렬은 29장에서 더 자세히 다룬다.

### 상태 기계와 `await`

13.5절의 OBD 상태 기계는 웹의 `async/await`와 같은 역할을 한다. 다른 점은 **런타임이 없다**는 것이다. `await`는 컴파일러가 상태 기계로 바꾸고 이벤트 루프가 재개해 주지만, C에서는 상태와 전이를 직접 쓴다.

```text
IDLE ──주기 도달──→ SEND ──→ WAIT_LINE ──줄 완성──→ PARSE ──→ IDLE
                                   │
                                   └──타임아웃──→ ERROR ──→ IDLE
```

- `WAIT_LINE`에서 `delay()`로 기다리지 않는다. 매 루프에서 `line_ready()`와 `now - last_rx`를 확인한다.
- 한 번에 한 요청만 보낸다. 여러 PID를 동시에 보내려면 요청 큐와 응답 매칭이 필요하다(18장).
- 타임아웃은 "최악의 정상 응답"보다 길게 잡는다. ELM327 클론의 `NO DATA`가 0.2초 안팎이면 0.5초는 여유가 있다. 차량·PID에 따라 조정한다.

## 17.7 워치독: 살아 있는지, 건강한지

워치독은 "정해진 시간 안에 리셋되지 않으면 MCU를 재시작"하는 장치다. 목적은 **행(hang)에서 복구**하는 것이다. 코드가 무한 루프에 빠지거나, 블로킹 호출에서 돌아오지 않거나, 스택이 깨져 흐름을 잃었을 때 기계를 다시 살린다.

가장 흔한 실수는 **ISR에서 워치독을 리셋**하는 것이다. ISR은 타이머로 계속 돌 수 있으므로, 메인 루프가 죽어도 워치독은 "살아 있다"고 착각한다. 워치독은 **모든 핵심 작업이 정상적으로 완료됐을 때** 리셋해야 한다.

ESP-IDF에는 Task Watchdog Timer(TWDT)가 있다. `esp_task_wdt_init(&config)`로 시간·동작을 정하고, `esp_task_wdt_add(NULL)`로 현재 태스크를 감시 대상에 추가한 뒤, 일이 끝난 지점에서 `esp_task_wdt_reset()`을 호출한다. 부팅 시 이미 초기화된 경우 `esp_task_wdt_reconfigure()`를 쓰고, `esp_task_wdt_reset()`을 ISR에서 호출하지 않는다. 설정·코드·긴 작업 처리까지는 21.2절에서 자세히 다룬다.

- `trigger_panic = true`면 타임아웃 시 패닉과 리셋이 일어난다. 기본 동작은 경고와 백트레이스만 남기는 것이다(설정에 따라 다름).
- 타임아웃은 "가장 긴 정상 작업"보다 길게 잡는다. 플래시 지우기·OTA처럼 긴 작업은 21.2절처럼 별도로 다룬다.
- TWDT와 별도로 **Interrupt Watchdog(IWDT)**가 있다. 인터럽트가 너무 오래 비활성화되거나 높은 우선순위 ISR이 오래 걸릴 때 리셋한다. ISR을 짧게 유지해야 하는 또 하나의 이유다.

워치독은 "코드를 고쳐 주는" 장치가 아니다. 리셋이 반복되면 리셋 원인을 로그에 남기고(17.8절), 스택 오버플로·블로킹·우선순위 starvation을 찾아야 한다. TWDT/IWDT의 차이, 부팅 카운터·안전 모드, core dump까지는 21장에서 더 깊게 다룬다.

## 17.8 리셋 원인과 관측

웹의 APM처럼 펌웨어에도 "왜 재시작했는가"를 남겨야 한다. ESP32는 `esp_reset_reason()`으로 리셋 원인을 얻을 수 있다. 부팅 로그에 다음을 남긴다.

- 리셋 원인(`ESP_RST_POWERON`, `ESP_RST_TASK_WDT`, `ESP_RST_INT_WDT`, `ESP_RST_PANIC`, `ESP_RST_BROWNOUT` 등)
- 부팅 횟수, 마지막 정상 동작 시각
- 펌웨어 버전, 빌드 시각, 커밋 해시
- 마지막 오류 코드, TEC/REC, 큐 오버플로 카운터

RTC 메모리(`RTC_DATA_ATTR`)나 NVS에 부팅 카운터를 남기면 "재부팅이 반복되는지"를 알 수 있다. 리셋 원인을 모르면 "가끔 멈춘다"는 보고만 남는다. 리셋 루프를 막는 안전 모드 설계는 21장에서 이어진다.

## 17.9 웹 개념과의 대응

| 웹 | 펌웨어 | 같은 점 | 다른 점 |
|---|---|---|---|
| 이벤트 루프 | 메인 루프, RTOS 스케줄러 | 준비된 일을 고른다 | 펌웨어는 우선순위·인터럽트·틱을 직접 설계 |
| 가비지 컬렉션 | 정적 버퍼, 풀, 소유권(Rust) | 메모리 수명을 관리 | GC가 없어 해제 시점을 코드가 책임 |
| Promise/Future | 상태 기계, 이벤트 플래그 | "나중에 결과"를 표현 | 런타임이 없어 재개 조건을 직접 씀 |
| `await` | `vTaskDelay`, 큐 대기 | 기다리는 동안 다른 일을 한다 | 같은 태스크는 멈추고, 블로킹 API는 피해야 |
| `setInterval` | `xTaskDelayUntil`, 타이머 | 주기 실행 | 평균이 아니라 최악 지연을 본다 |
| `try/catch` | 오류 코드, `Result`, 안전 상태 | 오류를 처리 | 예외·스택 트레이스가 없다 |
| 메모리 프로파일러 | map 파일, `idf.py size`, 스택 하이워터마크 | 사용량을 본다 | 런타임 할당 추적이 제한적 |
| `console.log` | UART 로그, RTT, 리셋 원인 | 관측 | 로그를 볼 수 없는 현장이 있다 |
| 마이크로태스크 | ISR | "끼어든다" | ISR은 우선순위·마스킹·문맥 비용이 있다 |

## 흔한 실수

| 실수 | 결과 | 확인 |
|---|---|---|
| 큰 배열을 지역 변수로 | 스택 오버플로, 조용한 손상 | 전역/정적, 스택 측정 |
| `malloc`을 ISR에서 | 힙 손상, 재진입, 긴 지연 | ISR은 큐·링 버퍼만 |
| `malloc` 실패 미처리 | NULL 역참조, 크래시 | 모든 할당에 실패 경로 |
| 크기 다른 블록 반복 할당 | 조각화, 간헐 할당 실패 | 고정 풀, 부팅 시 할당 |
| `volatile`을 원자성으로 착각 | 반쪽 값, 간헐 오류 | `_Atomic`, 인터럽트 차단 |
| `volatile` 다중 변수 스냅샷 | 일관성 깨짐 | 시퀀스 카운터, 락, 큐 |
| 링 버퍼 크기를 평균 속도로 계산 | 오버플로, 줄 잘림 | 최악 속도 × 최악 지연 |
| 오버플로 정책 미정 | 조용한 데이터 유실 | 드롭/덮어쓰기/리셋 명시 |
| `now >= last + period` | 49.7일마다 오동작 | `now - last >= period` |
| `delay()`로 응답 대기 | 다른 입력·통신 정지 | 상태 기계·타임아웃 |
| ISR에서 워치독 리셋 | 메인 루프가 죽어도 살아 있는 것으로 보임 | 정상 완료 지점에서 리셋 |
| 워치독만 믿고 원인 미기록 | 재부팅 반복, 디버깅 불가 | 리셋 원인·카운터 로그 |
| 스택 크기를 감으로 결정 | 간헐 손상 | 하이워터마크 측정 |

## 장 요약

- MCU의 메모리는 Flash, `.data`, `.bss`, 힙, 스택, NVS로 나뉜다. 링커 스크립트와 map 파일로 실제 배치를 확인한다.
- 동적 할당은 실패·조각화·시간 예측 불가를 부른다. 핵심 경로에서는 고정 풀과 정적 버퍼를 쓴다.
- `volatile`은 최적화를 막을 뿐, 원자성·동기화·메모리 순서를 보장하지 않는다.
- ISR은 짧게. 큐·링 버퍼에 넣고, 처리는 태스크/메인 루프로 미룬다.
- SPSC 링 버퍼는 release/acquire 두 쌍으로 락 없이 동작한다. 오버플로 정책을 명시한다.
- 시간은 뺄셈으로 비교하고, 고정 주기는 `xTaskDelayUntil`을 쓴다. 최악 지연을 측정한다.
- 워치독은 정상 완료 지점에서 리셋한다. ISR에서 리셋하면 의미가 없다.
- 리셋 원인과 오류 카운터를 남겨야 "가끔 멈춘다"를 "왜 멈추는가"로 바꿀 수 있다.
- 웹의 이벤트 루프·GC·`await`는 펌웨어의 메인 루프·정적 메모리·상태 기계에 대응하지만, 런타임이 해 주던 일을 직접 책임져야 한다.

다음 장에서는 이 구조를 FreeRTOS 태스크로 나눈다. TWAI 수신, OBD 요청·파싱, 경보·Bus-Off 복구를 각각 태스크로 두고, 큐와 우선순위로 연결한다. HTTP 서버는 ESP-IDF `httpd`가 자체 태스크로 처리한다.

## 연습 문제

### 1. (기초) 메모리 영역

다음 변수가 어느 영역에 들어가는지 쓰라.

```c
const uint8_t table[16] = {1, 2, 3};
int g_count;
static int s_flag;
void f(void) { int local[64]; int *p = malloc(128); }
```

1. `table`, `g_count`, `s_flag`, `local`, `malloc` 블록은 각각 어디에 가는가?
2. `local`을 64개 정수 배열로 두면 32비트 MCU에서 스택을 얼마나 쓰는가?
3. `malloc` 실패를 확인하지 않으면 어떤 일이 생기는가?

### 2. (중급) `volatile`과 원자성

1. ISR이 갱신하는 `volatile bool flag`를 메인 루프가 읽는 이유를 설명하라.
2. `volatile uint32_t counter`에 `counter++`를 두 문맥에서 하면 왜 안전하지 않은가?
3. C11에서 이 문제를 해결하는 방법 두 가지를 쓰라.

### 3. (중급) 링 버퍼

`CAP=512`, `uint16_t` 인덱스를 쓰는 SPSC 링 버퍼가 있다.

1. `head - tail == CAP`일 때와 `head == tail`일 때 각각 무엇인가?
2. 저장 가능한 최대 항목 수는 몇 개인가?
3. 생산자가 초당 4,000바이트, 소비자가 최악 200ms 동안 멈춘다면 필요한 최소 버퍼는 몇 바이트인가?

### 4. (중급) ISR 규칙

다음 중 ISR에서 해도 되는 일과 안 되는 일을 구분하고 이유를 쓰라.

```text
A. 전역 volatile 플래그를 true로 설정
B. xQueueSendFromISR로 4바이트 ID 전달
C. printf로 프레임 내용 출력
D. malloc으로 버퍼 할당
E. xQueueSend(일반형)로 큐에 전달
```

### 5. (중급) 워치독

1. 워치독을 ISR에서 리셋하면 왜 위험한가?
2. ESP-IDF TWDT에서 `esp_task_wdt_add(NULL)`은 무엇을 하는가?
3. 태스크가 5초 넘게 블로킹하는 정상 작업이 있다면 워치독 설정을 어떻게 해야 하는가?

## 정답과 해설

### 1.

1. `table`은 보통 Flash/`.rodata`(또는 `const` 최적화에 따라 SRAM), `g_count`와 `s_flag`는 `.bss`(초깃값이 없으므로), `local`은 스택, `malloc` 블록은 힙.
2. 64 × 4 = 256바이트. 함수 호출·ISR 문맥까지 겹치면 스택이 더 필요하다.
3. NULL 역참조로 크래시하거나, 운 좋게 0번지가 유효한 MCU에서 조용히 잘못된 메모리를 덮어쓴다. 모든 할당에 실패 경로를 둔다.

### 2.

1. 컴파일러가 "루프 안에서 값이 바뀌지 않는다"고 판단해 읽기를 생략하거나 `while(1)`로 최적화하는 것을 막기 위해서다.
2. `counter++`는 읽기-수정-쓰기 세 단계다. 두 문맥이 겹치면 증가 하나를 잃거나 반쪽 값을 쓴다. `volatile`은 이 원자성을 보장하지 않는다.
3. `_Atomic uint32_t`와 `atomic_fetch_add`, 또는 인터럽트를 잠시 끄는 임계 구역(단일 코어), 또는 뮤텍스/큐로 접근을 직렬화.

### 3.

1. `head - tail == CAP`은 가득 참, `head == tail`은 비었음.
2. 512개. 한 칸을 비우지 않고 `head - tail`로 구분하기 때문이다.
3. 4,000바이트/초 × 0.2초 = 800바이트. 최소 800바이트이므로 1,024바이트(2의 거듭제곱)를 잡는 것이 안전하다. ELM327 내부 버퍼와 실제 처리 지연도 별도로 고려한다.

### 4.

- A: 된다. 가장 짧은 ISR 작업이다. `volatile` 또는 `_Atomic`을 쓴다.
- B: 된다. ISR-safe API다. `higher_priority_task_woken`과 `portYIELD_FROM_ISR`를 함께 쓴다.
- C: 안 된다. `printf`는 느리고 내부 버퍼·락을 건드린다. ISR이 길어져 다른 인터럽트를 놓친다.
- D: 안 된다. 할당자는 재진입·조각화·시간 예측 불가 문제가 있다.
- E: 안 된다. 일반형은 블로킹할 수 있고 ISR에는 기다릴 태스크가 없다. `FromISR` 변형을 쓴다.

### 5.

1. ISR은 타이머 등으로 계속 실행될 수 있어, 메인 루프가 죽어도 워치독이 리셋되어 "살아 있다"고 착각하게 만든다.
2. 현재 태스크를 TWDT 감시 대상에 추가한다. `NULL`은 호출한 태스크를 뜻한다.
3. 타임아웃을 그 작업보다 길게 잡거나, 작업을 작은 단위로 나누어 중간에 리셋하거나, 해당 구간에서 `esp_task_wdt_reconfigure()`로 타임아웃을 늘리거나 감시에서 잠시 제외한다. 무조건 리셋을 계속하는 것은 해결책이 아니다.
