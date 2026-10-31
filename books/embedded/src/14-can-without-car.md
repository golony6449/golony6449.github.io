# 14장 차 없이 시작하는 CAN 실습실

## 이 장에서

지금까지의 CAN 실습은 차나 벤치 장비를 전제로 했다. 하지만 처음부터 차에 붙이면 위험하고, 매번 같은 상황을 재현하기도 어렵다. 웹 개발에서 로컬 서버·목 API·픽스처로 먼저 개발하듯, CAN도 **차 없이 연습하는 환경**을 먼저 만들 수 있다.

이 장의 목표는 세 가지다.

1. **Linux SocketCAN의 vcan**으로 여러 프로세스가 같은 가상 버스에서 프레임을 주고받는다.
2. **python-can의 virtual 인터페이스**와 작은 **가짜 OBD-II ECU**로 7장의 요청·응답 코드를 차 없이 돌린다.
3. **ELM327-emulator**로 ELM327의 AT 명령과 PID 응답 계층까지 흉내 내, 7장의 대시보드 코드를 시험한다.

웹에 비유하면 다음과 같다.

| 웹 개발 | CAN 실습 |
|---|---|
| 목 API 서버 | 가짜 ECU |
| 로컬 개발 서버 | vcan·python-can virtual |
| 녹화한 HTTP 응답 픽스처 | candump 로그 재생 |
| 샌드박스 결제 API | ELM327-emulator |
| 스테이징 환경 | 책상 위 CAN 벤치 |
| 프로덕션 | 실제 차량(정차·읽기 전용) |

**안전 원칙은 그대로다.** 이 장의 송신 실습(`cansend`, `cangen`, 가짜 ECU, ELM327-emulator)은 **가상 버스나 책상 위 시험 버스에서만** 한다. 실제 차량에서는 정차 상태에서 읽기만 하고, 프레임을 보내거나 고장코드를 지우지 않는다. 9장의 규칙이 이 장에도 적용된다.

이 장에서 다루는 것:

- vcan을 만들고 can-utils로 보고 보내고 기록하고 재생하기
- Windows에서 WSL2·python-can virtual·UDP 멀티캐스트를 고르는 기준
- python-can virtual 위의 가짜 ECU와 OBD-II 클라이언트
- ELM327-emulator로 7장 코드 돌리기
- 기록 로그를 재생해 같은 상황을 반복하기

## 14.1 차 없이 무엇을 연습할 수 있나

가상 버스가 실제 버스를 완전히 대신하지는 않는다. 무엇을 연습하고 무엇을 연습하지 못하는지 먼저 구분한다.

| 연습할 수 있다 | 연습할 수 없다 |
|---|---|
| CAN 프레임 형식, ID, DLC, 바이트 해석 | 차동 전압, 종단 저항, 파형 |
| ISO-TP SF/FF/CF 조립과 FC | 실제 ACK·중재 타이밍 |
| OBD-II 요청/응답, PID 공식 | 비트 타이밍·샘플 포인트 오류 |
| 다중 ECU 응답, 주소 필터 | 버스 부하와 지연의 물리적 한계 |
| 타임아웃·재시도·Bus-Off 처리 로직 | 트랜시버·배선 고장 |
| 파서·대시보드·로그 파이프라인 | 차량 ECU의 실제 응답과 제조사 DID |

- vcan과 python-can virtual은 **프레임을 메모리에서 전달하는 큐**에 가깝다. 실제 CAN 컨트롤러처럼 ACK를 채우거나 오류 카운터를 올리지 않는다. Bus-Off를 시험하려면 가짜 ECU나 테스트 코드가 그 상태를 흉내 내야 한다.
- 물리 계층은 5장의 벤치 실습(보드 2개 + 트랜시버 2개 + 120Ω 2개)으로 따로 연습한다.
- 실제 차량의 응답은 7·8장의 기록을 픽스처로 쓰고, 14.6절에서 재생한다.

## 14.2 Linux: SocketCAN과 vcan

Linux 커널은 **vcan(Virtual CAN)** 드라이버를 제공한다. 실제 CAN 컨트롤러 없이 `vcan0` 같은 인터페이스를 만들고, 같은 인터페이스에 붙은 프로그램끼리 CAN 프레임을 주고받을 수 있다. 커널 문서도 "실제 CAN 컨트롤러 하드웨어 없이 CAN 프레임을 송수신한다"고 설명한다.

### vcan 만들기

```bash
sudo modprobe vcan
sudo ip link add dev vcan0 type vcan
sudo ip link set dev vcan0 up
ip -details link show vcan0
```

- `modprobe vcan`은 커널 모듈을 올린다. 배포판에 따라 모듈 이름이 `vcan`이다. 모듈이 커널에 내장되어 `modprobe`가 "not found"를 내도 `ip link add`가 되면 그대로 진행한다.
- `ip link add dev vcan0 type vcan`은 인터페이스를 만든다. 이름은 `vcan0`, `vcan1`처럼 자유롭게 정한다.
- `ip link set dev vcan0 up`을 빼먹으면 프레임이 오가지 않는다. `ip link` 출력에서 `UP`을 확인한다.
- 재부팅하면 사라진다. 필요하면 systemd 유닛이나 스크립트로 다시 만든다.

### can-utils 설치

Ubuntu/Debian 계열은 패키지로 설치한다.

```bash
sudo apt install can-utils
```

can-utils에는 다음 도구가 들어 있다.

| 도구 | 용도 |
|---|---|
| `candump` | 수신·표시·로그 저장 |
| `cansend` | 프레임 하나 송신 |
| `cangen` | 주기·랜덤 프레임 생성 |
| `cansniffer` | 바뀌는 바이트만 강조 |
| `canplayer` | 로그 재생 |
| `canbusload` | 버스 부하 계산 |
| `can-calc-bit-timing` | 비트 타이밍 계산 |
| `asc2log`, `log2asc` | ASC와 candump 로그 변환 |

### 보고, 보내고, 만들기

터미널 두 개를 연다. 하나는 수신, 하나는 송신이다.

```bash
# 터미널 1: 수신
candump -ta vcan0

# 터미널 2: OBD-II 회전수 요청 한 번
cansend vcan0 7DF#02010C0000000000

# 터미널 2: 100ms 간격으로 ID 0x123 프레임 생성
cangen vcan0 -g 100 -I 123 -L 8 -D i
```

- `cansend`의 형식은 `인터페이스 ID#데이터`다. `7DF#02010C0000000000`은 8바이트 SF 요청이다.
- `cangen`의 `-g`는 간격(ms), `-I`는 ID, `-L`은 DLC, `-D`는 데이터 생성 모드다. `-D i`는 증가하는 값이다.
- `cansniffer vcan0`은 값이 바뀌는 바이트를 강조해 준다. 주기 프레임의 패턴을 볼 때 편하다.
- `canbusload vcan0@500000`은 지정한 비트레이트 기준으로 부하를 계산한다. vcan에는 실제 비트레이트가 없지만, 대략적인 프레임률 점검에 쓸 수 있다.

여기서 `7DF` 요청을 보내도 **응답은 오지 않는다.** vcan은 버스를 흉내 내는 것이지, ECU를 흉내 내는 것이 아니다. 응답을 받으려면 14.4절의 가짜 ECU나 실제 ECU가 필요하다. 웹으로 비유하면 `curl`은 보냈지만 목 서버가 아직 없는 상태다.

### 기록과 재생

`candump -L`은 `canplayer`가 읽을 수 있는 형식으로 저장한다.

```bash
candump -L vcan0 > capture.log
canplayer -I capture.log
```

- 로그 형식은 `(타임스탬프) 인터페이스 ID#데이터`다. 예: `(1000.000000) vcan0 7DF#02010C0000000000`.
- `canplayer`는 기본적으로 로그의 인터페이스 이름으로 프레임을 다시 보낸다. 다른 인터페이스로 보내려면 `canplayer -I capture.log vcan1=vcan0`처럼 **쓰는 인터페이스=로그의 인터페이스** 순서로 지정한다.
- `canplayer -t`는 타임스탬프를 무시하고 즉시 보낸다. `-g <ms>`는 프레임 사이에 최소 간격을 둔다.
- **`canplayer`는 프레임을 실제로 송신한다.** 실제 차량에 연결된 인터페이스로 재생하지 않는다. 재생은 vcan이나 책상 위 시험 버스에서만 한다.
- 오류 프레임까지 보려면 `candump -e`를 켠다. 로그 형식과 사람이 읽는 형식은 다르다.

### vcan의 한계

vcan은 프레임 전달과 주소 필터를 연습하기에는 충분하지만, 다음은 재현하지 않는다.

- ACK 슬롯과 ACK 오류
- 중재와 우선순위
- TEC/REC, Error Passive, Bus-Off
- 비트 타이밍·샘플 포인트·스터프 오류
- 차동 전압·종단·트랜시버 지연

이 항목은 5장의 실제 벤치나, 테스트 코드로 상태를 흉내 내는 방법(16장)으로 다룬다. vcan에서 "프레임이 갔다"와 실제 버스에서 "프레임이 성공했다"는 같은 말이 아니다.

## 14.3 Windows에서 하는 방법

Windows에는 Linux의 vcan 같은 기본 가상 CAN 인터페이스가 없다. 선택지는 다음과 같다.

| 방법 | 되는 일 | 한계 |
|---|---|---|
| python-can `virtual` | 같은 파이썬 프로세스 안의 가상 버스 | 프로세스 밖으로 나가지 않는다 |
| python-can `udp_multicast` | 같은 호스트/네트워크의 여러 프로세스 | UDP 멀티캐스트가 가능한 환경 필요, 전달 보장 없음 |
| WSL2 + vcan | Linux와 같은 실습 | 커널 버전에 따라 CAN/vcan 모듈이 없을 수 있다 |
| USB-CAN 어댑터 | 실제 버스·벤치 | 드라이버·장비 필요 |
| ELM327-emulator TCP | ELM327 계층 실습 | 실제 차량 ECU는 아니다 |

### USB-CAN 어댑터를 차 없이 시험하기

USB-CAN 어댑터를 샀다면, 차에 가져가기 전에 책상에서 어댑터 자체를 시험한다. CAN 컨트롤러에는 보통 세 가지 모드가 있다.

| 모드 | 버스에 하는 일 | 쓰는 때 |
|---|---|---|
| 침묵(listen-only) | 아무것도 내보내지 않는다. ACK도 넣지 않는다 | 차량 버스에 처음 붙일 때 항상(6.10절) |
| 루프백(+침묵) | 보낸 프레임을 내부에서 자기에게 되돌린다. 버스에는 안 나간다 | 차 없이 어댑터·프로그램 시험 |
| 일반 | ACK·오류 프레임을 내고 송신도 한다 | 벤치 버스 |

루프백+침묵으로 설정하고 시험 프레임을 보내 같은 바이트가 돌아오면, PC → USB → 어댑터의 CAN 컨트롤러 → PC 경로가 모두 정상이다. 남은 것은 버스 쪽 배선뿐이다.

예로, CH340 칩을 쓰는 저가 직렬형 어댑터(Waveshare USB-CAN-A)는 2,000,000bps 가상 직렬 위에 전용 이진 프레임을 쓴다(장치마다 다르니 문서를 확인한다).

```text
설정(20바이트, 응답 없음): AA 55 12 <속도> <프레임 종류> <필터 4> <마스크 4> <모드> 01 00 00 00 00 <체크섬>
  속도 03 = 500k, 모드 00 일반 / 01 루프백 / 02 침묵 / 03 루프백+침묵, 체크섬 = 3~19번째 바이트 합 & 0xFF
데이터: AA <C0 | 확장<<5 | 원격<<4 | DLC> <ID 2 또는 4바이트, 리틀 엔디언> <데이터> 55

루프백+침묵, 500k 설정: AA 55 12 03 01 00 00 00 00 00 00 00 00 03 01 00 00 00 00 1A
보냄 → 받음:            AA C5 23 01 DE AD BE EF 00 55   (표준 ID 0x123, 데이터 5바이트)
```

필자의 어댑터에서 시험 프레임 세 개가 바이트까지 똑같이 돌아왔다. 받는 쪽은 3장의 상태 기계 파서와 같은 방식으로 읽는다. 시작 바이트 `AA`를 찾고, 종류 바이트로 길이를 정하고, 끝 바이트가 `55`가 아니면 한 바이트 버리고 다시 동기를 잡는다. 이 어댑터는 ELM327 클론과 같은 CH340 칩이라 USB ID로 구분되지 않는다. ELM327은 `ATI`에 버전으로 답하고, 이 어댑터는 아무 응답도 하지 않는다.

### WSL2에서 vcan이 되는가

WSL2의 CAN/vcan 지원은 **커널 버전에 따라 다르다.** 2026-10 기준 6.18.y 커널 설정에는 `CONFIG_CAN=m`, `CONFIG_CAN_VCAN=m`이 있지만, 배포판에 모듈이 실제로 제공되는지는 별개다. 먼저 WSL 안에서 확인한다.

```bash
uname -r
sudo modprobe vcan
sudo ip link add dev vcan0 type vcan
sudo ip link set dev vcan0 up
ip -details link show vcan0
```

`modprobe: FATAL: Module vcan not found`가 나오면 구버전·커스텀 커널이거나 모듈이 빠진 경우다. 선택지는 세 가지다.

1. **python-can virtual로 Windows에서 연습한다.** 가장 간단하고, 이 장의 가짜 ECU 예제가 그대로 돈다.
2. **WSL2 커스텀 커널을 빌드한다.** WSL2-Linux-Kernel 소스에서 `CONFIG_CAN_VCAN=y` 등을 켜고 커널을 교체한다. WSL 저장소의 사례처럼 동작하지만, 커널 빌드·교체는 초보 실습 범위를 넘는다. 운영 환경에서는 하지 않는다.
3. **USB-CAN 어댑터를 WSL에 붙인다.** USB 패스스루와 드라이버 설정이 필요하고, 어댑터마다 난이도가 다르다. 이 책의 범위 밖이다.

커널 설정에 CAN이 있어도 모듈이 제공되지 않을 수 있고, 반대로 구버전 커널에서는 아예 없을 수 있다. 책의 결론을 그대로 믿지 말고 `modprobe vcan`과 `ip link`로 확인한다.

### python-can virtual

python-can의 virtual 인터페이스는 같은 파이썬 프로세스 안에서 여러 `Bus` 객체를 같은 채널로 묶는다.

```python
import can

bus1 = can.Bus(interface="virtual", channel="vcan0")
bus2 = can.Bus(interface="virtual", channel="vcan0")

bus1.send(can.Message(
    arbitration_id=0x7DF,
    is_extended_id=False,
    data=bytes.fromhex("02 01 0C CC CC CC CC CC"),
))
msg = bus2.recv(timeout=1.0)
print(msg.arbitration_id, msg.data.hex(" "))
```

- `channel`은 임의의 문자열이다. `"vcan0"`이라고 써도 실제 Linux vcan과 연결되는 것은 아니다. 같은 프로세스 안에서 같은 이름을 쓴 객체끼리만 통한다.
- **다른 프로세스와 통신해야 하면 virtual로는 안 된다.** python-can 문서도 "같은 파이썬 프로세스 안"이라고 명시한다. 이때는 `udp_multicast`, vcan, 실제 인터페이스 중 하나를 쓴다.
- `udp_multicast`는 여러 프로세스 사이의 가상 버스다. 예를 들어 `can.Bus(interface="udp_multicast", channel="239.74.163.1", port=43113)`로 같은 그룹에 붙는다. `msgpack`이 필요하고, 전달 보장·순서를 보장하지 않는다고 문서에 적혀 있다. 실습용으로만 쓴다.
- Windows에서 USB-CAN을 쓴다면 어댑터에 맞는 `interface`(예: `pcan`, `kvaser`, `slcan`)를 쓴다.

## 14.4 python-can virtual로 7장 코드 돌리기

이제 가짜 ECU를 만들어 7장의 요청·응답을 차 없이 재현한다. 구성은 다음과 같다.

```text
[probe.py] ── 7DF 요청 ──▶ [가상 버스 vcan0] ──▶ [FakeEcu 스레드]
     ◀── 7E8 응답 ───────────────────────────────┘
```

파일은 세 개다.

```text
obd_lab/
  isotp.py       # 3장의 IsoTpAssembler, flow_control을 복사
  fake_ecu.py    # 가짜 ECU
  probe.py       # 요청과 파싱
```

### 가짜 ECU

`fake_ecu.py`는 엔진 ECU 하나를 흉내 낸다. Mode 01의 PID 00(지원 비트마스크), 05(냉각수), 0C(rpm), 0D(차속), 11(스로틀), 1F(시동 후 시간)와 Mode 09 PID 02(VIN)에 응답한다.

```python
from __future__ import annotations

import threading
import time

import can

CHANNEL = "vcan0"
FUNCTIONAL = 0x7DF
PHYSICAL = 0x7E0
RESPONSE = 0x7E8
PAD = 0xCC


def sf(payload: bytes) -> bytes:
    if len(payload) > 7:
        raise ValueError("Single Frame은 7바이트까지")
    return bytes([len(payload)]) + payload + bytes([PAD]) * (7 - len(payload))


def frame(can_id: int, data: bytes) -> can.Message:
    return can.Message(arbitration_id=can_id, is_extended_id=False, data=data)


class FakeEcu(threading.Thread):
    def __init__(self, channel: str = CHANNEL):
        super().__init__(daemon=True)
        self.bus = can.Bus(interface="virtual", channel=channel)
        self.stop_event = threading.Event()

    def stop(self) -> None:
        self.stop_event.set()

    def run(self) -> None:
        while not self.stop_event.is_set():
            msg = self.bus.recv(0.1)
            if msg is None or msg.arbitration_id not in (FUNCTIONAL, PHYSICAL):
                continue
            data = bytes(msg.data)
            if len(data) < 3 or data[0] >> 4 != 0:
                continue
            length = data[0] & 0x0F
            payload = data[1:1 + length]
            if len(payload) < 2:
                continue
            response = self.answer(payload[0], payload[1])
            if response is None:
                continue
            if len(response) <= 7:
                self.bus.send(frame(RESPONSE, sf(response)))
            else:
                self.send_multiframe(response)

    def answer(self, service: int, pid: int) -> bytes | None:
        if service == 0x09 and pid == 0x02:
            return b"\x49\x02\x01" + b"TESTVIN0000000000"
        if service != 0x01:
            return None
        if pid == 0x00:
            bitmap = (1 << 31) | (1 << 27) | (1 << 20) | (1 << 19) | (1 << 15) | (1 << 1)
            return b"\x41\x00" + bitmap.to_bytes(4, "big")
        if pid == 0x0C:
            return b"\x41\x0C" + int(1726 * 4).to_bytes(2, "big")
        if pid == 0x0D:
            return b"\x41\x0D\x32"          # 50 km/h
        if pid == 0x05:
            return b"\x41\x05" + bytes([90 + 40])  # 90 °C
        if pid == 0x11:
            return b"\x41\x11\x80"          # 50.2 %
        if pid == 0x1F:
            return b"\x41\x1F\x01\x2C"      # 300 s
        return None

    def send_multiframe(self, payload: bytes) -> None:
        total = len(payload)
        self.bus.send(frame(
            RESPONSE,
            bytes([0x10 | (total >> 8), total & 0xFF]) + payload[:6],
        ))
        # 테스터가 보내는 흐름 제어(30 xx xx)를 기다린다.
        deadline = time.monotonic() + 1.0
        while time.monotonic() < deadline:
            msg = self.bus.recv(0.1)
            if msg is None:
                continue
            data = bytes(msg.data)
            if msg.arbitration_id == PHYSICAL and data and data[0] >> 4 == 3:
                break
        else:
            return
        rest = payload[6:]
        seq = 1
        while rest:
            chunk, rest = rest[:7], rest[7:]
            self.bus.send(frame(
                RESPONSE,
                bytes([0x20 | (seq & 0x0F)]) + chunk + bytes([PAD]) * (7 - len(chunk)),
            ))
            seq += 1
```

- 요청은 **Single Frame만** 처리한다. 실제 ECU처럼 ISO-TP로 긴 요청을 받지는 않는다.
- VIN 응답은 20바이트라서 FF + CF 2개로 나눈다. FF를 보낸 뒤 테스터의 FC를 기다린다. FC가 없으면 CF를 보내지 않는다. 3장에서 본 흐름 제어의 실제 예제다.
- `TESTVIN0000000000`은 17자짜리 가짜 VIN이다. 실제 VIN을 코드나 로그에 넣지 않는다.
- `bitmap`은 지원 PID 비트마스크다. 4바이트 big-endian의 **첫 비트(MSB)가 PID 01**, **마지막 비트(LSB)가 PID 20**이다. 여기서는 01, 05, 0C, 0D, 11, 1F를 켠다. 7장의 `supported_pids()`로 풀면 같은 목록이 나온다.

### 요청과 파싱

3장의 `IsoTpAssembler`를 `isotp.py`에 복사했다고 하자. `probe.py`는 가짜 ECU를 같은 프로세스에서 시작하고, 7DF로 요청해 7E8 응답을 조립한다.

```python
import time

import can

from fake_ecu import FakeEcu, FUNCTIONAL, PHYSICAL, RESPONSE, frame, sf
from isotp import IsoTpAssembler


def parse_pid(pid: int, data: bytes) -> float | int | None:
    if pid == 0x05 and len(data) >= 1:
        return data[0] - 40
    if pid == 0x0C and len(data) >= 2:
        return (data[0] * 256 + data[1]) / 4
    if pid == 0x0D and len(data) >= 1:
        return data[0]
    if pid == 0x11 and len(data) >= 1:
        return data[0] * 100 / 255
    if pid == 0x1F and len(data) >= 2:
        return data[0] * 256 + data[1]
    return None


def request(bus: can.BusABC, service: int, pid: int, timeout: float = 1.0) -> bytes | None:
    bus.send(frame(FUNCTIONAL, sf(bytes([service, pid]))))
    assembler = IsoTpAssembler()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        msg = bus.recv(max(0.0, deadline - time.monotonic()))
        if msg is None or msg.arbitration_id != RESPONSE:
            continue
        data = bytes(msg.data)
        if data[0] >> 4 == 1:          # FF: 먼저 FC를 보낸다
            assembler.feed(RESPONSE, data)
            bus.send(frame(PHYSICAL, bytes([0x30, 0x00, 0x00]) + bytes([0xCC]) * 5))
            continue
        payload = assembler.feed(RESPONSE, data)
        if payload is not None:
            return payload
    return None


def main() -> None:
    ecu = FakeEcu()
    ecu.start()
    bus = can.Bus(interface="virtual", channel="vcan0")
    try:
        for pid in (0x00, 0x0C, 0x0D, 0x05, 0x11, 0x1F):
            data = request(bus, 0x01, pid)
            if data is None:
                print(f"01 {pid:02X} -> 응답 없음")
                continue
            value = parse_pid(pid, data[2:])
            suffix = f"  ({value})" if value is not None else ""
            print(f"01 {pid:02X} -> {data.hex(' ').upper()}{suffix}")
        vin = request(bus, 0x09, 0x02)
        if vin is not None:
            print("VIN ->", vin[3:].decode("ascii", errors="replace"))
    finally:
        ecu.stop()
        ecu.join()
        bus.shutdown()
        ecu.bus.shutdown()


if __name__ == "__main__":
    main()
```

실행 결과는 다음과 같다.

```text
01 00 -> 41 00 88 18 80 02
01 0C -> 41 0C 1A F8  (1726.0)
01 0D -> 41 0D 32  (50)
01 05 -> 41 05 82  (90)
01 11 -> 41 11 80  (50.19607843137255)
01 1F -> 41 1F 01 2C  (300)
VIN -> TESTVIN0000000000
```

- `data[2:]`는 `41 <PID>` 뒤의 데이터다. PID 0C라면 `1A F8`이 들어간다.
- `41 00`의 `88 18 80 02`는 지원 PID 비트마스크다. 7장의 `supported_pids()`에 넣으면 `[01, 05, 0C, 0D, 11, 1F]`가 나온다.
- VIN 응답은 `49 02 01` 뒤 17바이트다. `vin[3:]`이 VIN 문자열이다.
- `time.monotonic()`은 벽시계가 아니라 단조 시계다. 재생·타임아웃처럼 경과 시간을 재는 곳에는 `time.time()`보다 이쪽이 안전하다.

### 같은 코드를 vcan으로

Linux에서는 `can.Bus(interface="virtual", ...)`를 `can.Bus(interface="socketcan", channel="vcan0")`로 바꾸면 된다. 그러면 가짜 ECU와 클라이언트를 **서로 다른 프로세스**로 나눌 수 있다.

```bash
# 터미널 1
uv run python fake_ecu.py     # FakeEcu를 단독 실행하는 main을 추가한다

# 터미널 2
uv run python probe.py
```

이때 `fake_ecu.py`에는 `if __name__ == "__main__":`에서 `FakeEcu().run()`을 호출하는 짧은 main이 필요하다. virtual은 프로세스 밖으로 나가지 않으므로, 이 분리가 vcan의 가장 큰 장점이다.

## 14.5 ELM327-emulator로 7장 코드 돌리기

가짜 ECU는 CAN 프레임 계층을 흉내 낸다. 반면 7장의 코드는 **ELM327의 AT 명령과 줄 단위 응답**을 다룬다. 이 계층까지 시험하려면 ELM327-emulator를 쓴다.

`ELM327-emulator`는 파이썬으로 만든 ELM327 에뮬레이터다(2026-10 기준 4.0.0). ELM327 명령, OBD-II 요청, 다중 ECU, UDS, ISO-TP 흐름 제어, SLCAN까지 흉내 낸다. `scenario car`는 Toyota Auris Hybrid의 메시지 흐름을 재현한다.

### 설치와 실행

```bash
uv add ELM327-emulator
uv run python -m elm -s car -n 35000
```

- `-n 35000`은 TCP 35000 포트로 서버를 연다. Windows에서는 com0com 같은 가상 시리얼 드라이버 없이 쓸 수 있다.
- Windows에서 패키지 설치나 실행 중 `UnicodeDecodeError: 'cp949' codec ...`가 나오면 UTF-8 모드로 실행한다. cmd는 `set PYTHONUTF8=1`, PowerShell은 `$env:PYTHONUTF8=1`을 먼저 실행한다.
- `-s car`는 자동차 시나리오를 고른다. 값은 실행마다 달라진다.
- 시리얼 모드로 쓰려면 Windows는 com0com, Linux/macOS는 의사 터미널이 필요하다. 이 책은 드라이버가 필요 없는 TCP 모드를 쓴다.
- 에뮬레이터는 **실제 쏘렌토가 아니다.** Toyota Auris Hybrid 시나리오의 값이므로, 쏘렌토의 PID/DID 값으로 결론을 내리면 안 된다. AT 명령·줄 파싱·ISO-TP 조립·대시보드 배선을 시험하는 데 쓴다.

### TCP를 시리얼처럼 다루는 클래스

7장의 `Elm327` 클래스는 `serial.Serial`을 쓴다. 같은 `command()`·`query_pid()` 인터페이스를 TCP 소켓으로 구현하면, 나머지 `ObdReader`·Flask 코드는 그대로 쓸 수 있다.

```python
import socket
import time


class Elm327Tcp:
    def __init__(self, host: str = "127.0.0.1", port: int = 35000, timeout: float = 1.0):
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self.sock.settimeout(0.1)
        self.timeout = timeout

    def close(self) -> None:
        self.sock.close()

    def command(self, cmd: str, timeout: float | None = None) -> list[str]:
        timeout = self.timeout if timeout is None else timeout
        self.sock.sendall((cmd + "\r").encode("ascii"))
        buf = bytearray()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                chunk = self.sock.recv(1)
            except socket.timeout:
                continue
            if not chunk:
                break
            buf.extend(chunk)
            if chunk == b">":
                break
        else:
            raise TimeoutError(f"{cmd!r} 응답에 프롬프트가 없습니다: {buf!r}")

        text = buf.decode("ascii", errors="replace").replace("\r", "\n")
        return [
            line.strip()
            for line in text.split("\n")
            if line.strip() and line.strip() != ">" and line.strip() != cmd
        ]

    def query_pid(self, pid: int) -> bytes | None:
        for line in self.command(f"01{pid:02X}"):
            if ":" in line:                 # ELM327의 '0:', '1:' 조립 줄
                line = line.split(":", 1)[1]
            compact = "".join(line.split())
            if not compact.startswith("41") or len(compact) < 4:
                continue
            try:
                got_pid = int(compact[2:4], 16)
            except ValueError:
                continue
            if got_pid != pid:
                continue
            data = compact[4:]
            if len(data) % 2 == 0:
                return bytes.fromhex(data)
        return None
```

```python
elm = Elm327Tcp()
for cmd in ("ATI", "ATE0", "ATL0", "ATSP0"):
    print(cmd, "->", elm.command(cmd, timeout=3))
print("ATDPN", elm.command("ATDPN"))
for pid in (0x0C, 0x0D, 0x05):
    data = elm.query_pid(pid)
    print(f"01{pid:02X}", data.hex(" ") if data else None)
elm.close()
```

출력 예는 다음과 같다. `010C`의 값은 에뮬레이터 시나리오가 동적으로 바꾸므로 실행마다 다르다.

```text
ATI -> ['ELM327 v1.5']
ATE0 -> ['OK']
ATL0 -> ['OK']
ATSP0 -> ['OK']
ATDPN ['A6']
010C 14 5F
010D 33
0105 64
```

### 7장 대시보드에 끼우기

7장의 `obd_dashboard.py`에서 생성자만 바꾸면 된다.

```python
# 7장 코드
# elm = Elm327(args.port, args.baud)
elm = Elm327Tcp()          # ELM327-emulator가 35000에서 실행 중일 때
```

- `ObdReader`는 `elm.query_pid()`만 호출하므로 그대로 동작한다.
- `main()`의 `ATZ`·`ATE0`·`ATL0`·`ATSP0`·`ATDPN`·`ATRV` 호출도 `command()`로 처리된다.
- `elm.close()`도 구현되어 있다.
- `--demo` 모드는 에뮬레이터 없이도 화면을 볼 수 있다. 에뮬레이터는 **실제 ELM327 계층**까지 시험하고 싶을 때 쓴다.

### 에뮬레이터로 시험할 것과 시험하지 말 것

| 시험할 수 있다 | 시험하면 안 되는 것 |
|---|---|
| AT 명령 파싱, 프롬프트 처리 | 쏘렌토의 실제 PID/DID 값 |
| `41 <PID>` 응답 파싱, 다중 PID | 실제 차량의 응답 시간·타이밍 |
| ISO-TP 다중 프레임(`0:`, `1:`) | 버스 오류·Bus-Off |
| 대시보드의 오류 표시 | 제조사 UDS 쓰기·코딩 |
| 재연결·타임아웃 로직 | 배터리·전원·접지 문제 |

에뮬레이터가 UDS 쓰기나 리셋을 지원하더라도, 실제 차량에 그 명령을 보내지 않는다. 9장의 읽기 전용 원칙은 도구가 바뀌어도 같다.

## 14.6 기록을 재생해 같은 상황 반복하기

실차에서 한 번 기록한 로그는 가장 현실적인 픽스처다. 같은 프레임을 다시 흘려보내면 파서·대시보드·알람을 반복 시험할 수 있다.

```python
import time

import can


def replay(path: str, channel: str = "vcan0", speed: float = 1.0) -> int:
    """candump/ASC/BLF 로그를 가상 버스로 재생한다. speed=2면 2배 빠르게."""
    if speed <= 0:
        raise ValueError("speed는 0보다 커야 한다")
    reader = can.LogReader(path)
    bus = can.Bus(interface="virtual", channel=channel)
    sent = 0
    try:
        t0 = None
        start = time.monotonic()
        for msg in reader:
            if t0 is None:
                t0 = msg.timestamp
            target = start + (msg.timestamp - t0) / speed
            delay = target - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            bus.send(msg)
            sent += 1
    finally:
        bus.shutdown()
        reader.stop()
    return sent
```

- `can.LogReader`는 확장자로 형식을 고른다. `.log`(candump), `.asc`, `.blf`, `.csv` 등을 읽는다.
- 타임스탬프는 로그의 절대 시각이 아니라 **첫 프레임과의 차이**로 계산한다. 그래야 며칠 전 로그도 같은 상대 시간으로 재생된다.
- `speed`를 높이면 빠르게, 낮추면 느리게 재생한다. 테스트에서는 `speed=0` 대신 `speed=100`처럼 아주 빠르게 하고, 타이밍 검증이 필요하면 1.0으로 둔다.
- 재생한 프레임을 받는 쪽은 같은 `channel`의 virtual 버스나 vcan에 붙어 있어야 한다.
- **실제 차량 인터페이스로 재생하지 않는다.** 로그에 있던 프레임을 차량에 다시 보내는 것은 읽기 전용 원칙 위반이고, 위험하다.

기록을 만들 때는 원시 프레임을 남긴다. 해석된 값만 저장하면 파서가 틀렸을 때 되돌아갈 수 없다. 로그 형식과 저장 파이프라인은 17장에서 더 다룬다.

## 14.7 흔한 실수

| 증상 | 원인 후보 | 확인 |
|---|---|---|
| vcan에서 아무것도 안 보임 | 인터페이스가 `DOWN`, 다른 인터페이스 이름 | `ip -details link show vcan0` |
| `modprobe vcan` 실패 | 커널 모듈 없음(WSL2 기본 커널 등) | `uname -r`, WSL 이슈, python-can virtual로 대체 |
| 요청을 보냈는데 응답 없음 | vcan에는 ECU가 없음 | 가짜 ECU를 같은 버스에 붙인다 |
| virtual 버스에서 두 프로세스가 안 통함 | virtual은 프로세스 안에서만 동작 | `udp_multicast`, vcan, 실제 인터페이스 |
| 가짜 ECU가 응답하지 않음 | 채널 이름 불일치, ECU 스레드 미시작 | 양쪽 `channel` 확인, `ecu.start()` |
| 다중 프레임이 첫 줄만 옴 | FC를 보내지 않음 | FF 수신 후 `30 00 00` 송신 |
| ELM327-emulator 응답이 이상함 | 시나리오 값이 쏘렌토와 다름 | `-s car`는 Toyota 시나리오, AT/PID 파싱만 시험 |
| TCP 연결 거부 | 에뮬레이터 미실행, 포트 충돌 | `-n 35000`, 방화벽, 다른 포트 |
| 로그 재생이 안 됨 | 인터페이스 이름 불일치, 파일 형식 | `canplayer` assignment, `can.LogReader` 확장자 |
| 재생이 차량으로 나감 | 인터페이스를 실제 CAN으로 지정 | vcan/벤치만 사용 |

## 14.8 체크리스트

- [ ] vcan 모듈을 올리고 인터페이스를 `UP`으로 만들었는가
- [ ] can-utils의 `candump`·`cansend`·`cangen`·`canplayer`를 구분해 쓸 수 있는가
- [ ] vcan이 ACK·오류 카운터·비트 타이밍을 재현하지 않는다는 점을 아는가
- [ ] Windows에서 virtual이 프로세스 안에서만 동작한다는 점을 아는가
- [ ] WSL2 기본 커널의 vcan 지원을 `modprobe`로 확인했는가
- [ ] 가짜 ECU와 클라이언트가 같은 채널을 쓰는가
- [ ] FF를 받으면 FC를 보내는가
- [ ] ELM327-emulator의 값이 실제 차량 값이 아님을 구분하는가
- [ ] 로그 재생을 vcan/벤치에서만 하는가
- [ ] 실제 차량에서는 읽기 전용을 지키는가

## 장 요약

- vcan은 실제 CAN 컨트롤러 없이 프레임을 주고받는 Linux 가상 인터페이스다. `modprobe vcan` → `ip link add` → `ip link set up` 순서로 만든다.
- can-utils의 `candump`·`cansend`·`cangen`·`cansniffer`·`canplayer`로 보고, 보내고, 만들고, 재생한다.
- vcan은 ACK·중재·오류 카운터·비트 타이밍을 재현하지 않는다. 물리 계층은 실제 벤치에서 연습한다.
- Windows에서는 python-can virtual(프로세스 안), udp_multicast(프로세스 사이), WSL2 vcan(커널 지원 확인), USB-CAN 어댑터 중에서 고른다.
- WSL2 기본 커널에 CAN/vcan이 없다면 커스텀 커널을 빌드하거나 python-can virtual로 대체한다.
- python-can virtual 위에 가짜 ECU를 만들면 7장의 요청·응답·ISO-TP 조립을 차 없이 시험할 수 있다.
- ELM327-emulator는 AT 명령과 ELM327 응답 계층을 흉내 낸다. `scenario car`는 Toyota 시나리오이므로 쏘렌토 값으로 오해하지 않는다.
- 기록 로그를 재생하면 같은 프레임을 반복 시험할 수 있다. 재생은 vcan/벤치에서만 하고 실제 차량에 보내지 않는다.

## 연습 문제

### 1. vcan 만들기

Linux에서 `vcan0`을 만들어 `candump`로 프레임을 보려 한다. 올바른 순서로 나열하라.

```text
ip link set dev vcan0 up
modprobe vcan
ip link add dev vcan0 type vcan
candump -ta vcan0
```

### 2. 왜 응답이 없나

vcan0에서 `cansend vcan0 7DF#02010C0000000000`을 보냈다. `candump`에는 프레임이 보이지만 OBD 응답은 없다.

1. 가장 가능성 높은 원인은 무엇인가?
2. 응답을 받으려면 무엇을 추가해야 하는가?
3. 이 상황을 웹 개발에 비유하면 무엇인가?

### 3. virtual과 vcan

python-can virtual로 만든 `vcan0` 버스가 있는데, 다른 터미널의 프로그램이 프레임을 받지 못한다.

1. 이유는 무엇인가?
2. 두 프로세스가 통신하려면 어떤 선택지가 있는가?
3. virtual의 `channel="vcan0"`은 Linux vcan0과 같은 것인가?

### 4. ELM327-emulator

ELM327-emulator를 `-s car -n 35000`으로 실행하고 7장 대시보드를 붙였다. `ATDPN`은 `A6`, PID 0C는 어떤 값이 나왔다.

1. 이 값으로 쏘렌토의 rpm을 확인했다고 말할 수 있는가?
2. 이 에뮬레이터로 시험할 수 있는 것은 무엇인가?
3. 실제 차량에서 에뮬레이터의 UDS 쓰기 명령을 보내면 왜 안 되는가?

### 5. 로그 재생

`capture.log`에 실제 차량에서 기록한 프레임이 있다. 이 로그를 재생해 대시보드를 시험하려 한다.

1. 어느 인터페이스로 재생해야 하는가?
2. `canplayer`를 실제 차량 CAN에 연결해 실행하면 왜 위험한가?
3. 재생 속도를 바꾸는 것은 어떤 경우에 유용한가?

## 정답과 해설

### 1.

`modprobe vcan` → `ip link add dev vcan0 type vcan` → `ip link set dev vcan0 up` → `candump -ta vcan0`. 모듈을 올리고, 인터페이스를 만들고, `UP`으로 올린 뒤에야 프레임이 오간다.

### 2.

1. vcan은 버스를 흉내 내는 것이지 ECU를 흉내 내지 않는다. 요청 프레임은 다른 프로그램에 전달되지만, 응답을 만들 ECU가 없다.
2. 같은 vcan0에 붙은 가짜 ECU(14.4절)나 실제 ECU, 또는 ELM327-emulator 같은 응답 생성기가 필요하다.
3. `curl`로 요청을 보냈지만 목 서버가 없는 상태와 비슷하다. 요청은 성공했지만 응답할 주체가 없다.

### 3.

1. python-can virtual은 **같은 파이썬 프로세스 안**의 Bus 객체끼리만 통신한다. 다른 프로세스는 같은 채널 이름을 써도 별개의 세계다.
2. `udp_multicast` 인터페이스, Linux vcan(SocketCAN), 실제 CAN 인터페이스, 또는 프로세스 사이를 중계하는 프로그램을 쓴다.
3. 아니다. virtual의 채널은 임의의 문자열 이름일 뿐이고, Linux vcan0과 연결되지 않는다. 같은 이름을 썼다는 이유로 프레임이 건너가지 않는다.

### 4.

1. 아니다. `-s car`는 Toyota Auris Hybrid 시나리오다. 값은 쏘렌토의 실제 rpm이 아니며, 실행마다 달라질 수 있다.
2. AT 명령 파싱, 프롬프트 처리, `41 <PID>` 파싱, 다중 프레임 조립, 대시보드 오류 표시, 재연결·타임아웃 로직을 시험할 수 있다.
3. 에뮬레이터는 실제 차량이 아니다. 쓰기·리셋·코딩 명령은 실제 ECU의 상태를 바꾸고 안전·배출가스 장치에 영향을 줄 수 있다. 이 책의 읽기 전용 원칙과 9장의 법·윤리 규칙을 따른다.

### 5.

1. vcan이나 책상 위 시험 버스. 실제 차량 CAN에 연결된 인터페이스로는 재생하지 않는다.
2. `canplayer`는 로그의 프레임을 **실제로 송신**한다. 기록에 있던 일반 프레임·진단 요청이 차량 버스로 나가면 ECU 상태를 바꾸거나 안전에 영향을 줄 수 있다.
3. 파서·대시보드의 처리 속도를 시험할 때는 빠르게(`speed`를 크게), 타이밍·타임아웃·재전송을 시험할 때는 1.0이나 그보다 느리게 재생한다. 실제 버스의 지연을 재현하려면 하드웨어 벤치가 필요하다.
