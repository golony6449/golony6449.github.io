# 3장 프레이밍과 파싱: 메시지 경계 만들기

## 이 장에서

시리얼에는 메시지 경계가 없다. 프레이밍은 "어디서부터 어디까지가 한 메시지인가"를 정하는 규칙이고, 파싱은 그 규칙을 바이트 스트림에 적용하는 일이다.

웹 개발자에게 이 장은 가장 익숙하면서도 가장 낯선 주제다. HTTP 파서가 하는 일을 직접 만든다고 생각하면 된다. 다만 HTTP에서는 `Content-Length`와 `Transfer-Encoding`이라는 표준 헤더가 이미 있고, 수많은 라이브러리가 그 파서를 제공한다. 여기서는 **그 헤더를 직접 설계하고, 그 파서를 직접 쓰고, 그 파서를 테스트한다.**

이 장은 이 책의 심장이다. UART·I2C·SPI·CAN 어느 쪽을 쓰더라도 결국 "바이트 더미에서 의미 있는 메시지를 꺼내는 일"이 남는다. 이 장을 이해하면 통신 버그의 절반은 스스로 진단할 수 있게 된다.

## 3.1 프레이밍 방식

프레이밍에는 여러 가지 방식이 있고, 각각 장단점이 있다.

| 방식 | 예 | 장점 | 단점 |
|---|---|---|---|
| 구분자(delimiter) | `\n`, `\r\n`, NMEA(해상 장비 텍스트), AT 명령(모뎀 제어) | 구현이 쉽고 사람이 읽기 좋다 | 페이로드에 구분자가 들어가면 이스케이프 필요 |
| 길이 접두(length prefix) | `[LEN][PAYLOAD]` | 바이너리에 효율적, 경계가 명확 | 길이가 깨지면 복구가 어렵다. 최대 길이 검증 필수 |
| 고정 크기 | 8바이트 프레임 | 가장 단순, 파서가 빠름 | 필드가 늘면 호환성이 깨진다 |
| 무음 간격(idle gap) | Modbus RTU | 기존 프로토콜이 이미 사용 | USB 지연·노이즈에 취약 |
| 구분자 + 제로 제거 | COBS | 바이너리에서도 경계가 안전, 이스케이프 상태 없음 | 인코딩/디코딩 오버헤드 |
| 구분자 + 이스케이프 | SLIP | 바이너리에서도 경계가 안전 | 이스케이프/디코딩 오버헤드 |
| 비트 스터핑 | CAN, HDLC | 하드웨어가 처리 | 직접 구현할 일은 드묾 |

"무엇이 가장 좋은가"라는 질문에는 답이 없다. 상대 장치가 이미 쓰는 방식을 따라야 하는 경우가 많고, 새로 설계한다면 **바이너리인지 텍스트인지, 길이가 가변인지 고정인지, 오류 복구가 얼마나 중요한지**로 고른다.

### 구분자

텍스트 프로토콜은 `\n` 또는 `\r\n`을 끝으로 쓴다. 구현하기 쉽고 사람이 읽기 좋다. 하지만 다음을 반드시 정해야 한다.

- `\r`을 지울지 말지
- 빈 줄을 무시할지
- 최대 줄 길이를 얼마로 할지
- 페이로드에 구분자가 들어갈 수 있을 때 어떻게 할지

페이로드에 구분자가 들어갈 수 있으면 이스케이프하거나(예: `\` + `n`) 인코딩(base64, hex)한다. 이스케이프를 안 하면 파서가 중간에서 끊긴다. 줄 길이 상한을 두지 않으면 쓰레기 데이터가 들어올 때 버퍼가 무한히 커진다.

### 길이 접두

가장 흔한 바이너리 방식은 다음과 같다.

```text
[SOF][LEN][PAYLOAD][CRC]
```

- `LEN`의 단위(바이트/워드), 크기(1/2/4바이트), 엔디언을 문서화한다.
- **최대 길이를 반드시 검증**한다. `LEN=0xFF`인 가짜 헤더를 받고 255바이트를 기다리면 그동안 정상 프레임을 놓친다. 공격자가 아니라 노이즈만으로도 이런 일이 생긴다.
- 길이가 깨졌을 때를 위해 "프레임 시작 후 N ms 동안 완성되지 않으면 버퍼를 비운다"는 타임아웃을 둔다.
- 체크섬은 보통 `LEN`부터 계산한다. 헤더 일부만 계산하면 길이 필드가 깨져도 통과할 수 있다.

### 무음 간격

Modbus RTU는 프레임 사이에 3.5문자 시간의 무음이 있으면 프레임이 끝난 것으로 본다. 19200 baud 초과에서는 고정 1.75ms를 권장한다(Modbus 규격).

이 방식은 USB-UART 어댑터의 지연 타이머(Windows 기본 16ms 안팎)가 바이트를 뭉쳐 보내면 깨질 수 있다. Modbus RTU를 USB로 다룰 때는 어댑터와 드라이버의 지연 설정을 확인한다. "프로토콜은 맞는데 가끔 프레임이 합쳐진다"는 증상이 나오면 이 지연을 의심한다.

### COBS(Consistent Overhead Byte Stuffing)

- 페이로드에서 `0x00`을 없애고, 프레임 끝에 `0x00`을 붙여 경계로 쓴다.
- 수신측은 `0x00`을 만나면 한 프레임을 완성한다.
- 오버헤드는 254바이트마다 최대 1바이트(약 0.4%)다.
- 이스케이프 상태가 없어 파서가 단순하고, 깨져도 다음 `0x00`에서 바로 재동기화된다.

바이너리 프로토콜에 특히 잘 맞는다. 구현은 `cobs` 라이브러리를 쓰고, 인코딩/디코딩 왕복 테스트를 한다. 직접 구현한다면 "0을 없애는 규칙"과 "프레임 끝의 0"을 혼동하지 않아야 한다.

### SLIP

- `END=0xC0`, `ESC=0xDB`.
- 페이로드의 `0xC0`은 `0xDB 0xDC`, `0xDB`는 `0xDB 0xDD`로 바꾼다.
- 프레임 사이는 `END`로 구분한다.

일부 구현은 XON/XOFF(`0x11`/`0x13`)도 이스케이프한다. 상대 구현과 규칙을 맞춘다. COBS보다 오버헤드가 들 수 있지만, 역사적으로 널리 쓰인다.

## 3.2 예시 프레임: `A5 03 01 2A 00 C1 01`

이 장에서는 다음 프레임을 예로 든다.

```text
A5        SOF (Start of Frame)
03        LEN: payload 길이 3바이트
01 2A 00  PAYLOAD
C1 01     CRC-16/CCITT-FALSE (LEN + PAYLOAD에 대해 계산)
```

CRC는 `LEN`과 `PAYLOAD` 전체, 즉 `03 01 2A 00`에 대해 계산한다. CRC-16/CCITT-FALSE(poly `0x1021`, init `0xFFFF`, 반사 없음, xorout `0x0000`)로 계산하면 `0xC101`이 나오고, 이를 빅 엔디언으로 `C1 01`로 붙였다.

이 프레임을 `feed()`에 넣으면 payload `01 2A 00`이 나와야 한다. 바이트 하나씩 넣어도 결과는 같아야 한다. 이것이 이 장에서 만들 파서의 목표다.

## 3.3 체크섬과 CRC

### 단순 합과 XOR

단순 합(sum mod 256)이나 XOR은 구현이 쉽지만 약하다. NMEA의 `*hh`는 `$`와 `*` 사이 문자들의 XOR이다. 한 바이트가 뒤집히면 잡을 수 있지만, 여러 바이트가 동시에 뒤집히거나 순서가 바뀌면 놓칠 수 있다.

### CRC

CRC(Cyclic Redundancy Check)는 연속된 비트 오류(burst error) 검출에 강하다. 프레임에는 CRC-16, 큰 데이터에는 CRC-32가 흔하다.

CRC는 **오류 검출**이지 인증이 아니다. 공격자는 CRC를 다시 계산할 수 있다. 보안이 필요하면 HMAC/서명을 별도로 쓴다. "CRC가 맞으니 신뢰할 수 있는 명령"이라고 판단하면 안 된다.

### CRC는 이름만 보고 구현하면 틀리기 쉽다

파라미터(poly, init, refin/refout, xorout)를 표로 확인하고, 표준 테스트 벡터 `"123456789"`로 검증한다.

| 이름 | poly | init | refin/refout | xorout | 검증값 | 용도 |
|---|---|---|---|---|---|---|
| CRC-16/CCITT-FALSE | 0x1021 | 0xFFFF | false/false | 0x0000 | 0x29B1 | 커스텀 프레임, 일반 통신 |
| CRC-16/MODBUS | 0x8005 | 0xFFFF | true/true | 0x0000 | 0x4B37 | Modbus RTU (반사 구현 0xA001) |
| CRC-32/ISO-HDLC | 0x04C11DB7 | 0xFFFFFFFF | true/true | 0xFFFFFFFF | 0xCBF43926 | zip, PNG, Ethernet |
| CRC-8/MAXIM | 0x31 | 0x00 | true/true | 0x00 | 0xA1 | 1-Wire |

- CRC 필드의 바이트 순서(빅/리틀)도 약속이다. 계산값을 그대로 넣는지, 바이트를 뒤집는지 확인한다.
- 계산 범위(SOF 포함/제외, LEN 포함/제외, CRC 제외)를 문서화한다. 범위가 하나만 달라도 전부 불일치가 난다.
- Python에서는 `binascii.crc_hqx(data, 0xFFFF)`가 CRC-16/CCITT-FALSE다. 직접 루프를 돌리기 전에 표준 라이브러리를 먼저 찾는다.

## 3.4 엔디언과 필드 해석

- 정수는 바이트 순서가 있다. `int.from_bytes(b, "big")`, `struct.unpack(">H", b)`처럼 **항상 명시**한다. 플랫폼 기본값에 기대지 않는다.
- 부호 있는 정수는 보통 2의 보수다. `int.from_bytes(b, "big", signed=True)`.
- 소수는 정수 스케일로 오는 경우가 많다. 예: raw 253 → 25.3°C (×0.1). 계산은 정수로 하고 표시할 때만 나눈다.
- 비트 필드는 바이트 안의 비트 번호와 바이트 순서를 함께 봐야 한다. UART는 LSB부터 전송하지만, 프로토콜 문서의 비트 필드는 MSB를 0번으로 세는 경우가 많다. CAN DBC의 Intel/Motorola 표기도 서로 다르다.
- 예약 비트는 0이라고 가정하지 말고, 읽을 때 마스크하고 쓸 때 보존한다.
- 가변 길이 필드는 TLV(type-length-value)나 길이 접두로 명시한다. "지금까지 읽은 길이"로 암묵적으로 정하면 버전업에서 깨진다.

### 바이트 덤프를 읽는 순서

로그에 `01 03 00 00 00 02 C4 0B`가 찍혔다고 하자. 이것이 Modbus RTU 요청이라는 것을 안다면 다음과 같이 읽는다.

```text
01        슬레이브 주소
03        함수 코드(홀딩 레지스터 읽기)
00 00     시작 주소
00 02     레지스터 개수
C4 0B     CRC-16/MODBUS (리틀엔디언으로 전송)
```

여기서 중요한 것은 **필드의 경계와 순서를 먼저 정하고, 그다음 값을 해석한다**는 것이다. 바이트를 하나씩 보며 "이게 주소인가 데이터인가"를 추측하면 반드시 틀린다. 10장에서 Modbus를 더 자세히 다룬다.

OBD-II CAN 프레임도 같은 방식으로 읽는다. 다음은 엔진 회전수 응답을 헤더까지 포함해 캡처한 예다.

```text
7E8  04 41 0C 1A F8 CC CC CC
│    │  │  │  └──┴─ 데이터: 0x1AF8 = 6904 → 6904/4 = 1726 rpm
│    │  │  └────── PID 0C (엔진 회전수)
│    │  └───────── 응답 서비스 0x41 (요청 0x01 + 0x40)
│    └──────────── PCI: Single Frame, 데이터 4바이트
└───────────────── CAN ID: ECU 응답 주소(7E0 + 8)
```

- `04`는 ISO-TP Single Frame의 PCI다. "데이터가 4바이트"라는 뜻이다.
- `41`은 Mode 01 요청에 대한 긍정 응답이다. 요청 서비스 `01`에 `0x40`을 더한 값이다.
- `0C`는 PID, `1A F8`은 빅 엔디언 16비트 값이다.
- 뒤의 `CC`는 패딩이다. 길이 필드가 4이므로 `CC CC CC`는 데이터가 아니다.

**PCI를 데이터로 착각하면 `04`를 첫 번째 데이터 바이트로 읽는다.** 헤더를 켠 원시 로그에서는 PCI와 애플리케이션 데이터를 반드시 구분한다.

## 3.5 ELM327 응답의 경계

ELM327은 바이트 스트림 위에 아주 단순한 프레이밍을 얹는다.

- 명령은 `\r`(CR)로 끝난다.
- 응답의 각 줄도 `\r`로 끝난다.
- 모든 응답의 마지막에 프롬프트 `>`가 온다.
- 에코가 켜져 있으면 내가 보낸 명령도 그대로 돌아온다.
- 긴 응답은 여러 줄로 나뉜다.

```text
PC → "010C\r"
ELM → "010C\r"          ← 에코(ATE0로 끌 수 있다)
ELM → "41 0C 1A F8\r"
ELM → "\r"
ELM → ">"
```

바이트로 보면 다음과 같다. `ATL0`(줄바꿈 끔) 이후의 예시다.

```text
30 31 30 43 0D 34 31 20 30 43 20 31 41 20 46 38 0D 0D 3E
0  1  0  C  \r 4  1     0  C     1  A     F  8  \r \r >
```

`ATL0`을 보내지 않았다면 각 `0D` 뒤에 `0A`(LF)가 더 붙는다. 파서는 `\r`, `\n`, `\r\n`을 모두 줄 끝으로 처리하는 편이 안전하다.

여기서 `readline()`을 쓰면 문제가 생긴다. pyserial의 `readline()`은 `\n`(LF)을 찾는데, ELM327은 `\r`만 보낸다. 타임아웃이 될 때까지 읽다가 여러 줄을 한꺼번에 돌려주거나, 반대로 줄이 잘린다. **프롬프트 `>`를 만날 때까지 읽는** 파서가 맞다.

### 줄 프레이머

다음 코드는 바이트를 조금씩 넣어도 줄과 프롬프트를 정확히 나눈다.

```python
from dataclasses import dataclass, field


@dataclass
class ElmFramer:
    buf: bytearray = field(default_factory=bytearray)
    lines: list[str] = field(default_factory=list)
    _ready: bool = False

    def feed(self, data: bytes) -> tuple[list[str], bool]:
        """바이트를 넣고 (완성된 줄 목록, 프롬프트 도착 여부)를 돌려준다."""
        self.buf.extend(data)
        while True:
            cr = self.buf.find(b"\r")
            gt = self.buf.find(b">")
            if cr < 0 and gt < 0:
                break
            if gt >= 0 and (cr < 0 or gt < cr):
                text = bytes(self.buf[:gt]).strip()
                if text:
                    self.lines.append(text.decode("ascii", errors="replace"))
                del self.buf[:gt + 1]
                self._ready = True
            else:
                text = bytes(self.buf[:cr]).strip()
                if text:
                    self.lines.append(text.decode("ascii", errors="replace"))
                del self.buf[:cr + 1]
        out, self.lines = self.lines, []
        ready, self._ready = self._ready, False
        return out, ready
```

- `\r`과 `>`가 같은 버퍼에 들어와도 순서대로 처리한다.
- 프롬프트 뒤에 남는 바이트는 다음 응답으로 넘어간다.
- 에코는 `line == cmd`로 걸러 낸다. `ATZ`처럼 응답이 여러 줄인 명령은 에코만 걸러 내고 나머지는 남긴다.
- `SEARCHING...`, `NO DATA`, `?`, `STOPPED`, `BUFFER FULL`은 **줄 자체가 상태 메시지**다. 파서가 이 문자열을 값으로 해석하지 않도록 먼저 분류한다.

### 동작 확인

```python
stream = b"010C\r41 0C 1A F8\r\r>"
p = ElmFramer()
out = []
for byte in stream:
    lines, ready = p.feed(bytes([byte]))
    out.extend(lines)
    if ready:
        break
assert [line for line in out if line != "010C"] == ["41 0C 1A F8"]
```

한 바이트씩 넣어도, 한 번에 넣어도 결과가 같아야 한다. 3.10절의 분할 테스트를 ELM327 로그에도 그대로 적용한다.

### ELM327이 다중 프레임을 보여 주는 방식

ELM327은 기본 설정(CAF1)에서 ISO-TP를 자동으로 조립해 준다. VIN 요청 `0902`의 응답은 이런 모양이다.

```text
014
0: 49 02 01 54 45 53
1: 54 56 49 4E 30 30 30
2: 30 30 30 30 30 30 30
```

- `014`는 전체 데이터 길이를 16진수로 쓴 것이다(0x14 = 20바이트).
- `0:`, `1:`, `2:`는 ELM327이 붙인 세그먼트 번호다. **CAN의 PCI 바이트가 아니다.**
- 각 줄의 데이터를 순서대로 이어 붙이면 `49 02 01` + 17바이트 VIN이 된다.
- 헤더를 켜면(`ATH1`) `7E8 10 14 49 02 01 ...`처럼 CAN ID와 실제 PCI가 보인다. 이때는 ELM327이 조립하기 전의 원시 프레임을 보는 것이다.

두 표현을 섞으면 파서가 망가진다. "ELM327이 조립해 준 줄"을 파싱할 때는 `0:` 접두와 총 길이를 처리하고, "원시 CAN 프레임"을 파싱할 때는 ISO-TP PCI를 직접 처리한다. 어느 쪽인지 먼저 정한다.

## 3.6 ISO-TP: CAN 위의 작은 전송 계층

클래식 CAN 한 프레임은 데이터가 8바이트까지다. OBD-II 응답 중 VIN, Calibration ID, 긴 DTC 목록은 8바이트를 넘는다. 이때 ISO 15765-2(ISO-TP)가 메시지를 나눠 보내고 받는 쪽이 다시 조립한다.

| 프레임 | PCI 상위 니블 | 내용 |
|---|---|---|
| SF(Single Frame) | `0` | 1바이트 PCI. 하위 니블이 데이터 길이(1~7) |
| FF(First Frame) | `1` | 2바이트 PCI. 하위 12비트가 전체 길이(최대 4095) |
| CF(Consecutive Frame) | `2` | 1바이트 PCI. 하위 니블이 시퀀스 번호(1~F 순환) |
| FC(Flow Control) | `3` | 3바이트 PCI. 상태(CTS/WAIT/OVERFLOW), block size, STmin |

### 바이트로 보기

VIN 17자를 응답한다고 하자. 전체 애플리케이션 데이터는 `49 02 01` + 17바이트 = 20바이트다. 20은 `0x014`이므로 FF의 길이 필드는 `014`다.

```text
7E8  10 14 49 02 01 54 45 53     ← FF: 전체 0x014바이트, 첫 6바이트
7E8  21 54 56 49 4E 30 30 30     ← CF 1: 시퀀스 1, 다음 7바이트
7E8  22 30 30 30 30 30 30 30     ← CF 2: 시퀀스 2, 다음 7바이트
```

- FF의 데이터는 `10 14` 뒤의 6바이트다.
- CF의 데이터는 `21`/`22` 뒤의 7바이트다.
- 시퀀스는 1부터 시작해 `F` 다음에 `0`으로 돌아간다.
- 마지막 CF는 전체 길이에 맞춰 자른다. 남는 바이트는 패딩이며, OBD-II에서는 `0xCC`를 권장한다.
- 수신 측은 FF를 받으면 FC를 보내 "계속 보내라(CTS)"고 알린다. ELM327은 이 FC를 자동으로 보내 준다. 원시 CAN을 직접 다룰 때는 애플리케이션이 FC를 보내야 한다.

### 조립 코드

```python
class IsoTpAssembler:
    def __init__(self) -> None:
        self._buf = bytearray()
        self._need = 0
        self._next_seq = 1
        self._active_id: int | None = None

    def reset(self) -> None:
        self._buf.clear()
        self._need = 0
        self._next_seq = 1
        self._active_id = None

    def feed(self, can_id: int, data: bytes) -> bytes | None:
        """CAN 프레임 하나를 넣고, 완성된 메시지가 있으면 돌려준다."""
        if not data:
            return None
        pci = data[0] >> 4

        if pci == 0:  # Single Frame
            length = data[0] & 0x0F
            if length == 0 or length > len(data) - 1:
                return None
            return bytes(data[1:1 + length])

        if pci == 1:  # First Frame
            if len(data) < 2:
                return None
            length = ((data[0] & 0x0F) << 8) | data[1]
            if length == 0:
                return None
            self._active_id = can_id
            self._buf = bytearray(data[2:])
            self._need = length
            self._next_seq = 1
            if len(self._buf) >= self._need:
                payload = bytes(self._buf[:self._need])
                self.reset()
                return payload
            return None

        if pci == 2:  # Consecutive Frame
            if self._active_id != can_id or self._need == 0:
                return None
            seq = data[0] & 0x0F
            if seq != self._next_seq:
                self.reset()          # 순서가 어긋나면 조립을 포기한다
                return None
            self._buf.extend(data[1:])
            self._next_seq = (self._next_seq + 1) & 0x0F
            if len(self._buf) >= self._need:
                payload = bytes(self._buf[:self._need])
                self.reset()
                return payload
            return None

        return None  # Flow Control 등은 여기서 처리하지 않는다


def flow_control(block_size: int = 0, stmin: int = 0) -> bytes:
    """수신 측이 보내는 FC 프레임. block_size=0은 끝까지, stmin=0은 지연 없음."""
    return bytes([0x30, block_size, stmin, 0, 0, 0, 0, 0])
```

### 동작 확인

```python
frames = [
    (0x7E8, bytes.fromhex("10 14 49 02 01 54 45 53")),
    (0x7E8, bytes.fromhex("21 54 56 49 4E 30 30 30")),
    (0x7E8, bytes.fromhex("22 30 30 30 30 30 30 30")),
]

a = IsoTpAssembler()
out = []
for can_id, data in frames:
    msg = a.feed(can_id, data)
    if msg is not None:
        out.append(msg)

assert out == [b"\x49\x02\x01TESTVIN0000000000"]
```

- 테스트의 VIN은 `TESTVIN0000000000`(17자)이다. 실제 VIN을 코드·로그·책에 남기지 않는다.
- FF와 CF의 CAN ID가 다르면 조립하지 않는다. 같은 버스에 여러 ECU가 응답할 때 다른 ECU의 CF가 섞이는 것을 막는다.
- 시퀀스가 어긋나면 조립을 포기하고 다음 FF를 기다린다. 부분 데이터를 억지로 붙이지 않는다.
- FC를 보내야 하는 상황에서 FC를 보내지 않으면 상대는 첫 FF 뒤에 멈춘다. "응답이 첫 줄만 온다"는 증상의 원인 중 하나다.

### STmin과 block size

FC의 세 번째 바이트 STmin은 CF 사이의 최소 간격이다. `0x00`~`0x7F`는 밀리초, `0xF1`~`0xF9`는 100~900마이크로초를 뜻한다. block size는 "CF를 몇 개 보낸 뒤 다시 FC를 기다릴지"다. `0`이면 끝까지 보낸다.

이 값이 맞지 않으면 "응답이 일부만 온다", "타임아웃", "BUFFER FULL" 같은 증상이 난다. ELM327은 대부분 자동으로 처리하지만, 원시 CAN 도구로 직접 요청할 때는 FC를 명시해야 한다.

```python
import can

bus = can.Bus(interface="socketcan", channel="can0")
bus.send(can.Message(
    arbitration_id=0x7E0,          # 테스터 → ECU
    is_extended_id=False,
    data=flow_control(block_size=0, stmin=0),
))
```

### 흐름 제어를 직접 다루기

지금까지는 ELM327이 FC를 자동으로 보내 주는 경우를 다뤘다. 원시 CAN으로 ECU 응답을 받을 때는 **받는 쪽이 FC를 보내고, 보내는 쪽이 그 FC를 지켜야** 한다. 두 역할을 구분하자.

```text
ECU(7E8) ── FF ──────────────▶ 테스터
ECU(7E8) ◀────────── FC ───── 테스터(7E0)   ← "계속 보내라, BS/STmin은 이렇게"
ECU(7E8) ── CF1 ────────────▶ 테스터
ECU(7E8) ── CF2 ────────────▶ 테스터
```

- FC는 **데이터 방향이 반대**다. ECU가 7E8로 응답하면 테스터는 7E0으로 FC를 보낸다. 요청/응답 주소 쌍을 바꿔 끼우면 안 된다.
- FC의 첫 바이트는 `0x30 | FS`다. FS는 0(CTS, 계속 보내라), 1(WAIT, 잠시 기다려라), 2(OVERFLOW, 그만 보내라)다.
- 두 번째 바이트는 **block size(BS)**다. CF를 몇 개 받은 뒤 다시 FC를 보낼지 정한다. `0`이면 나머지를 FC 없이 끝까지 받는다.
- 세 번째 바이트는 **STmin**이다. CF 사이의 최소 간격이다. `0x00`~`0x7F`는 밀리초, `0xF1`~`0xF9`는 100~900마이크로초를 뜻한다.
- 나머지 바이트는 패딩이다. OBD-II에서는 `0xCC`를 권장한다.

```python
def fc_frame(fs: int = 0, block_size: int = 0, stmin: int = 0) -> bytes:
    """수신 측이 보내는 흐름 제어 프레임 8바이트."""
    if fs not in (0, 1, 2):
        raise ValueError("FS는 0(CTS), 1(WAIT), 2(OVERFLOW)다")
    if not 0 <= block_size <= 0xFF:
        raise ValueError("block size는 1바이트다")
    return bytes([0x30 | fs, block_size, stmin, 0xCC, 0xCC, 0xCC, 0xCC, 0xCC])


def stmin_seconds(stmin: int) -> float:
    """STmin 바이트를 초로 바꾼다."""
    if 0x00 <= stmin <= 0x7F:
        return stmin / 1000.0
    if 0xF1 <= stmin <= 0xF9:
        return (stmin - 0xF0) / 10000.0
    raise ValueError(f"예약된 STmin 값이다: 0x{stmin:02X}")
```

### FC를 보내며 조립하는 수신기

아래 클래스는 FF를 받으면 CTS FC를 보내고, BS만큼 CF를 받을 때마다 다시 FC를 보낸다. CF 사이의 간격이 타임아웃을 넘으면 조립을 포기한다.

```python
import time
import can


class IsoTpReceiver:
    """ECU 응답(예: 7E8)을 받아 FC를 보내고 메시지를 조립한다."""

    def __init__(
        self,
        bus: can.BusABC,
        tx_id: int,
        rx_id: int,
        block_size: int = 0,
        stmin: int = 0,
        timeout: float = 1.0,
    ) -> None:
        self.bus = bus
        self.tx_id = tx_id          # 테스터 → ECU (예: 0x7E0)
        self.rx_id = rx_id          # ECU → 테스터 (예: 0x7E8)
        self.block_size = block_size
        self.stmin = stmin
        self.timeout = timeout
        self._buf: bytearray | None = None
        self._need = 0
        self._next_seq = 1
        self._since_fc = 0
        self._deadline = 0.0

    def reset(self) -> None:
        self._buf = None
        self._need = 0
        self._next_seq = 1
        self._since_fc = 0
        self._deadline = 0.0

    def _send_fc(self, fs: int = 0) -> None:
        self.bus.send(can.Message(
            arbitration_id=self.tx_id,
            is_extended_id=False,
            data=fc_frame(fs, self.block_size, self.stmin),
        ))

    def _finish(self) -> bytes | None:
        if self._buf is None or len(self._buf) < self._need:
            return None
        payload = bytes(self._buf[:self._need])
        self.reset()
        return payload

    def feed(self, msg: can.Message, now: float | None = None) -> bytes | None:
        now = time.monotonic() if now is None else now
        if msg.arbitration_id != self.rx_id:
            return None
        data = bytes(msg.data)
        if not data:
            return None
        pci = data[0] >> 4

        if pci == 0:  # Single Frame
            length = data[0] & 0x0F
            if length == 0 or length > len(data) - 1:
                return None
            return bytes(data[1:1 + length])

        if pci == 1:  # First Frame
            if len(data) < 2:
                return None
            total = ((data[0] & 0x0F) << 8) | data[1]
            if total < 8:
                return None
            self._buf = bytearray(data[2:])
            self._need = total
            self._next_seq = 1
            self._since_fc = 0
            self._deadline = now + self.timeout
            self._send_fc(0)        # CTS: 계속 보내라
            return self._finish()

        if pci == 2:  # Consecutive Frame
            if self._buf is None or self._need == 0:
                return None
            if now > self._deadline:
                self.reset()        # N_Cr 타임아웃: 부분 데이터를 버린다
                return None
            seq = data[0] & 0x0F
            if seq != self._next_seq:
                self.reset()        # 순서가 어긋나면 조립을 포기한다
                return None
            self._buf.extend(data[1:])
            self._next_seq = (self._next_seq + 1) & 0x0F
            self._since_fc += 1
            self._deadline = now + self.timeout
            if self.block_size and self._since_fc >= self.block_size:
                self._since_fc = 0
                self._send_fc(0)    # BS만큼 받았으니 다음 블록을 허가한다
            return self._finish()

        return None                 # FC 등은 수신기가 처리할 대상이 아니다
```

사용 예:

```python
bus = can.Bus(interface="socketcan", channel="can0")
rx = IsoTpReceiver(bus, tx_id=0x7E0, rx_id=0x7E8, block_size=8, stmin=0)

bus.send(can.Message(
    arbitration_id=0x7DF,
    is_extended_id=False,
    data=bytes([0x02, 0x09, 0x02, 0xCC, 0xCC, 0xCC, 0xCC, 0xCC]),
))

deadline = time.monotonic() + 2.0
while time.monotonic() < deadline:
    msg = bus.recv(timeout=0.1)
    if msg is None:
        continue
    payload = rx.feed(msg)
    if payload is not None:
        print(payload.hex(" "))
        break
```

- 위 요청은 `09 02`(VIN)다. 응답은 FF/CF로 오고, `rx.feed()`가 완성된 `49 02 01 ...`을 돌려준다.
- 실제 VIN은 출력·저장하지 않는다. 테스트에는 가짜 VIN을 쓴다.
- `block_size=8`은 예시다. ECU가 받아들일 수 있는 값과 애플리케이션 버퍼 크기를 보고 정한다. 확신이 없으면 `0`(끝까지)으로 시작하고, 버퍼가 작으면 블록을 나눈다.
- `stmin=0`은 지연 없음이다. 수신 측이 CF를 따라가지 못하면 `0x0A`(10ms)처럼 올린다.
- `feed()`는 FF마다 새 조립을 시작한다. 같은 버스에 여러 ECU가 있으면 `rx_id`별로 수신기를 따로 만든다.

### 보내는 쪽: FC를 기다리고 BS·STmin을 지킨다

테스터가 긴 요청(예: 여러 DID를 한 번에 쓰는 요청)을 보낼 때는 반대 역할이 된다. FF를 보낸 뒤 ECU가 보내는 FC를 기다리고, FS가 CTS면 CF를 보낸다.

```python
def wait_for_fc(bus: can.BusABC, fc_id: int, timeout: float = 1.0) -> tuple[int, int, int]:
    """ECU가 보내는 FC를 기다려 (FS, block_size, STmin)을 돌려준다."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        msg = bus.recv(timeout=max(0.0, deadline - time.monotonic()))
        if msg is None or msg.arbitration_id != fc_id:
            continue
        data = bytes(msg.data)
        if len(data) < 3 or (data[0] >> 4) != 3:
            continue
        return data[0] & 0x0F, data[1], data[2]
    raise TimeoutError("FC를 받지 못했다")
```

- `FS=0(CTS)`이면 `block_size`만큼 CF를 보내고, 다시 FC를 기다린다.
- `FS=1(WAIT)`이면 보내지 말고 다시 FC를 기다린다. WAIT가 무한히 반복되지 않도록 애플리케이션에서 상한을 정한다.
- `FS=2(OVERFLOW)`이면 전송을 중단하고 부분 데이터를 버린다.
- CF 사이에는 `stmin_seconds(stmin)`만큼 기다린다. `time.sleep()`은 짧은 지연에 부정확할 수 있으므로, 정밀한 타이밍이 필요하면 `time.monotonic()`으로 목표 시각을 계산한다.
- BS/STmin을 무시하면 ECU가 CF를 버리거나 `BUFFER FULL`·타임아웃이 난다. **FC를 보냈다고 전송이 끝난 것이 아니라, FC의 값이 다음 전송의 규칙이다.**

### 타임아웃은 어느 쪽이 기다리는가

ISO-TP에는 역할별 타이머가 있다. 이름만 알아도 로그를 읽을 때 도움이 된다.

| 타이머 | 기다리는 쪽 | 기다리는 대상 | 만료 시 |
|---|---|---|---|
| N_Bs | 보내는 쪽 | FF/블록 뒤의 FC | 전송 중단, 재시도 여부는 구현이 결정 |
| N_Cr | 받는 쪽 | 다음 CF | 조립 포기, 다음 FF를 기다림 |
| N_As | 보내는 쪽 | CAN 프레임 전송 확인 | 드라이버·하드웨어 오류로 처리 |
| N_Ar | 받는 쪽 | CAN 프레임 전송 확인 | 드라이버·하드웨어 오류로 처리 |

구체적인 값은 ISO 15765-2와 차량·도구 구현에 따라 다르다. 이 책에서는 값을 단정하지 않고, **설정값을 코드에 상수로 숨기지 말고 로그에 남긴다**는 원칙만 가져간다. 타임아웃이 나면 "응답이 없다"가 아니라 "어느 타이머가, 얼마를 기다리다, 어떤 프레임을 못 받았는가"를 기록한다.

## 3.7 상태 기계 파서

프레임을 한 번에 받는다고 가정하지 말고, **바이트 하나를 넣을 때마다 상태가 진행되는 파서**를 만든다. 그래야 부분 수신·노이즈·재동기화를 모두 같은 코드로 처리할 수 있다.

### 상태 전이

```text
WAIT_SOF → WAIT_LEN → WAIT_PAYLOAD(n) → WAIT_CRC(2) → COMPLETE
     ↑         |            |              |
     └─────────┴────────────┴──────────────┘  오류/타임아웃 시 재동기화
```

아래는 `A5 | LEN | PAYLOAD | CRC16(2, big-endian)` 프레임의 파서다. CRC는 `LEN`과 `PAYLOAD` 전체에 대해 계산한다. 표준 라이브러리만 쓰므로 `uv init` 후 `uv run python parser.py`로 실행한다.

```python
import binascii

SOF = 0xA5
MAX_PAYLOAD = 64


def crc16(data: bytes) -> int:
    # CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, 반사 없음, xorout 0
    return binascii.crc_hqx(data, 0xFFFF)


class FrameParser:
    def __init__(self) -> None:
        self._buf = bytearray()
        self._frame_len: int | None = None

    def reset(self) -> None:
        self._buf.clear()
        self._frame_len = None

    def feed(self, data: bytes) -> list[bytes]:
        self._buf.extend(data)
        out: list[bytes] = []
        while True:
            if self._frame_len is None:
                i = self._buf.find(SOF)
                if i < 0:
                    self._buf.clear()      # SOF가 없으면 프레임도 없다
                    return out
                if i:
                    del self._buf[:i]      # 앞의 쓰레기 버리기
                if len(self._buf) < 2:
                    return out
                payload_len = self._buf[1]
                if payload_len > MAX_PAYLOAD:
                    del self._buf[0]       # 가짜 SOF로 보고 한 바이트 재탐색
                    continue
                self._frame_len = 2 + payload_len + 2
            if len(self._buf) < self._frame_len:
                return out
            frame = bytes(self._buf[:self._frame_len])
            body = frame[1:-2]
            expected = int.from_bytes(frame[-2:], "big")  # CRC는 LEN+PAYLOAD
            if crc16(body) != expected:
                del self._buf[0]           # CRC 불일치 → 다음 바이트부터 재동기화
                self._frame_len = None
                continue
            out.append(frame[2:-2])
            del self._buf[:self._frame_len]
            self._frame_len = None

    # 부분 프레임이 너무 오래 머물면 호출한다.
    def expire(self, now: float, last_rx: float, timeout: float) -> None:
        if self._buf and now - last_rx > timeout:
            self.reset()
```

### 코드에서 눈여겨볼 점

- **CRC 실패 시 프레임 전체를 버리지 않고 한 바이트만 밀고 다시 SOF를 찾는다.** 진짜 프레임이 깨진 경우와 가짜 SOF를 만난 경우를 모두 처리하기 위해서다.
- `MAX_PAYLOAD` 검증이 없으면 가짜 길이 필드 하나로 수백 바이트를 기다리게 된다.
- `expire()`는 선택이지만, 부분 프레임이 영원히 남아 다음 프레임의 시작을 막는 것을 막아 준다.
- `expire()`로 무한 대기를 막고, 2바이트 매직/헤더 CRC로 가짜 SOF 확률을 줄인다. `expire()`는 가짜 SOF 뒤에 버퍼에 남아 있던 유효 프레임까지 버릴 수 있다는 점을 기억하자.
- 실제 코드에서는 `feed()`가 많은 바이트를 받을 때 `del self._buf[:n]`을 반복하지 말고 인덱스로 읽은 뒤 한 번만 압축한다. 프레임이 작으면 위 코드로 충분하다.

### 동작 확인

```python
frame = bytes.fromhex("A5 03 01 2A 00 C1 01")

p = FrameParser()
assert p.feed(frame) == [b"\x01\x2A\x00"]

p = FrameParser()
out = []
for byte in frame:
    out.extend(p.feed(bytes([byte])))
assert out == [b"\x01\x2A\x00"]
```

이 두 줄이 이 장의 핵심 성질이다. **한 번에 넣은 결과와 한 바이트씩 넣은 결과가 같아야 한다.** 이 성질이 깨지면 대부분 "부분 수신을 가정하지 않은" 버그다.

### 재동기화 확인

CRC를 일부러 틀리게 바꾼 프레임(`... C1 02`)을 넣으면 파서는 그 프레임을 버리고, 이어서 정상 프레임을 넣었을 때 다시 찾아야 한다.

```python
bad = bytes.fromhex("A5 03 01 2A 00 C1 02")
good = bytes.fromhex("A5 03 01 2A 00 C1 01")

p = FrameParser()
assert p.feed(bad) == []
assert p.feed(good) == [b"\x01\x2A\x00"]
```

`bad`의 CRC가 틀리면 파서는 `A5`를 버리고 다음 바이트부터 `SOF`를 다시 찾는다. `good`이 들어오면 정상적으로 프레임을 완성한다.

## 3.8 부분 수신과 버퍼

- `read(n)`은 n바이트를 "최대" 돌려준다. 타임아웃이 있으면 그 전에 받은 것만 돌려준다. `read(n)`의 반환 길이를 항상 확인한다.
- `readline()`은 개행이 올 때까지 기다린다. 바이너리에서는 개행이 우연히 payload에 들어갈 수 있으므로 쓰지 않는다.
- `in_waiting`은 드라이버가 현재 들고 있는 바이트 수다. 이 값이 0이라고 해서 곧 데이터가 안 온다는 뜻은 아니다.
- `write()`가 끝났다고 상대가 받은 것이 아니다. pyserial의 `flush()`는 쓰기 버퍼의 전송 완료를 기다리는 것이지 데이터를 버리는 함수가 아니다. USB-UART 내부 버퍼와 상대 처리 시간은 별도다.
- 수신 버퍼는 **링 버퍼**로 두는 것이 표준이다. 생산자(ISR/수신 스레드)는 head를, 소비자(메인 루프)는 tail을 움직이고, 가득 차면 오래된 것을 버릴지 새 것을 버릴지 정책을 정한다. 11장에서 구현을 다룬다.
- Python에서 `bytes += chunk`를 반복하면 O(n²)이 된다. `bytearray.extend()`를 쓰고, 앞에서부터 소비할 때는 인덱스를 유지하다가 가끔 한 번에 압축한다.
- 로그에는 파싱된 값만이 아니라 **원시 hex와 단조 시각(monotonic)**을 남긴다. `time.time()`은 시계 보정으로 점프할 수 있다.

## 3.9 타임아웃, 재전송, 멱등성

- 타임아웃은 "상대의 최악 처리 시간 + 전송 시간 + 여유"다. 고정 1초를 쓰면 느린 장치에서 정상 응답을 버리고, 빠른 장치에서는 고장을 늦게 발견한다.
- 응답이 없을 때 재전송하려면 **중복을 걸러 낼 수단**이 필요하다. 시퀀스 번호, 트랜잭션 ID, 또는 멱등 명령만 허용하는 규칙이다.
- 타임아웃 후 늦게 도착한 응답을 다음 요청의 응답으로 오인하는 것이 흔한 버그다. 요청 ID를 응답에 포함시켜 매칭한다.
- 재시도는 지수 백오프와 최대 횟수를 둔다. 연속 실패가 임계치를 넘으면 링크를 리셋하거나 안전 상태로 간다.
- "설정 추가" 같은 명령은 재전송 시 두 번 적용될 수 있다. "절대값 설정"으로 설계하면 멱등해진다.
- 시각은 `time.monotonic()`으로 잰다. 벽시계는 NTP/사용자 변경으로 뒤로 갈 수 있다.

OBD-II에서는 `7F <SID> 78`(responsePending)이 "실패"가 아니라 "잠시 기다려"라는 응답이다. 이 응답을 받으면 타임아웃을 연장하고 진짜 응답을 기다린다. `78`을 받자마자 같은 요청을 다시 보내면 ECU가 더 바빠진다. 반대로 `7F <SID> 31`(requestOutOfRange)은 "그 DID/PID가 없다"는 뜻이므로 재시도해도 결과가 같다. **NRC별로 재시도 정책을 나눈다.**

읽기 요청은 재시도해도 되지만, 쓰기·루틴 요청은 "응답을 못 받았다"와 "실행됐는데 응답을 못 받았다"를 구분할 수 없다. 그래서 쓰기에는 멱등성 키나 상태 확인 절차가 필요하다. 이 책은 쓰기 자체를 하지 않는다. 9장에서 이 주제를 안전 관점에서 다시 다룬다.

### 멱등성 설계 예

```text
나쁜 명령:  "토출량 10 mL 추가"     ← 재전송하면 20 mL가 된다
좋은 명령:  "토출량을 10 mL로 설정"  ← 두 번 실행해도 10 mL다
```

모든 명령을 절대값으로 바꿀 수는 없다. 그럴 때는 요청에 시퀀스 번호를 붙이고, 상대가 마지막으로 처리한 번호를 기억해 중복을 버린다.

## 3.10 파서 테스트

파서는 웹의 JSON 파서보다 입력이 훨씬 지저분하다. 다음을 자동 테스트로 만든다.

- 완성 프레임 하나를 넣으면 정확히 하나가 나온다.
- 같은 프레임을 **1바이트씩** 넣어도 결과가 같다.
- 모든 분할 지점(1..n-1)에서 나눠 넣어도 결과가 같다.
- 프레임 두 개를 붙여 넣으면 두 개가 나온다.
- 앞뒤에 쓰레기 바이트를 붙여도 정상 프레임을 찾는다. 단, 쓰레기 안에 `SOF`와 그럴듯한 `LEN`이 있으면 파서가 그 길이만큼 기다릴 수 있으므로, 뒤에 충분한 바이트가 오는 경우까지 시험한다.
- CRC를 한 비트 뒤집으면 버리고, 다음 정상 프레임을 찾는다.
- 길이 필드를 최대값으로 조작해도 버퍼가 무한히 커지지 않는다.
- 랜덤 바이트(fuzz)를 넣어도 예외·무한 루프·메모리 폭증이 없다.
- 실제 캡처한 원시 로그를 골든 테스트로 둔다.

속성 테스트 한 줄로 요약하면 `parse(full) == parse(byte_by_byte)`다. 이 성질이 깨지면 대부분 "부분 수신을 가정하지 않은" 버그다.

### 분할 테스트 예

```python
frame = bytes.fromhex("A5 03 01 2A 00 C1 01")
expected = [b"\x01\x2A\x00"]

for split in range(1, len(frame)):
    p = FrameParser()
    out = p.feed(frame[:split])
    out.extend(p.feed(frame[split:]))
    assert out == expected, f"split={split}"
```

이 테스트는 "어느 지점에서 잘려도 파서가 견딘다"를 증명한다. 시리얼에서는 어느 지점에서 잘릴지 예측할 수 없으므로, 모든 분할 지점을 시험하는 것이 가장 확실하다.

### ELM327 로그 테스트

ELM327 로그에는 값이 아닌 줄이 섞인다. 다음을 테스트에 넣는다.

- `SEARCHING...`이 첫 줄에 와도 값 파싱이 실패하지 않는다.
- `NO DATA`, `?`, `STOPPED`, `BUFFER FULL`을 오류 상태로 분류한다.
- 에코(`010C`)가 섞여도 응답만 고른다.
- 프롬프트 `>`가 여러 줄 뒤에 와도 한 응답으로 묶는다.
- 응답이 한 바이트씩 쪼개져도 같은 결과가 나온다.
- `ATZ` 직후의 버전 줄과 `OK`를 OBD 응답으로 오해하지 않는다.

### ISO-TP 테스트

```python
def test_isotp_byte_by_byte():
    frames = [
        (0x7E8, bytes.fromhex("10 14 49 02 01 54 45 53")),
        (0x7E8, bytes.fromhex("21 54 56 49 4E 30 30 30")),
        (0x7E8, bytes.fromhex("22 30 30 30 30 30 30 30")),
    ]
    a = IsoTpAssembler()
    out = []
    for can_id, data in frames:
        msg = a.feed(can_id, data)
        if msg:
            out.append(msg)
    assert out == [b"\x49\x02\x01TESTVIN0000000000"]
```

CAN 프레임은 하드웨어가 8바이트 경계를 만들어 주므로, 보통은 프레임 단위로 넣으면 된다. 하지만 시리얼로 원시 프레임을 받아 파싱하는 도구라면 프레임 내용이 쪼개질 수 있다. 그때는 3.5절의 `ElmFramer`처럼 바이트 단위 상태 기계를 한 겹 더 둔다. **"CAN은 프레임 경계가 있다"와 "내가 그 경계를 보존해서 읽는다"는 다른 얘기다.**

ISO-TP에서 추가로 시험할 것:

- FF의 길이보다 CF가 적을 때 조립하지 않는다.
- CF 시퀀스가 건너뛰면 조립을 포기하고 다음 FF를 기다린다.
- 다른 CAN ID의 CF가 섞이면 조립하지 않는다.
- 길이가 0인 FF, 8바이트보다 큰 SF를 거부한다.
- 마지막 CF의 패딩(`0xCC`)이 payload에 들어가지 않는다.

## 3.11 체크리스트

- [ ] 프레임 경계 규칙이 문서화되어 있는가
- [ ] 최대 길이와 버퍼 상한이 있는가
- [ ] 체크섬 범위와 바이트 순서가 양쪽에서 같은가
- [ ] 엔디언·부호·스케일을 명시했는가
- [ ] 부분 수신과 분할 수신을 테스트했는가
- [ ] CRC 실패 후 재동기화가 되는가
- [ ] 부분 프레임 타임아웃이 있는가
- [ ] 재전송 시 중복 실행을 막는가
- [ ] 원시 hex 로그를 남기는가
- [ ] ELM327의 `\r`, 에코, 프롬프트 `>`를 처리하는가
- [ ] `SEARCHING...`, `NO DATA`, `?`, `STOPPED`, `BUFFER FULL`을 값과 구분하는가
- [ ] ISO-TP SF/FF/CF를 조립하고, FC가 필요한 상황을 아는가
- [ ] CF 시퀀스 오류·다른 CAN ID·길이 불일치에서 안전하게 포기하는가

## 흔한 실수

| 실수 | 결과 | 확인 |
|---|---|---|
| `read()` 한 번을 한 프레임으로 가정 | 프레임이 어긋나고 파서가 멈춤 | 부분 수신 테스트 |
| 최대 길이 검증 없음 | 가짜 LEN 하나로 버퍼가 무한히 커짐 | `MAX_PAYLOAD`, `expire()` |
| CRC 계산 범위 불일치 | 정상 프레임이 전부 실패 | LEN 포함 여부, 바이트 순서 문서화 |
| CRC를 보안으로 착각 | 위조 명령을 통과시킴 | HMAC/서명 별도 |
| 플랫폼 기본 엔디언 사용 | x86과 MCU에서 결과가 다름 | `int.from_bytes(..., "big")` |
| 비트 필드의 비트 번호 혼동 | 값이 절반 또는 두 배로 읽힘 | MSB/LSB 기준, DBC 표기 확인 |
| 예약 비트를 0으로 가정 | 상대가 보낸 값을 덮어씀 | 읽을 때 마스크, 쓸 때 보존 |
| CRC 실패 시 프레임 전체를 버림 | 뒤에 이어지는 정상 프레임까지 놓침 | 한 바이트 밀고 재탐색 |
| `readline()`으로 바이너리 읽기 | payload의 개행에서 끊김 | `read(n)` + 상태 기계 |
| 응답 ID를 매칭하지 않음 | 늦게 온 응답을 다음 요청의 응답으로 오인 | 요청/트랜잭션 ID |
| 재시도에 멱등성 없음 | 같은 명령이 두 번 실행 | 시퀀스 번호, 절대값 명령 |
| ELM327에 `readline()` 사용 | `\r`만 와서 타임아웃·줄 잘림 | 프롬프트 `>`까지 읽는 프레이머 |
| ELM327 조립 줄과 원시 PCI를 혼동 | `04`·`10`을 데이터로 읽음 | `ATH1`/`CAF` 설정을 먼저 확인 |
| ISO-TP FF/CF를 한 프레임으로 착각 | 긴 응답이 잘리거나 섞임 | PCI 타입·길이·시퀀스 검사 |
| CF 시퀀스 오류를 무시 | 다른 ECU 데이터가 섞임 | CAN ID와 시퀀스가 맞을 때만 조립 |
| FC를 보내지 않음 | FF 뒤 응답이 멈춤 | 원시 CAN이면 FC를 명시적으로 전송 |

## 장 요약

- 프레이밍은 바이트 스트림에 메시지 경계를 만드는 규칙이다. 구분자·길이·고정 크기·COBS·SLIP 등이 있다.
- 길이 접두 방식은 최대 길이 검증과 부분 프레임 타임아웃이 필수다.
- CRC는 오류 검출이지 인증이 아니다. 파라미터와 계산 범위, 바이트 순서를 문서화하고 테스트 벡터로 검증한다.
- 엔디언·부호·폭·스케일·비트 번호를 항상 명시한다. 예약 비트는 보존한다.
- 파서는 바이트 단위 상태 기계로 만든다. 부분 수신·재동기화·가비지 입력을 같은 코드로 처리한다.
- `parse(full) == parse(byte_by_byte)`를 자동 테스트로 증명한다.
- 재전송에는 멱등성과 중복 제거가 필요하다. 시각은 `time.monotonic()`으로 잰다.
- 로그에는 원시 hex와 단조 시각을 남긴다.
- ELM327은 `\r`과 프롬프트 `>`로 응답을 구분한다. `readline()` 대신 프롬프트까지 읽는 프레이머를 쓴다.
- ELM327이 조립해 준 `0:`/`1:` 줄과 원시 CAN의 ISO-TP PCI는 다른 계층이다. 둘을 섞지 않는다.
- 8바이트를 넘는 OBD 응답은 ISO-TP의 SF/FF/CF/FC로 오간다. CAN ID와 시퀀스를 검사하며 조립한다.
- FC는 데이터 방향이 반대다. ECU가 7E8로 응답하면 테스터는 7E0으로 FC를 보낸다.
- FC의 FS(CTS/WAIT/OVERFLOW), block size, STmin이 다음 전송의 규칙이다. BS=0은 끝까지, STmin은 CF 사이의 최소 간격이다.
- N_Bs(FC 대기)와 N_Cr(CF 대기) 타임아웃을 구분해 로그에 남긴다. 타임아웃은 "응답 없음"이 아니라 "어느 프레임을 기다리다 만료됐는가"다.

다음 장에서는 보드 안에서 센서·메모리·디스플레이와 대화하는 I2C와 SPI를 다룬다. UART와 달리 클록 선이 있고, 주소나 CS로 여러 장치를 구분한다.

## 연습 문제

### 1. 길이 접두 프레임

다음 바이트 스트림이 길이 접두 방식으로 왔다. 프레임 하나를 잘라 payload를 쓰라.

```text
04 41 0C 1A F8  03 41 0D 50
```

### 2. ISO-TP 조립

다음 프레임을 조립해 전체 payload와 그 의미를 쓰라.

```text
7E8  10 14 49 02 01 54 45 53
7E8  21 54 56 49 4E 30 30 30
7E8  22 30 30 30 30 30 30 30
```

### 3. 시퀀스가 어긋나면

FF를 받은 뒤 CF의 시퀀스가 `21`이어야 하는데 `23`이 왔다. 파서는 어떻게 해야 하는가? 부분 데이터를 이어 붙이면 안 되는 이유도 쓰라.

### 4. FC 바이트 해석

다음 FC 프레임의 FS, block size, STmin을 해석하라.

```text
30 08 0A CC CC CC CC CC
31 00 00 CC CC CC CC CC
32 00 00 CC CC CC CC CC
```

### 5. 파서 불변식

`parse(full) == parse(byte_by_byte)`를 자동 테스트로 만들려 한다. 어떤 입력으로 시험해야 하는가? 세 가지를 쓰라.

## 정답과 해설

### 1.

첫 바이트 `04`는 길이 4, payload는 `41 0C 1A F8`이다. 다음 `03`은 길이 3, payload는 `41 0D 50`이다. 길이를 읽고 그만큼 자른 뒤 다음 길이로 넘어간다.

### 2.

전체 길이는 `0x014 = 20`바이트다. payload는 `49 02 01` + 17바이트 VIN ASCII다. 위 바이트를 이어 붙이면 `49 02 01 54 45 53 54 56 49 4E 30 30 30 30 30 30 30 30 30 30`이고, ASCII 부분은 `TESTVIN0000000000`(테스트용 가짜 VIN)이다. 실제 VIN은 저장·공개하지 않는다.

### 3.

시퀀스가 어긋나면 **현재 조립을 버리고** 다음 FF를 기다린다. 부분 데이터를 이어 붙이면 프레임 하나가 빠진 채로 그럴듯한 잘못된 메시지가 만들어지고, 그 오류는 나중에 발견하기 어렵다. CAN ID가 다른 프레임도 같은 이유로 버린다.

### 4.

- `30 08 0A`: FS=0(CTS, 계속 보내라), BS=8(CF 8개마다 다시 FC), STmin=0x0A(10ms)
- `31 00 00`: FS=1(WAIT, 잠시 기다려라). 보내는 쪽은 다시 FC를 기다린다.
- `32 00 00`: FS=2(OVERFLOW, 그만 보내라). 받는 쪽은 전송을 중단하고 부분 데이터를 버린다.

### 5.

예: ① 정상 프레임을 한 번에 넣은 경우와 1바이트씩 넣은 경우 ② 경계에서 여러 조각으로 나눠 넣은 경우(1+2+3바이트 등) ③ 가비지 바이트·CRC 오류·잘린 프레임 뒤에 정상 프레임이 오는 경우. 가능하면 무작위 길이로 자르는 속성 테스트를 함께 돌린다.
