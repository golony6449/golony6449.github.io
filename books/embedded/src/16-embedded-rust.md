# 16장 임베디드 Rust 맛보기

## 이 장에서

14장과 15장은 C로 메모리와 태스크를 다뤘다. 이 장은 같은 문제를 **Rust**로 접근했을 때 무엇이 달라지는지 맛만 본다. Rust 문법 전체를 가르치는 장이 아니다. 웹 개발자가 이미 아는 `async/await`, 모듈, 패키지 관리자에 Rust의 소유권(ownership)을 더했을 때, 펌웨어의 메모리 오류가 어디까지 컴파일 시점에 걸러지는지 확인하는 것이 목적이다.

이 장의 Rust 코드는 **호스트(PC)에서 실제로 컴파일·실행해 확인했다.** ESP32 타깃으로 빌드하거나 실물에서 실행한 것은 아니며, 그 부분은 `실물 확인 필요`로 표시한다. 사용한 도구는 Rust 1.99.1(2026-10-13), `embedded-hal` 1.0.0, `embassy-executor` 0.10.0이다.

이 장에서 다루는 것:

- 소유권·이동·대여가 메모리 오류를 막는 방식
- `no_std`, 패닉 처리, 정적 메모리
- `embedded-hal` trait로 하드웨어를 추상화하기
- Embassy의 async 실행기와 웹의 `async/await` 비교
- ESP32 Rust 지원 현황(2026-10-29 확인)
- C/C++/Arduino와 Rust를 고르는 기준
- OBD 파서와 SPSC 링 버퍼를 Rust로 옮겨 보기

## 16.1 소유권이 메모리 문제를 막는 방식

Rust의 소유권 규칙은 세 문장이다.

1. 모든 값에는 **소유자**가 하나 있다.
2. 한 시점에 소유자는 **하나뿐**이다.
3. 소유자가 스코프를 벗어나면 값은 **drop**된다.

Rust Book은 이 규칙을 컴파일 시점에 강제한다고 설명한다. "If any of the rules are violated, the program won't compile." 소유권이 없으면 다음과 같은 C의 문제가 생긴다.

```c
char *p = malloc(16);
char *q = p;
free(p);
strcpy(q, "boom");   /* use-after-free */
```

Rust에서는 같은 코드가 컴파일되지 않는다.

```rust
let p = String::from("hello");
let q = p;           // p는 q로 이동(move)된다
println!("{p}");     // error[E0382]: borrow of moved value
```

`p`와 `q`가 같은 힙 데이터를 가리키는데 둘 다 drop되면 **double free**가 된다. Rust는 이동 후 `p`를 무효로 만들어 이 문제를 막는다. 복사가 필요하면 `q = p.clone()`처럼 명시한다. 정수처럼 `Copy` trait을 구현한 값은 이동 대신 복사된다.

### 빌림(borrow)

소유권을 넘기지 않고 읽기만 하려면 참조를 빌린다.

```rust
fn checksum(frame: &[u8]) -> u8 {
    frame.iter().fold(0u8, |acc, b| acc.wrapping_add(*b))
}
```

- `&T`는 공유 참조, `&mut T`는 가변 참조다. 한 시점에 `&T` 여러 개 또는 `&mut T` 하나만 허용된다.
- 참조는 원본보다 오래 살 수 없다. 함수가 지역 변수를 참조해 반환하면 컴파일 오류가 난다.
- `&[u8]`는 배열·`Vec`·슬라이스를 모두 받을 수 있어, 소유권을 넘기지 않고 파서에 데이터를 보여 주기에 좋다.

다음 예제는 `Vec<u8>`을 빌려 체크섬을 계산한 뒤, 소유권을 파서에 넘긴다. 파서가 프레임을 소비하므로 호출자는 이후에 그 프레임을 쓸 수 없다.

```rust
#[derive(Debug, PartialEq)]
enum ParseError {
    TooShort,
    NotSingleFrame,
    NotMode01,
    WrongPid,
}

fn parse_rpm(frame: Vec<u8>) -> Result<u16, ParseError> {
    if frame.len() < 5 {
        return Err(ParseError::TooShort);
    }
    if frame[0] >> 4 != 0 {
        return Err(ParseError::NotSingleFrame);
    }
    if frame[1] != 0x41 {
        return Err(ParseError::NotMode01);
    }
    if frame[2] != 0x0C {
        return Err(ParseError::WrongPid);
    }
    Ok(((frame[3] as u16) << 8 | frame[4] as u16) / 4)
}

fn checksum(frame: &[u8]) -> u8 {
    frame.iter().fold(0u8, |acc, b| acc.wrapping_add(*b))
}

fn main() {
    let frame = vec![0x04, 0x41, 0x0C, 0x1A, 0xF8];
    let sum = checksum(&frame);          // 빌림: frame은 계속 유효
    let rpm = parse_rpm(frame).unwrap(); // 이동: frame은 여기서 소비
    // println!("{:?}", frame);          // E0382: 이동한 값 사용
    assert_eq!(sum, 0x63);
    assert_eq!(rpm, 1726);
    println!("ownership: rpm={rpm}, sum={sum:#04X}");
}
```

필자의 실행 결과는 `ownership: rpm=1726, sum=0x63`이었다.

### GC와 무엇이 다른가

| 항목 | JavaScript GC | Rust 소유권 |
|---|---|---|
| 회수 시점 | 런타임이 도달 가능성(reachability)을 보고 결정 | 컴파일러가 정한 스코프 끝 |
| 비용 | GC pause, 메모리 오버헤드 | 런타임 비용 없음, 컴파일 시간 증가 |
| 순환 참조 | GC가 처리 | `Rc`/`Arc` + `Weak`로 직접 설계 |
| 오류 | use-after-free는 언어가 막음 | 소유권이 막음. 단 `unsafe`는 예외 |
| 지연 | 예측하기 어려운 pause | drop 시점이 코드에 보임 |

MCU에서 GC pause는 실시간 마감을 깨뜨릴 수 있다. Rust는 GC가 없으므로 그 문제가 없지만, 대신 **drop이 언제 일어나는지**를 개발자가 이해해야 한다. 큰 객체를 스택에 두면 Rust도 스택 오버플로가 난다. 소유권은 "모든 메모리 문제"를 막는 마법이 아니다. 논리 오류, 데드락, 스택 오버플로, `unsafe` 코드의 실수는 여전히 남는다.

## 16.2 `no_std`와 패닉

임베디드 Rust는 보통 `#![no_std]`로 시작한다. `std`는 OS·파일 시스템·힙 할당자를 전제로 하기 때문이다. 대신 `core`(언어 기본 기능)와 필요하면 `alloc`(힙 할당)을 쓴다.

```rust
#![no_std]
#![no_main]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}
```

- `#[panic_handler]`는 `no_std` 프로그램에 정확히 하나 필요하다. 패닉 시 동작(중단, 무한 루프, 로그)을 직접 정한다.
- `panic-halt`는 무한 루프, `panic-abort`는 abort 명령을 실행한다. `panic-semihosting`은 호스트 콘솔에 메시지를 보낸다. 어느 것을 쓰든 **패닉이 나면 펌웨어가 멈추거나 재시작한다**는 사실은 같다.
- `no_std`에는 `Vec`, `String`, `HashMap`이 없다. `alloc` crate를 쓰면 쓸 수 있지만, 할당 실패를 처리해야 한다(14.2절).
- 하드웨어 레지스터는 `unsafe`로 접근한다. PAC(Peripheral Access Crate)가 생성한 `read`/`write`/`modify` API를 쓰며, 잘못된 비트 값을 넣으면 안 된다. `embedded-hal`은 이 `unsafe`를 trait 뒤에 숨기는 계층이다.

Rust의 `Result<T, E>`는 C의 오류 코드와 비슷하지만, `#[must_use]`와 `?` 연산자로 무시하기 어렵게 만든다. ESP32에서는 패닉을 리셋으로 연결하는 경우가 많다. 패닉 메시지를 UART에 남기려면 패닉 핸들러에서 로그를 출력하거나, `esp-backtrace` 같은 크레이트를 쓴다(버전·칩 지원 확인 필요).

## 16.3 `embedded-hal`: 하드웨어를 trait 뒤로

`embedded-hal`은 MCU에 독립적인 HAL(Hardware Abstraction Layer) trait 모음이다. 1.0.0은 **2024-01-09에 릴리스**되었다. 주요 모듈은 `digital`, `i2c`, `spi`, `pwm`, `delay`다. 이 crate에는 serial trait이 없고, 시리얼은 `embedded-io`로 분리되어 있다.

드라이버를 `SpiBus`와 `OutputPin`에 제네릭으로 작성하면, STM32·ESP32·RP2040 어디서든 같은 코드를 쓸 수 있다. 테스트에서는 mock 구현을 넣어 하드웨어 없이 검증할 수 있다.

```rust
#![cfg_attr(not(test), no_std)]

use embedded_hal::digital::OutputPin;
use embedded_hal::spi::SpiBus;

#[derive(Debug)]
pub enum SensorError<Spi, Cs> {
    Spi(Spi),
    Cs(Cs),
}

pub struct Sensor<SPI, CS> {
    spi: SPI,
    cs: CS,
}

impl<SPI, CS> Sensor<SPI, CS>
where
    SPI: SpiBus,
    CS: OutputPin,
{
    pub fn new(spi: SPI, cs: CS) -> Self {
        Self { spi, cs }
    }

    pub fn read(&mut self, buf: &mut [u8]) -> Result<(), SensorError<SPI::Error, CS::Error>> {
        self.cs.set_low().map_err(SensorError::Cs)?;
        let result = self.spi.transfer_in_place(buf).map_err(SensorError::Spi);
        self.cs.set_high().map_err(SensorError::Cs)?;
        result
    }
}
```

- `SPI: SpiBus`와 `CS: OutputPin`은 "이 타입은 그 trait을 구현한다"는 제약이다. 구체적인 HAL 타입을 몰라도 된다.
- `SPI::Error`와 `CS::Error`는 연관 타입이다. HAL마다 오류 타입이 달라도 제네릭으로 묶을 수 있다.
- `?`는 오류를 `SensorError`로 변환해 조기 반환한다. C의 `goto cleanup`보다 읽기 쉽고, 반환을 빠뜨릴 수 없다.
- 이 코드는 host에서 mock `SpiBus`/`OutputPin`을 구현해 테스트했고, `cargo test`가 통과했다. 실제 센서와의 통신은 `실물 확인 필요`다.

`embedded-hal` 1.0.0은 blocking trait이 중심이고, async 버전은 `embedded-hal-async`에 있다. 드라이버를 둘 다 지원하려면 trait을 따로 구현하거나, blocking 구현을 async로 감싼다.

## 16.4 Embassy: async 실행기

Embassy는 임베디드용 async 실행기다. JavaScript의 이벤트 루프와 비슷하게, 실행할 준비가 된 Future를 poll하고, 준비된 것이 없으면 CPU를 재운다. 차이는 **힙 없이 정적 저장소를 쓴다**는 점이다. Embassy 문서는 "No alloc, no heap needed. Tasks are statically allocated."라고 설명한다.

```rust
use core::future::pending;

#[embassy_executor::task]
async fn can_rx_task() {
    loop {
        // 실제 보드에서는 can.receive().await 같은 Future를 기다린다.
        pending::<()>().await;
    }
}

fn main() {
    println!("embassy task definition compiled");
}
```

이 코드는 호스트에서 `embassy-executor` 0.10.0의 `platform-std` feature로 컴파일·실행해 확인했다. 출력은 `embassy task definition compiled`이었다. 실제 ESP32에서는 `pending()` 대신 HAL의 async 수신 Future를 기다린다.

### Future, waker, executor

- `async fn`은 호출 시 Future를 만든다. Future는 아직 실행되지 않은 상태다.
- executor가 Future를 poll한다. 진행할 수 없으면 `Pending`을 돌려주고, waker를 등록한다.
- 이벤트(인터럽트, 타이머)가 발생하면 waker가 깨어나고, executor가 해당 Future를 다시 poll한다.
- 준비된 Future가 없으면 executor는 CPU를 sleep한다. 바쁜 대기(busy loop)를 하지 않는다.
- `await`는 "이 Future가 완료될 때까지 이 태스크를 양보"한다. 스레드를 블로킹하지 않는다.

JavaScript와 비교하면:

| JavaScript | Embassy |
|---|---|
| `Promise` | Future |
| `await` | `.await` |
| 이벤트 루프 | executor |
| `setTimeout` | `Timer::after` |
| `fetch()` | HAL의 async I/O |
| 마이크로태스크 큐 | 없음. executor의 run queue |
| GC | 없음. 정적 할당 |

### RTOS와 무엇이 다른가

| 항목 | FreeRTOS | Embassy |
|---|---|---|
| 전환 | 선점(preemptive), 우선순위 | 협조적(cooperative), `await` 지점 |
| 스택 | 태스크마다 별도 | Future 상태가 정적 저장소에 |
| 긴 계산 | 다른 태스크가 선점 가능 | executor를 막아 다른 태스크 굶김 |
| 동기화 | 큐·뮤텍스·세마포어 | 채널·`Mutex`·`Signal` |
| 우선순위 | 태스크 우선순위 | executor 인스턴스로 우선순위 구분 |
| 적합 | 복잡한 우선순위·기존 ESP-IDF | 단순하고 전력 효율적인 I/O |

Embassy에서 **블로킹 호출이나 긴 계산을 하면 다른 태스크가 멈춘다.** JavaScript에서 `while(true)`로 이벤트 루프를 막는 것과 같다. 긴 계산은 작은 단위로 나누고 `yield_now().await`를 넣거나, 별도 executor/인터럽트로 옮긴다. Embassy 문서도 "The executor relies on tasks not blocking indefinitely."라고 경고한다.

ESP32에서 Embassy를 쓰려면 `esp-hal`의 async 주변장치와 `esp-hal-embassy` 실행기를 조합한다. 구체적인 API는 esp-hal 버전마다 다르므로, 이 장에서는 코드를 실물 확인 대상으로 남긴다.

## 16.5 ESP32 Rust 현황 (2026-10-29 확인)

Rust on ESP 생태계는 두 갈래다.

1. **`esp-hal` (no_std)**: Espressif이 공식 지원하는 bare-metal HAL. `embedded-hal`/`embedded-hal-async` trait을 구현한다. async 실행기는 `esp-hal-embassy`를 쓴다.
2. **`esp-idf-hal`/`esp-idf-svc` (std)**: ESP-IDF를 Rust로 감싼 crate. Wi-Fi·HTTP·MQTT·NVS·OTA 같은 서비스를 `std` 환경에서 쓴다. 커뮤니티 프로젝트이며 ESP-IDF 버전을 따라간다.

이 책의 ESP32 예제를 Rust로 옮긴다면, CAN/TWAI와 저수준 제어는 `esp-hal`, Wi-Fi·웹 서버는 `esp-idf-svc`가 더 편할 수 있다. 둘을 한 바이너리에 섞는 것은 복잡하므로, 프로젝트 초기에 선택한다.

### `esp-hal` 1.2.2 기준

- 최신 안정 버전: **1.2.2 (2026-09-18)**. 1.0.0 안정화는 2025-10-30이었다.
- MSRV(최소 Rust 버전): **1.95.0**. 이 책의 실습은 Rust 1.99.1에서 확인했다.
- 지원 칩(README 기준): ESP32, ESP32-C2/C3/C5/C6/C61, ESP32-H2/H4(초기 개발), ESP32-P4, ESP32-S2/S3, ESP32-S31(초기 개발).
- ESP32와 ESP32-S2/S3는 **Xtensa** 타깃이라 표준 rustup 툴체인만으로는 부족하다. `espup`으로 Espressif의 Rust 포크를 설치한다. RISC-V 칩(C3/C6/H2 등)은 rustup 타깃으로 빌드할 수 있다.
- 안정(stable)으로 표시된 주변장치: GPIO, UART, I2C master, SPI master, RNG. 그 외 다수는 unstable/개편 예정/미지원이다. TWAI 드라이버는 있지만, 사용하는 버전의 문서에서 성숙도와 API를 확인해야 한다.
- ESP32는 **rev 3.0 이상**만 지원한다. 오래된 ESP32 보드는 대상이 아니다.

```bash
# Xtensa(ESP32/S2/S3) 기준. 공식 문서의 최신 절차를 확인한다.
cargo install espup --locked
espup install
# Unix: source $HOME/export-esp.sh
# Windows: espup이 환경 변수를 설정한다. 터미널 재시작이 필요할 수 있다.
```

- `espup`은 Xtensa용 Rust 포크, RISC-V 툴체인, LLVM, GCC 링커를 설치한다. 표준 rustup 툴체인과 공존한다.
- 빌드 타깃 예: `xtensa-esp32-none-elf`, `xtensa-esp32s3-none-elf`, `riscv32imc-unknown-none-elf`(C2/C3), `riscv32imac-unknown-none-elf`(C5/C6/H2).
- 플래싱은 `espflash`/`cargo-espflash`를 쓴다. 보드·칩 리비전·부트 모드를 확인한다.

### 현실적인 기대

- `esp-hal`은 빠르게 발전한다. 1.0 이후 안정 API는 semver를 지키지만, unstable 주변장치는 `cargo update`로 깨질 수 있다. 버전을 고정하고 마이그레이션 가이드를 본다.
- 디버깅은 OpenOCD/GDB, `defmt`, `probe-rs` 생태계를 쓴다. C/ESP-IDF만큼 자료가 많지는 않다.
- Wi-Fi/TLS/HTTP까지 한 번에 하려면 `esp-idf-svc`가 성숙하다. 대신 ESP-IDF 버전·툴체인·빌드 시간이 C와 비슷하게 무거워진다.
- CAN(TWAI) 예제는 esp-hal 저장소의 예제와 버전을 맞춰 확인한다. 이 책의 C 예제를 그대로 Rust로 옮길 수는 없다.

## 16.6 C/C++/Arduino와 Rust 중 무엇을 고를까

| 기준 | C/C++/Arduino | Rust |
|---|---|---|
| 생태계·예제 | 압도적으로 많다 | 빠르게 늘지만 칩·주변장치별 편차 |
| 벤더 SDK | ESP-IDF, STM32 HAL, MCUXpresso | esp-hal, esp-idf-hal, HAL crate |
| 메모리 안전 | 개발자 책임 | 소유권·borrow checker가 상당 부분 보장 |
| 컴파일 시간 | 짧다 | 길다(특히 제네릭·async) |
| 바이너리 크기 | 작게 만들기 쉽다 | `opt-level="z"`, LTO로 줄이지만 C보다 클 수 있음 |
| 디버깅 | 익숙한 도구·자료 | 개선 중이나 자료가 적다 |
| 팀 채용 | 넓다 | 상대적으로 좁다 |
| 적합 | 기존 코드·벤더 SDK·작은 바이너리 | 새 프로젝트·안전성·리팩터링 |

이 책은 C를 먼저 가르친다. 임베디드의 제약(메모리, 인터럽트, 전원)을 C로 익히면 Rust의 추상화가 무엇을 감추는지 보인다. Rust는 "C를 몰라도 되는 언어"가 아니다. 오히려 소유권을 이해하려면 스택·힙·포인터를 알아야 한다.

## 16.7 OBD 파서와 링 버퍼를 Rust로

### 파서

C 버전(14장)과 같은 ISO-TP Single Frame 파서를 Rust로 옮기면, 길이·PID 검사를 `enum` 오류로 명시할 수 있다.

```rust
#[derive(Debug, PartialEq, Eq)]
enum FrameError {
    TooShort,
    NotSingleFrame,
    LengthMismatch,
    NotMode01,
    WrongPid,
    Truncated,
}

fn parse_rpm(frame: &[u8]) -> Result<u16, FrameError> {
    if frame.len() < 3 {
        return Err(FrameError::TooShort);
    }
    if frame[0] >> 4 != 0 {
        return Err(FrameError::NotSingleFrame);
    }
    let len = (frame[0] & 0x0F) as usize;
    if !(4..=7).contains(&len) {
        return Err(FrameError::LengthMismatch);
    }
    if frame.len() < 1 + len {
        return Err(FrameError::Truncated);
    }
    if frame[1] != 0x41 {
        return Err(FrameError::NotMode01);
    }
    if frame[2] != 0x0C {
        return Err(FrameError::WrongPid);
    }
    Ok(((frame[3] as u16) << 8 | frame[4] as u16) / 4)
}
```

- `&[u8]`로 빌려 읽으므로 호출자가 프레임을 계속 쓸 수 있다.
- `Result`는 "정상 값 또는 오류"를 타입으로 강제한다. 호출자는 `match`/`?`로 처리해야 하며, 오류를 무시하면 컴파일러가 경고한다.
- `enum` 오류는 C의 정수 오류 코드보다 실수로 다른 오류를 비교할 가능성이 적다.
- `len`은 `41`·PID·데이터를 합친 페이로드 길이다. PCI 1바이트를 더한 `1 + len`이 필요한 총 바이트이므로, 패딩 없는 5바이트 정상 프레임도 받는다.
- 이 코드는 `rustc --test`로 4개 테스트(짧은 프레임, 다중 프레임 PCI, 잘린 페이로드, 패딩 없는 5바이트 정상 프레임)를 통과했다.

### SPSC 링 버퍼

Rust에서는 `AtomicUsize`와 `AtomicU32`로 안전한 SPSC 링 버퍼를 만들 수 있다. `unsafe` 없이도 된다.

```rust
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

const CAP: usize = 1024;

struct Ring {
    head: AtomicUsize,
    tail: AtomicUsize,
    data: [AtomicU32; CAP],
}

impl Ring {
    fn push(&self, value: u32) -> bool {
        let head = self.head.load(Ordering::Relaxed);
        let tail = self.tail.load(Ordering::Acquire);
        if head.wrapping_sub(tail) == CAP {
            return false;
        }
        self.data[head & (CAP - 1)].store(value, Ordering::Relaxed);
        self.head.store(head.wrapping_add(1), Ordering::Release);
        true
    }

    fn pop(&self) -> Option<u32> {
        let tail = self.tail.load(Ordering::Relaxed);
        let head = self.head.load(Ordering::Acquire);
        if head == tail {
            return None;
        }
        let value = self.data[tail & (CAP - 1)].load(Ordering::Relaxed);
        self.tail.store(tail.wrapping_add(1), Ordering::Release);
        Some(value)
    }
}
```

- C 버전과 같은 release/acquire 쌍이다. `Ordering::Relaxed`는 자기 인덱스 읽기, `Acquire`/`Release`는 상대 인덱스와 데이터 발행에 쓴다.
- `std::array::from_fn`으로 `AtomicU32` 배열을 초기화한다. 임베디드에서는 `const` 배열이나 `static`으로 바꾼다.
- `Arc<Ring>`을 생산자/소비자 스레드에 복사해 50만 개를 주고받는 시험을 했고, 순서 오류 없이 통과했다(`spsc: 500000 items ok, capacity 1024`). 구현의 저장 용량은 1024다.
- Rust의 `Send`/`Sync` 덕분에 `Arc<Ring>`을 스레드 사이에 공유해도 데이터 경쟁이 컴파일 시점에 걸러진다. C에서는 `_Atomic`을 빠뜨리면 컴파일러가 경고하지 않는다.

## 흔한 실수

| 실수 | 결과 | 확인 |
|---|---|---|
| 이동한 값을 다시 사용 | 컴파일 오류(E0382) | `clone()`, 참조, 소유권 반환 |
| 지역 변수 참조를 반환 | 컴파일 오류(수명) | 소유권을 반환하거나 `Vec`/`String` 사용 |
| `unsafe`로 MMIO | 잘못된 비트·순서로 하드웨어 손상 | PAC/HAL, 데이터시트 |
| `no_std`에서 `Vec` 사용 | 컴파일 오류 | `alloc` + 할당자, 또는 고정 배열 |
| 패닉 핸들러 없음 | 링크 오류 | `#[panic_handler]` 하나 |
| async 태스크에서 긴 계산 | 다른 태스크 굶음 | `await` 지점, 분할, 별도 executor |
| Embassy를 RTOS처럼 사용 | 우선순위·선점 기대 불가 | 협조적 스케줄링 이해 |
| `esp-hal` unstable API 의존 | `cargo update` 후 깨짐 | 버전 고정, 마이그레이션 가이드 |
| ESP32 rev 3.0 미만 | 지원 안 됨 | 칩 리비전 확인 |
| C 예제를 그대로 Rust로 | HAL·API 불일치 | esp-hal 예제와 버전 맞춤 |

## 장 요약

- Rust 소유권은 이동·빌림·drop으로 double free/use-after-free를 컴파일 시점에 막는다. `unsafe`와 논리 오류는 남는다.
- `no_std`에서는 `core`와 선택적 `alloc`을 쓰고, 패닉 핸들러를 직접 제공한다.
- `embedded-hal` 1.0.0은 `SpiBus`·`OutputPin` 같은 trait으로 HAL을 추상화한다. mock으로 하드웨어 없이 테스트할 수 있다.
- Embassy는 힙 없이 정적 Future를 poll하는 협조적 실행기다. 긴 계산·블로킹은 다른 태스크를 막는다.
- ESP32 Rust는 `esp-hal`(no_std)과 `esp-idf-hal`/`esp-idf-svc`(std) 두 갈래다. 2026-10-29 기준 esp-hal 1.2.2, MSRV 1.95.0, ESP32 rev 3.0 이상.
- C로 임베디드의 제약을 먼저 익히고, Rust는 안전성·리팩터링이 중요한 새 프로젝트에 선택한다.
- 이 장의 Rust 예제는 호스트에서 컴파일·실행했고, ESP32 타깃 빌드와 실물 실행은 하지 못했다.

다음 장에서는 차 없이 CAN을 반복하는 가상 실습실로 돌아간다. vcan, python-can virtual, 가짜 ECU, ELM327-emulator, 로그 재생으로 지금까지의 C·Rust 파서와 상태 기계를 책상 위에서 시험한다.

## 연습 문제

### 1. (중급) 소유권

다음 코드가 컴파일되지 않는 이유를 쓰고, 두 가지 수정 방법을 제시하라.

```rust
let frame = vec![0x04, 0x41, 0x0C, 0x1A, 0xF8];
let rpm = parse_rpm(frame);
println!("{:?}", frame);
```

### 2. (중급) 빌림과 수명

다음 함수가 컴파일되지 않는 이유를 설명하고, 소유권을 반환하도록 고쳐라.

```rust
fn make_frame() -> &[u8] {
    let frame = [0x04, 0x41, 0x0C, 0x1A, 0xF8];
    &frame
}
```

### 3. (중급) `embedded-hal`

1. `SpiBus`와 `OutputPin`을 제네릭으로 받는 드라이버의 장점 두 가지를 쓰라.
2. `SPI::Error`와 `CS::Error`를 하나의 `SensorError`로 묶는 이유는 무엇인가?
3. mock 구현으로 무엇을 시험할 수 있는가?

### 4. (심화) Embassy

1. Embassy 태스크에서 `loop { }`를 돌며 긴 계산을 하면 어떤 일이 생기는가?
2. JavaScript의 `await`와 Embassy의 `.await`의 공통점과 차이를 쓰라.
3. FreeRTOS 태스크와 Embassy 태스크의 스택·전환 방식 차이를 쓰라.

### 5. (중급) ESP32 Rust 현황

1. ESP32(클래식)를 Rust로 빌드할 때 표준 rustup만으로 부족한 이유는 무엇인가?
2. `esp-hal`과 `esp-idf-svc`의 차이를 한 문장으로 쓰라.
3. `esp-hal` 1.2.2에서 안정(stable)으로 표시된 주변장치를 세 가지 이상 쓰라.

## 정답과 해설

### 1.

`parse_rpm(frame)`이 `Vec<u8>`의 소유권을 가져가므로, 이후 `frame`을 사용하면 E0382(borrow of moved value)가 난다. 수정: ① `parse_rpm(&frame)`처럼 참조를 받도록 시그니처를 바꾼다. ② `parse_rpm(frame.clone())`으로 복사본을 넘긴다. ③ `parse_rpm`이 프레임을 돌려주도록 `(frame, rpm)`을 반환한다.

### 2.

`frame`은 함수의 지역 배열이라 함수가 끝나면 사라진다. 그 참조를 반환하면 댕글링 참조가 되므로 컴파일러가 거부한다. 수정: `fn make_frame() -> [u8; 5] { [..] }`처럼 배열을 값으로 반환하거나, `Vec<u8>`/`Box<[u8]>`의 소유권을 반환한다.

### 3.

1. 구체적인 HAL 타입에 묶이지 않아 STM32/ESP32/RP2040에서 같은 드라이버를 쓸 수 있고, 테스트에서 mock을 넣을 수 있다. 또한 드라이버 코드가 하드웨어 세부보다 프로토콜에 집중한다.
2. SPI와 CS의 오류 타입이 다를 수 있으므로, 호출자가 하나의 오류 타입으로 처리하게 하기 위해서다. `?`로 조기 반환하면서 원인을 보존한다.
3. CS 토글 순서, 전송 버퍼 내용, 오류 전파, 재시도 경로, 하드웨어 없이 파서/드라이버 로직.

### 4.

1. executor가 협조적이므로 긴 계산이 끝날 때까지 다른 Future를 poll하지 못한다. 타이머·I/O 태스크가 굶고, 워치독이 있으면 리셋될 수 있다. 계산을 작은 단위로 나누고 `yield_now().await`를 넣거나 별도 executor/인터럽트로 옮긴다.
2. 공통점: 완료되지 않은 작업을 기다리는 동안 다른 작업이 실행된다. 차이: JS는 이벤트 루프·마이크로태스크 큐·GC가 있고, Embassy는 정적 Future·waker·단일 executor run queue를 쓰며 힙이 없다.
3. FreeRTOS는 태스크마다 별도 스택과 선점형 우선순위를 갖는다. Embassy는 Future 상태를 정적 저장소에 두고, `await` 지점에서만 전환하는 협조적 실행이다. 우선순위는 executor 인스턴스로 나눈다.

### 5.

1. ESP32는 Xtensa 아키텍처라 표준 Rust 컴파일러가 백엔드를 지원하지 않는다. `espup`으로 Espressif의 Rust 포크(Xtensa LLVM)를 설치해야 한다.
2. `esp-hal`은 ESP-IDF 없이 동작하는 no_std HAL이고, `esp-idf-svc`는 ESP-IDF를 감싸 Wi-Fi·HTTP·MQTT 같은 서비스를 std 환경에서 제공한다.
3. GPIO, UART, I2C master, SPI master, RNG 중 세 가지. 그 외 주변장치는 버전별 성숙도를 확인한다.
