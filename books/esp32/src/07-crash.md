# 7장 일부러 죽여 보기: 스택 오버플로

## 7.1 크래시 스위치

6장의 스케치에는 스위치가 하나 있다.

```cpp
#define CRASH_DEMO 0   // 1로 바꾸면 스택 오버플로 크래시를 본다
#if CRASH_DEMO
#define STACK_BYTES 1024   // 일부러 작게
#else
#define STACK_BYTES 4096
#endif
```

`CRASH_DEMO`를 1로 두면 스택을 1024바이트로 줄이고, 2048바이트짜리 지역 배열을 쓰는 함수(`overflow_stack()`)를 불러 일부러 스택을 넘친다. 소프트웨어로 치면 재귀를 깊게 돌려 스택 오버플로를 내 보는 것이다. 이 변경은 실험할 때만 켜고, 저장소에는 0으로 둔다.

## 7.2 보드가 죽는 모습

올리자마자 시리얼에 이런 화면이 1초 간격으로 반복됐다(**실측**, 레지스터 덤프 일부 생략).

```text
Guru Meditation Error: Core  1 panic'ed (Unhandled debug exception).
Debug exception reason: Stack canary watchpoint triggered (my_task)
Core  1 register dump:
PC      : 0x42019dd1  PS      : 0x00060d36  A0      : 0x8202049d  A1      : 0x3fcec310
...
Backtrace: 0x42019dce:0x3fcec310 0x4202049a:0x3fcec630 0x420204d6:0x3fcec6c0 0x42002742:0x3fcec700 0x420027c5:0x3fcec780 0x42001d65:0x3fcec7d0 0x4037ee2a:0x3fcec7f0
Rebooting...
ESP-ROM:esp32s3-20210327
rst:0xc (RTC_SW_CPU_RST),boot:0x8 (SPI_FAST_FLASH_BOOT)
...
# setup() core=1 prio=1 stack=1024 bytes crash_demo=1
Guru Meditation Error: Core  1 panic'ed (Unhandled debug exception).
...
```

한 줄씩 읽으면 이렇다.

| 줄 | 뜻 |
|---|---|
| `Guru Meditation Error` | ESP32의 "패닉" 화면. 커널 패닉이나 블루스크린과 같은 자리다 |
| `Stack canary watchpoint triggered (my_task)` | `my_task`의 스택 끝에 걸어 둔 **하드웨어 감시점**을 넘었다 |
| `Backtrace: ...` | 죽은 순간의 호출 스택(주소) |
| `rst:0xc (RTC_SW_CPU_RST)` | 패닉 처리기가 소프트웨어로 CPU를 리셋했다 |

> **알게 된 점** — ESP32는 스택 끝에 경보선을 쳐 둔다. 넘는 순간 바로 멈추고 어디서 넘었는지 알려 준다. 메모리를 조용히 망가뜨린 채 엉뚱한 곳에서 죽는 것보다 훨씬 낫다.

## 7.3 백트레이스를 사람 말로 바꾸기

주소만으로는 어디서 죽었는지 모른다. 보드 패키지에 든 `addr2line`에 빌드 결과(`.elf`)와 주소를 넣으면 함수와 줄 번호로 바뀐다.

```bash
xtensa-esp32s3-elf-addr2line -pfiaC -e 00_first_task.ino.elf 0x42019dce 0x4202049a ...
```

```text
newlib/libc/stdio/vfprintf.c:885
newlib/libc/stdio/vsnprintf.c:70
newlib/libc/stdio/vsnprintf.c:40
Print::vprintf(...)   at cores/esp32/Print.cpp:51
Print::printf(...)    at cores/esp32/Print.cpp:85
my_task(void*)        at 00_first_task.ino:79
```

웹 개발자에게 익숙한 스택 트레이스다. 위에서부터 읽으면 `my_task` → `Serial.printf` → `vfprintf`에서 죽었다.

> **감탄 노트** — 예상과 다른 곳에서 죽었다. 스택을 넘치게 하려고 만든 `overflow_stack()`에 **닿기도 전에**, 첫 `printf`에서 이미 넘쳤다.

6장에서 잰 값이 그대로 맞아떨어졌다. `printf` 한 줄에 약 1,660바이트가 필요한데 스택은 1024바이트였다. hwm으로 잰 숫자가 크래시 지점을 미리 말해 주고 있었다.

## 7.4 B-2의 단서: 죽은 곳은 core 1

6장에서 `my_task`는 줄마다 core 0에서 돌았다. 그런데 이번 크래시는 **core 1**에서 났다. 첫 `printf`에서 죽었으니, 이건 `my_task`가 **처음 실행되던 순간**이다.

- 처음 실행: 자기를 만든 `setup()`과 같은 core 1 (**실측**, 크래시 코어)
- 잠에서 깬 뒤: core 0 (**실측**, 6장)

"처음엔 만든 코어에서, 깨어난 뒤엔 틱을 처리하는 core 0에서"라면 6장의 추정과 맞는다. 다만 정상 실행에서 `tick=1`이 어느 코어였는지는 시리얼을 늦게 붙여 두 번이나 놓쳤다.

그래서 스케치를 고쳤다. `my_task`가 시작하자마자, 아무것도 출력하기 전에 자기 코어를 변수에 적어 두고, 매 줄 끝에 `first=`로 붙여 찍는다. 첫 줄을 놓쳐도 언제든 볼 수 있다. 코어 번호를 읽는 건 레지스터 하나를 읽는 정도라 관찰자 효과도 거의 없다.

```cpp
static void my_task(void *arg) {
  const int first_core = (int)xPortGetCoreID();  // 출력보다 먼저 적어 둔다
  for (;;) {
    Serial.printf("tick=%lu core=%d hwm=%u first=%d
", ..., first_core);
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}
```

```text
tick=12 core=0 hwm=2436 first=1
tick=13 core=0 hwm=2436 first=1
```

**`first=1`**(**실측**). `my_task`는 자기를 만든 `setup()`과 같은 core 1에서 시작했고, `vTaskDelay`에서 깨어난 뒤로는 core 0에서 돌았다. 크래시가 알려 준 단서와 같은 결과다. 왜 깨어나면 core 0인지(틱 처리 담당)는 여전히 **추정**이다.

> **알게 된 점** — 놓치기 쉬운 순간의 값은 그 순간에 출력하지 말고 변수에 적어 두었다가 나중에 계속 보여 준다. 실험 01에서 쓸 "버퍼에 쌓고 끝나고 출력" 원칙의 작은 판이다.

## 7.5 재부팅 루프와 사라지는 포트

크래시 → 재부팅 → 같은 코드 → 같은 크래시. **재부팅 루프**다. 로봇이라면 1초마다 리셋되는 상태다. 웹 서비스의 크래시 루프(CrashLoopBackOff)와 같은데, 여기에는 백오프도 없다.

정상 버전으로 되돌려 올리려 하자 업로드가 실패했다.

```text
A fatal error occurred: Could not open COM9, the port doesn't exist
...
A serial exception error occurred: Write timeout
```

다섯 번 다시 시도해도 같았다. 이 보드의 PC 연결은 칩 내장 USB다(2장). 칩이 1초마다 리셋되니 **USB 장치 자체가 1초마다 사라졌다 나타났다.** 업로드 도구가 붙을 틈이 없다.

해결은 3장의 수동 다운로드 모드였다. BOOT를 누른 채 RESET을 눌렀다 떼면, 칩은 내 펌웨어(크래시 나는 코드)를 실행하지 않고 ROM에서 기다린다. 그 상태로 정상 버전을 올리고 RESET을 한 번 더 누르자 다시 1초마다 `tick`이 찍혔다.

> **알게 된 점** — 펌웨어가 망가지면 그 펌웨어를 고칠 통로(USB)도 같이 망가질 수 있다. ROM의 다운로드 모드는 그때 쓰는 비상구다. 서버로 치면 OS가 부팅하지 않아도 들어갈 수 있는 원격 콘솔(IPMI)이다.

## 알게 된 점

- ESP32는 스택 오버플로를 하드웨어 감시점으로 잡는다. `Stack canary watchpoint triggered (태스크 이름)`이 그 신호다
- 백트레이스는 `addr2line`으로 함수와 줄 번호로 바꿔 읽는다
- 크래시는 재부팅 루프가 되고, 내장 USB 보드에서는 포트까지 사라진다. BOOT+RESET이 비상구다
- 미리 잰 hwm이 크래시 지점을 예고했다. 재 두면 쓸모가 있다
