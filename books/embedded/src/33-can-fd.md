# 33장 CAN FD: 더 빠르고 더 긴 프레임

## 이 장에서

7장에서 본 클래식 CAN은 한 프레임에 **8바이트**, 버스 전체가 **최대 1Mbps**다. 1990년대의 엔진 제어에는 충분했지만, 지금의 차량은 카메라·레이다·OTA 업데이트·진단 로그처럼 큰 데이터를 다룬다. CAN FD(Flexible Data-Rate)는 이 한계를 **프레임 형식**을 바꿔 풀었다. 페이로드는 최대 64바이트로 늘리고, 중재가 끝난 뒤 데이터 구간만 더 빠른 비트레이트로 전환한다.

웹 개발자에게 이 변화는 HTTP/1.1에서 HTTP/2로 넘어갈 때와 비슷하다. 요청과 응답의 의미는 그대로인데, 프레임을 더 효율적으로 묶고 전송 방식을 바꿔 처리량을 높인다. 다만 결정적인 차이가 있다. HTTP/2는 기존 HTTP/1.1 클라이언트와 같은 네트워크에서 공존할 수 있지만, **클래식 CAN 노드와 CAN FD 노드는 같은 버스에 섞기 어렵다.** 프레임 형식 자체가 달라서, 클래식 노드는 FD 프레임을 오류로 본다.

이 장은 FD의 프레임 구조와 비트레이트 전환, 고전 CAN과 섞을 때 생기는 문제, ISO-TP와 OBD·UDS가 FD에서 어떻게 달라지는지를 다룬다. 예제는 python-can의 가상 버스에서 실행해 확인하고, Linux SocketCAN의 FD 설정은 커널 문서와 대조만 한다. 실제 차량의 FD 진단은 다루지 않는다.

이 장에서 다루는 것:

- 클래식 CAN의 대역폭 한계와 FD가 푸는 문제
- FDF·res·BRS·ESI·DLC로 이루어진 FD 프레임
- DLC 코드와 실제 바이트 수의 대응, 17/21비트 CRC
- BRS와 데이터 구간 비트 타이밍, TDC·SIC 트랜시버
- 클래식 노드와 섞을 때 생기는 오류, ISO/non-ISO FD
- ISO-TP의 FD 확장(SF escape, TX_DL, 64바이트 프레임)
- OBD·UDS가 FD에서 달라지는 범위
- python-can 가상 버스로 FD 프레임 주고받기
- Linux SocketCAN의 `fd`·`dbitrate` 설정(문서 대조)
- CAN XL의 위치

## 33.1 클래식 CAN의 한계

클래식 CAN의 한 프레임은 데이터 0~8바이트다. 데이터가 8바이트일 때 프레임은 대략 다음과 같이 구성된다(비트 스터핑 제외).

```text
SOF 1 + 중재 12 + 제어 6 + 데이터 64 + CRC 16 + ACK 2 + EOF 7 + IFS 3
= 111비트
```

500kbps에서 111비트는 **222µs**다. 데이터 64비트를 222µs에 보내므로, 페이로드만 세면 유효 처리량은 약 **288kbps**다. 프레임마다 붙는 ID·CRC·ACK·EOF가 절반 가까이를 차지한다.

- 8바이트를 넘는 진단 메시지는 ISO-TP로 나눈다. 20바이트 응답이면 FF 1개와 CF 2개, 모두 3프레임이다.
- CF 하나에는 7바이트만 들어간다. 프레임 사이에는 흐름 제어(FC)와 STmin 대기가 붙는다.
- ECU 수와 소프트웨어 크기가 늘면서, 진단·업데이트·로그가 같은 500kbps 버스를 나눠 쓰는 일이 많아졌다.
- 1Mbps로 올려도 8바이트 한계는 그대로다. CRC·ACK·프레임 간 간격 때문에 유효 처리량은 1Mbps의 절반을 조금 넘는 수준이다.

CAN FD는 두 가지를 바꾼다. **데이터 필드를 64바이트까지** 늘리고, **중재가 끝난 뒤 데이터 구간만** 더 빠른 비트레이트로 전환한다. 같은 64바이트를 8바이트 프레임 8개로 보내는 것보다, 64바이트 FD 프레임 하나로 보내는 편이 프레임 오버헤드와 ISO-TP 분할을 크게 줄인다.

> 데이터만 비교하면 500kbps 클래식 8프레임(8 × 222µs = 1.78ms)보다, 500kbps/2Mbps FD 1프레임의 데이터 구간(512비트 ÷ 2Mbps = 256µs)이 약 7배 빠르다. 실제로는 FD 프레임의 중재·CRC·ACK 오버헤드가 더해져 4~6배 수준이 된다(구성에 따라 다름).

## 33.2 FD 프레임 형식

표준 11비트 ID를 쓰는 FD 데이터 프레임은 다음과 같다.

| 필드 | 길이 | 내용 |
|---|---|---|
| SOF | 1비트 | dominant, 프레임 시작 |
| 중재 필드 | 12비트 | 11비트 ID + RTR |
| 제어 필드 | 9비트 | IDE, FDF, res, BRS, ESI, DLC(4비트) |
| 데이터 | 0~64바이트 | DLC가 실제 길이를 결정 |
| CRC | 17 또는 21비트 | 데이터 길이에 따라 다름 |
| CRC delimiter | 1비트 | recessive |
| ACK | 2비트 | ACK slot + delimiter |
| EOF | 7비트 | recessive |
| IFS | 3비트 | 프레임 간 간격 |

```text
| SOF | 중재(11비트 ID + RTR) | IDE | FDF | res | BRS | ESI | DLC | 데이터(0~64B) | CRC | ACK | EOF | IFS |
  1bit        12bit            1     1     1     1     1     4      0~512bit      17/21  2    7    3
```

- **FDF(FD Format)**: recessive면 FD 프레임, dominant면 클래식 프레임이다. Bosch 1.0 문서에서는 EDL(Extended Data Length)라고 불렀고, ISO 11898-1:2015에서 FDF로 이름이 바뀌었다.
- **res**: FD 프레임에서는 dominant로 보낸다. 클래식 프레임의 r0 자리에는 FDF가 오고, res는 그 뒤에 새로 생긴 예약 비트다.
- **BRS(Bit Rate Switch)**: recessive면 데이터 구간을 더 빠른 비트레이트로 전환한다. dominant면 프레임 전체를 중재 비트레이트로 보낸다.
- **ESI(Error State Indicator)**: 송신 노드의 오류 상태를 알린다. dominant는 Error Active, recessive는 Error Passive다.
- **DLC**: 4비트로 데이터 길이를 인코딩한다. 클래식과 달리 9~15가 실제 길이를 뜻한다.
- **RTR/remote frame은 없다.** FD에는 데이터 프레임만 있다. 오류 프레임과 overload 프레임은 중재 비트레이트로 보낸다.

### DLC 대응표

| DLC 코드 | 실제 바이트 수 |
|---:|---:|
| 0~8 | 0~8 |
| 9 | 12 |
| 10 | 16 |
| 11 | 20 |
| 12 | 24 |
| 13 | 32 |
| 14 | 48 |
| 15 | 64 |

**9·10·11·13·14·15바이트라는 길이는 버스 위에 없다.** 9바이트를 보내려면 12바이트로, 13바이트를 보내려면 16바이트로 패딩한다. 애플리케이션이 "9바이트"를 보냈다고 해도 실제 프레임은 12바이트다. 이 차이를 모르면 DBC나 진단 도구에서 길이를 잘못 해석한다.

### CRC와 스터프 규칙

- 데이터가 **16바이트 이하**면 17비트 CRC, **17바이트 이상**이면 21비트 CRC를 쓴다. 클래식의 15비트보다 검출 능력이 높다.
- ISO FD는 데이터와 CRC 사이에 **스터프 카운트(stuff count)** 를 넣고, CRC 필드 안에 **고정 스터프 비트**를 둔다. 클래식처럼 5비트마다 반대 비트를 넣는 방식과 다르다.
- Bosch 1.0(비ISO) FD에는 이 스터프 카운트가 없다. **ISO FD와 비ISO FD는 같은 버스에서 호환되지 않는다.** 컨트롤러 설정에서 ISO/non-ISO를 맞춰야 한다.
- CRC는 오류 검출이지 인증이 아니다. FD라고 해서 송신자 인증이 생기지는 않는다. 29장의 SecOC·IDS 논의는 FD에도 그대로 적용된다.

## 33.3 BRS와 데이터 구간 비트 타이밍

BRS가 recessive면, BRS 비트의 샘플 포인트부터 CRC delimiter까지 데이터 구간 비트레이트로 전환한다. 중재 필드와 ACK·EOF는 다시 중재 비트레이트로 돌아온다. 그래서 같은 버스의 모든 노드는 **중재 비트레이트**를 공유하고, FD 노드는 **데이터 비트레이트**도 공유한다.

```text
중재 비트레이트(예: 500kbps)
┌─────────────────────────────┐         ┌──────────────────────┐
│ SOF … 중재 … FDF, res, BRS │ 데이터 │ CRC delimiter … EOF │
└─────────────────────────────┘  구간  └──────────────────────┘
                               2~8Mbps
```

- 데이터 구간은 5~8Mbps까지 가능하다. ISO 11898-1:2015는 5Mbps를, SIC 트랜시버를 쓰는 구현은 8Mbps까지를 말한다.
- 실제 승용차는 2Mbps 구성도 흔하다(차종별 확인 필요). 중재 500kbps + 데이터 2Mbps, 중재 1Mbps + 데이터 5Mbps 같은 조합이 있다.
- 데이터 비트레이트가 높아질수록 **트랜시버 지연**이 비트 시간보다 커질 수 있다. 컨트롤러는 **TDC(Transmitter Delay Compensation)** 로 송신 지연을 측정해 샘플 포인트를 보정한다.
- **SIC(Signal Improvement Capability)** 트랜시버는 고속 데이터 구간의 링잉·반사를 줄여 5~8Mbps를 안정화한다. 일반 FD 트랜시버로 8Mbps를 시도하면 배선·종단·스텁에 따라 오류가 난다.
- 모든 FD 노드가 같은 중재/데이터 비트레이트와 샘플 포인트를 써야 한다. 한 노드만 데이터 비트레이트가 다르면 그 노드의 프레임에서 CRC·form 오류가 난다.
- 오실로스코프로 볼 때 데이터 구간 비트 폭은 중재 구간보다 훨씬 짧다. 2Mbps면 한 비트가 500ns, 5Mbps면 200ns다. 로직 분석기의 샘플 레이트와 프로브 대역폭을 확인한다.

## 33.4 클래식 CAN과 섞으면 생기는 일

CAN FD 컨트롤러는 **클래식 프레임을 수신할 수 있다.** 그래서 "FD 버스에 클래식 노드를 몇 개 붙여도 되지 않나"라고 생각하기 쉽다. 하지만 반대 방향이 문제다.

- 클래식 컨트롤러는 중재 필드 뒤의 r0 자리에서 dominant를 기대한다.
- FD 프레임은 같은 자리에 **FDF recessive**를 보낸다.
- 클래식 컨트롤러는 이를 form/stuff 오류로 보고 **오류 프레임**을 보낸다.
- FD 송신기는 프레임을 중단하고 재전송한다. 버스에는 오류가 반복된다.

그래서 **한 버스에 클래식 노드와 FD 노드를 섞는 구성은 실용적이지 않다.** 모든 노드와 트랜시버가 FD를 지원해야 한다. 클래식 ECU와 FD ECU를 함께 쓰려면 게이트웨이로 **버스를 분리**하고, 게이트웨이가 양쪽 프레임을 변환·라우팅한다. 8장의 게이트웨이 구조가 여기서도 그대로 필요하다.

- FD를 지원하지 않는 구형 트랜시버를 고속 데이터 구간에 쓰면, 저속에서는 동작하는 것처럼 보여도 고속에서 간헐 오류가 난다. 트랜시버 데이터시트의 FD/데이터 비트레이트 항목을 확인한다.
- FD 지원 표기만 보고 끝내지 말고, **ISO FD인지 비ISO인지**, 지원 데이터 비트레이트, SIC 여부를 확인한다.
- 클래식 CAN만 지원하는 분석 도구는 FD 프레임을 오류로 표시하거나 디코딩하지 못한다. FD 차량에는 FD 지원 인터페이스가 필요하다.
- 2019 쏘렌토 UM 2.2 디젤의 OBD 포트에서 확인된 것은 **클래식 CAN 11비트 500kbps**다(실차 기록). 이 차에 FD를 가정하지 않는다.

## 33.5 ISO-TP와 진단이 FD에서 달라지는 점

ISO-TP(ISO 15765-2)는 2016년 개정에서 CAN FD를 받아들였다. 핵심은 **TX_DL**이라는 설정값이다. TX_DL은 한 프레임에 실을 수 있는 데이터 길이의 상한으로, 8·12·16·20·24·32·48·64 중 하나다.

- TX_DL이 8이면 기존 클래식 동작과 같다.
- TX_DL이 8보다 크면 FD 프레임만 쓴다. 한 프레임에 더 많은 데이터를 담을 수 있다.
- **Single Frame(SF)** 은 데이터가 7바이트 이하면 기존 형식(PCI 하위 니블에 길이)을 쓴다. 8바이트 이상이면 **escape 형식**을 쓴다. 첫 PCI 바이트를 `0x00`으로 두고, 둘째 바이트에 SF_DL을 넣는다.
- normal addressing에서 FD SF의 최대 데이터는 62바이트다. CAN_DL 64바이트에서 PCI 2바이트를 뺀 크기다.
- **First Frame(FF)** 은 CAN_DL 64바이트에서 PCI 2바이트를 빼고 62바이트를 담는다. 이어지는 CF는 PCI 1바이트를 빼고 63바이트를 담는다.
- 4095바이트를 넘는 메시지는 FF escape 형식으로 32비트 길이를 쓴다. 최대 2³²−1바이트까지 표현할 수 있다.
- 흐름 제어(FC)와 STmin, 블록 크기는 그대로다. 프레임이 커져도 타이밍 규칙은 사라지지 않는다.

예를 들어 UDS `22 F1 87` 응답이 20바이트라고 하자. 클래식 CAN에서는 FF 1개(6바이트) + CF 2개(7+7바이트)로 나뉜다. FD에서는 SF 하나에 들어간다.

```text
클래식:
  7E8  10 14 62 F1 87 ...        FF, 전체 0x014바이트
  7E8  21 ...                    CF 1
  7E8  22 ...                    CF 2

CAN FD(24바이트 프레임):
  7E8  00 14 62 F1 87 ... 00 00  SF escape, SF_DL=0x14(20)
        ↑  ↑
        │  └── SF_DL
        └───── PCI: Single Frame, escape
```

- `00 14`는 "SF escape, 데이터 20바이트"라는 뜻이다. 그 뒤 `62 F1 87 ...`가 UDS 응답이다.
- 20바이트 데이터 + 2바이트 PCI = 22바이트이므로, 실제 CAN_DL은 24바이트(DLC 12)가 된다. 남는 2바이트는 패딩이다.
- 패딩 값은 구현마다 다르다. 위 예의 `00 00`은 설명을 위한 값이다.

### OBD-II와 UDS에 미치는 영향

- **UDS(ISO 14229-1)** 는 전송 계층에 독립적이다. CAN 위에서는 ISO-TP를 쓰므로, ISO-TP가 FD를 지원하면 UDS 메시지도 FD 프레임으로 실을 수 있다. 서비스·DID·NRC의 의미는 바뀌지 않는다.
- **OBD-II**는 ISO 15765-4가 전송을 규정한다. 2021년 개정은 OBDonUDS(SAE J1979-2)를 위한 11비트/29비트 식별자와 250/500kbps nominal bit timing을 다룬다. 공개된 2차 자료만으로는 **OBD-II가 FD 데이터 구간을 필수로 쓰는지** 확정하지 못했다. 차량·표준 개정판을 확인해야 한다(`확인 필요`).
- SAE J1979-2는 전송 계층으로 ISO 15765-4(DoCAN) 또는 ISO 13400-2(DoIP)를 참조한다. IP 기반 진단은 35장에서 다룬다.
- FD 차량은 FD를 지원하는 진단 인터페이스가 필요하다. ELM327 클론은 FD를 지원하지 않는 경우가 많다. `UNABLE TO CONNECT`·`NO DATA`가 나와도 차량 고장으로 단정하지 말고 어댑터 지원 범위를 확인한다.
- 진단 도구가 FD 프레임을 보낼 때도 **읽기 전용 원칙**은 그대로다. 쓰기·세션 전환·액추에이터 구동은 차량에서 하지 않는다.

## 33.6 python-can 가상 버스로 FD 프레임 주고받기

python-can은 `Message`의 `is_fd`, `bitrate_switch`, `error_state_indicator`로 FD 속성을 표현한다. 다음 예제는 `virtual` 인터페이스에서 클래식 프레임과 FD 프레임을 주고받는다. 두 `Bus`가 같은 채널 이름을 공유하면 같은 프로세스 안에서 프레임이 전달된다.

```python
import can

CHANNEL = "fd-lab"


def describe(msg: can.Message) -> str:
    return (
        f"id=0x{msg.arbitration_id:X} dlc={msg.dlc} len={len(msg.data)} "
        f"fd={msg.is_fd} brs={msg.bitrate_switch} esi={msg.error_state_indicator} "
        f"data={msg.data.hex(' ')}"
    )


with can.Bus(interface="virtual", channel=CHANNEL, receive_own_messages=False) as tx, \
     can.Bus(interface="virtual", channel=CHANNEL, receive_own_messages=False) as rx:
    tx.send(can.Message(arbitration_id=0x123, is_extended_id=False,
                        data=bytes(range(8))))
    print("classic:", describe(rx.recv(timeout=1.0)))

    tx.send(can.Message(arbitration_id=0x456, is_extended_id=False, is_fd=True,
                        bitrate_switch=False, data=bytes(range(12))))
    print("fd12   :", describe(rx.recv(timeout=1.0)))

    tx.send(can.Message(arbitration_id=0x789, is_extended_id=False, is_fd=True,
                        bitrate_switch=True, error_state_indicator=True,
                        data=bytes(range(64))))
    print("fd64   :", describe(rx.recv(timeout=1.0)))
```

실행 결과는 다음과 같다.

```text
classic: id=0x123 dlc=8 len=8 fd=False brs=False esi=False data=00 01 02 03 04 05 06 07
fd12   : id=0x456 dlc=12 len=12 fd=True brs=False esi=False data=00 01 02 03 04 05 06 07 08 09 0a 0b
fd64   : id=0x789 dlc=64 len=64 fd=True brs=True esi=True data=00 01 02 ... 3e 3f
```

- `dlc`는 FD 메시지에서 **payload 바이트 수**다. 와이어의 4비트 DLC 코드가 아니다. 12바이트 메시지의 `dlc=12`는 와이어 DLC 코드 9에 해당한다.
- `bitrate_switch=True`는 BRS를 켠다는 뜻이고, `error_state_indicator=True`는 ESI를 recessive(Error Passive)로 보낸다는 뜻이다. 가상 버스는 이 비트를 그대로 전달하지만, 실제 버스의 오류 상태를 바꾸지는 않는다.
- **가상 버스는 물리 계층을 흉내 내지 않는다.** 중재·ACK·비트 타이밍·CRC·TDC가 없으므로, 여기서 통과했다고 실제 FD 버스에서 통과한다는 보장이 없다.
- SocketCAN은 비트레이트를 `ip link`로 설정하고, python-can에서는 `can.Bus(interface="socketcan", channel="can0", fd=True)`로 FD 프레임을 연다. `bitrate`/`data_bitrate` 인자를 받는 어댑터 인터페이스도 있으므로, 인자 이름과 지원 여부는 python-can 문서와 어댑터 설명을 확인한다.

### 9바이트를 보내면 어떻게 되는가

가상 버스에 9바이트 FD 메시지를 보내면 python-can 4.6.1은 그대로 전달한다. 하지만 실제 버스에는 9바이트 DLC가 없다. 인터페이스가 12바이트로 패딩하거나, 설정에 따라 오류를 낼 수 있다.

```python
def wire_length(payload_len: int) -> tuple[int, int]:
    table = {9: 12, 10: 16, 11: 20, 12: 24, 13: 32, 14: 48, 15: 64}
    if payload_len <= 8:
        return payload_len, payload_len
    for code, can_dl in table.items():
        if payload_len <= can_dl:
            return code, can_dl
    raise ValueError("CAN FD payload는 64바이트까지")
```

- 애플리케이션은 9바이트를 보냈다고 생각하지만, 버스에는 12바이트가 나간다. 수신 측은 12바이트를 받고, 애플리케이션 길이를 따로 알아야 한다.
- DBC나 진단 정의에서 메시지 길이를 정의할 때 이 패딩을 고려한다.
- `can.Message(..., check=True)`는 길이와 DLC의 일관성, remote/FD 플래그 충돌 같은 기본 조건을 검사하지만, FD의 표준 길이(0~8, 12, 16, 20, 24, 32, 48, 64)를 강제하지는 않는다. 비표준 길이는 `wire_length()` 같은 함수로 직접 검사한다.

## 33.7 Linux SocketCAN에서 CAN FD (문서 대조)

Linux에서는 `ip` 명령으로 CAN FD 인터페이스를 올린다. 커널 문서의 예는 다음과 같다.

```bash
sudo ip link set can0 up type can \
  bitrate 500000 sample-point 0.75 \
  dbitrate 4000000 dsample-point 0.8 fd on
ip -details link show can0
```

- `bitrate`는 중재 구간, `dbitrate`는 데이터 구간 비트레이트다.
- `sample-point`와 `dsample-point`는 각 구간의 샘플 포인트다. 0.000~0.999 범위다.
- `fd on`은 FD 모드를 켜고 인터페이스 MTU를 72로 바꾼다.
- 데이터 비트레이트는 중재 비트레이트보다 낮을 수 없다.
- `ip -details link show can0`에서 `mtu 72`와 `can <FD>`가 보이면 FD가 켜진 것이다.
- 수동 타이밍은 `dtq`, `dprop-seg`, `dphase-seg1`, `dphase-seg2`, `dsjw`로 지정한다.
- 비ISO FD 컨트롤러는 `fd-non-iso on`으로 전환한다. 스위치 가능한 컨트롤러에서만 된다.

소켓 API에서는 `CAN_RAW_FD_FRAMES` 옵션을 켜야 FD 프레임을 주고받는다. `struct canfd_frame`의 `len`은 **바이트 수(0~64)** 이고, 드라이버가 `can_fd_len2dlc()`로 와이어 DLC를 계산한다. 클래식 프레임의 MTU는 16바이트, FD 프레임의 MTU는 72바이트다.

이 책의 환경에는 Linux CAN 장치가 없어 위 명령을 실행하지 못했다. 명령과 필드 이름은 커널 문서와 대조했지만, 실제 어댑터에서의 동작은 `ip -details link show`로 확인해야 한다(`실물 확인 필요`).

## 33.8 CAN XL은 무엇을 더하려는가

CAN XL은 ISO 11898-1:2024에 포함된 **세 번째 CAN 데이터링크 세대**다. FD가 "8바이트를 64바이트로, 데이터 구간을 빠르게" 했다면, CAN XL은 그 다음을 겨냥한다.

- 데이터 필드 **1~2048바이트**.
- 11비트 **우선순위 ID**와 32비트 **수용 필드(AF)** 를 분리한다. ID 하나가 중재와 주소를 겸하지 않는다.
- **13비트 PCRC**와 **32비트 FCRC** 두 개의 CRC를 쓴다.
- CAN SIC XL 트랜시버와 PWM 인코딩으로 **20Mbps 이상**을 겨냥한다(CiA).
- 백본·서브백본과 TCP/IP 연동을 염두에 둔다. IP 패킷을 실을 수 있게 설계된 것이다.

CAN XL은 FD나 클래식 CAN을 모든 차량에서 즉시 대체하는 기술이 아니다. 차량·ECU·트랜시버·도구가 함께 지원해야 하고, 차종별 채택은 확인해야 한다(`확인 필요`). 이 책에서는 존재와 목적만 짚고, 실습은 다루지 않는다.

## 33.9 흔한 실수

| 증상 | 원인 후보 | 확인 |
|---|---|---|
| FD 프레임에서 form/stuff 오류 | 같은 버스에 클래식 노드가 섞임 | 모든 노드의 FD 지원, 버스 분리 |
| FD 프레임이 아예 안 보임 | 어댑터가 FD 미지원, `fd on` 누락 | 인터페이스 MTU 72, `can <FD>`, 어댑터 스펙 |
| 고속 데이터 구간에서만 간헐 오류 | 트랜시버·배선·스텁·종단, TDC 미설정 | SIC 트랜시버, 데이터 타이밍, 파형 |
| ISO FD와 통신 안 됨 | 상대가 Bosch 1.0(non-ISO) | 컨트롤러의 ISO/non-ISO 설정 |
| 9바이트가 12바이트로 보임 | DLC 코드와 바이트 수를 혼동 | DLC 대응표, 패딩 길이 |
| `dlc` 값이 와이어 DLC와 다름 | python-can은 payload 길이를 `dlc`로 표시 | `can_fd_len2dlc()` 개념 |
| 진단 응답이 깨짐 | ISO-TP TX_DL·SF escape·패딩 불일치 | TX_DL, `00 <SF_DL>` 형식 |
| ELM327이 `UNABLE TO CONNECT` | FD 차량, 어댑터 FD 미지원 | FD 지원 인터페이스로 교체 |
| OBD가 FD라고 단정 | 표준·차량별 차이 | ISO 15765-4 개정판·차량 문서 |
| 버스가 불안정 | 차량 CAN에 120Ω 추가 | 차량에는 추가하지 않는다 |

## 33.10 체크리스트

- [ ] 버스의 모든 노드와 트랜시버가 FD를 지원하는가
- [ ] 모든 노드가 같은 ISO/non-ISO FD 설정인가
- [ ] 중재·데이터 비트레이트와 샘플 포인트가 같은가
- [ ] 데이터 구간에 맞는 트랜시버(SIC 포함)와 배선인가
- [ ] TDC와 데이터 타이밍을 컨트롤러 설정에서 확인했는가
- [ ] DLC 코드와 실제 바이트 수를 구분했는가
- [ ] ISO-TP TX_DL·SF escape·패딩을 맞췄는가
- [ ] FD 지원 어댑터·분석 도구인가
- [ ] OBD·UDS의 FD 지원 여부를 차량·표준 문서로 확인했는가
- [ ] 가상 버스 실습과 실제 버스 시험을 구분했는가
- [ ] 차량에서는 읽기 전용인가
- [ ] 차량 CAN에 120Ω을 추가하지 않았는가

## 장 요약

- CAN FD는 페이로드를 최대 64바이트로 늘리고, 데이터 구간만 더 빠른 비트레이트로 전환한다.
- FD 프레임은 FDF로 구분하고, BRS로 데이터 구간을 전환하며, ESI로 송신 노드의 오류 상태를 알린다.
- DLC 9~15는 12·16·20·24·32·48·64바이트를 뜻한다. 9·10·11·13·14·15바이트 길이는 버스에 없다.
- CRC는 17비트(≤16바이트) 또는 21비트(>16바이트)이고, ISO FD는 스터프 카운트와 고정 스터프 비트를 쓴다.
- 클래식 노드는 FD 프레임을 오류로 본다. 같은 버스에 섞지 말고 게이트웨이로 분리한다.
- ISO FD와 Bosch 1.0 비ISO FD는 CRC·스터프 규칙이 달라 호환되지 않는다.
- ISO-TP 2016은 TX_DL과 SF escape로 FD를 지원한다. 20바이트 UDS 응답이 한 프레임에 들어간다.
- UDS는 전송 계층에 독립적이므로 FD 위에서도 의미가 같다. OBD-II의 FD 데이터 구간 사용은 차량·표준 개정판을 확인해야 한다.
- python-can 가상 버스로 FD 프레임을 주고받을 수 있지만, 물리 계층·중재·CRC는 재현하지 않는다.
- Linux SocketCAN은 `dbitrate`와 `fd on`으로 FD를 켠다. 이 책에서는 문서 대조만 했다.
- CAN XL은 2048바이트와 20Mbps급을 겨냥하는 다음 세대다. 차량 채택은 확인이 필요하다.
- 2019 쏘렌토에서 확인된 것은 클래식 CAN 500kbps다. FD 차량 여부는 어댑터·차량 문서로 확인한다.

다음 장에서는 차량의 반대쪽 끝, 즉 창문·시트·공조 액추에이터를 맡는 **LIN**을 본다. CAN FD가 대역폭을 늘리는 방향이라면, LIN은 비용과 배선을 줄이는 방향이다.

## 연습 문제

### 1. (기초) DLC 대응

다음 payload를 CAN FD로 보낼 때 와이어 DLC 코드와 실제 CAN_DL 바이트 수를 쓰라.

1. 8바이트
2. 9바이트
3. 20바이트
4. 64바이트

### 2. (중급) 프레임 시간

클래식 CAN 500kbps에서 데이터 8바이트 프레임이 111비트(스터핑 제외)라고 하자.

1. 한 프레임의 전송 시간은 몇 µs인가?
2. 같은 64바이트를 8바이트 프레임 8개로 보내는 데 걸리는 시간은?
3. 64바이트 FD 프레임의 데이터 구간을 2Mbps로 보내는 시간은? 데이터만 비교하라.

### 3. (중급) BRS와 ESI

어떤 FD 프레임의 BRS=1, ESI=0이다.

1. 데이터 구간은 어느 비트레이트로 전송되는가?
2. 송신 노드의 오류 상태는 무엇인가?
3. BRS=0이면 프레임은 어떻게 전송되는가?

### 4. (심화) 클래식 노드가 섞인 버스

한 버스에 FD ECU와 클래식 ECU가 함께 연결되어 있다. FD ECU가 프레임을 보낼 때마다 오류가 나고, 클래식 ECU는 정상처럼 보인다.

1. 원인을 설명하라.
2. 이 버스를 정상화하는 두 가지 방법을 쓰라.
3. FD ECU가 클래식 프레임을 받을 수 있는데도 이 구성이 위험한 이유는 무엇인가?

### 5. (중급) ISO-TP SF escape

UDS 응답 `62 F1 87` 뒤에 17바이트 데이터가 붙어 총 20바이트다. CAN FD normal addressing으로 이 응답을 Single Frame에 넣으려 한다.

1. PCI 바이트 두 개를 쓰라.
2. 필요한 CAN_DL과 DLC 코드를 쓰라.
3. 클래식 CAN이라면 몇 개의 프레임이 필요한가?

## 정답과 해설

### 1.

1. 8바이트: DLC 8, CAN_DL 8.
2. 9바이트: DLC 9, CAN_DL 12. 9바이트 길이는 버스에 없으므로 12로 패딩한다.
3. 20바이트: DLC 11, CAN_DL 20.
4. 64바이트: DLC 15, CAN_DL 64.

### 2.

1. 111비트 ÷ 500,000bps = 222µs.
2. 222µs × 8 = 1.776ms.
3. 512비트 ÷ 2,000,000bps = 256µs. 데이터만 비교하면 FD가 약 6.9배 빠르다. 실제 프레임에는 중재·CRC·ACK 오버헤드가 더 붙는다.

### 3.

1. BRS=1(recessive)이므로 데이터 구간은 설정된 데이터 비트레이트(예: 2Mbps)로 전송된다.
2. ESI=0(dominant)은 Error Active를 뜻한다.
3. BRS=0이면 데이터 구간도 중재 비트레이트로 전송된다. 페이로드는 여전히 64바이트까지 가능하다. 큰 페이로드만 필요하고 속도는 필요 없을 때 쓰는 구성이다.

### 4.

1. 클래식 컨트롤러는 FD 프레임의 FDF recessive를 form/stuff 오류로 보고 오류 프레임을 보낸다. FD 송신기는 프레임을 중단·재전송하므로 버스에 오류가 반복된다.
2. 모든 노드를 FD 지원으로 교체하거나, 클래식 버스와 FD 버스를 게이트웨이로 분리한다. 게이트웨이가 양쪽 프레임을 변환·라우팅한다.
3. FD 컨트롤러가 클래식 프레임을 수신할 수 있는 것은 **수신** 기능이다. 클래식 컨트롤러는 FD 프레임을 이해하지 못하므로, 같은 버스에 두면 클래식 노드가 버스를 오류로 오염시킨다.

### 5.

1. `00 14`. 첫 바이트 `0x00`은 SF escape, 둘째 바이트 `0x14`는 SF_DL=20이다.
2. 20바이트 데이터 + 2바이트 PCI = 22바이트이므로 CAN_DL 24, DLC 코드 12다. 2바이트를 패딩한다.
3. 클래식 CAN에서는 FF 1개(6바이트) + CF 2개(7+7바이트) = 3프레임이 필요하다. ISO-TP 흐름 제어와 STmin도 맞춰야 한다.
