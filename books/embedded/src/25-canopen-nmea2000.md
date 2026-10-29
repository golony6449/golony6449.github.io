# 25장 CANopen과 NMEA 2000: 산업과 선박의 CAN

## 이 장에서

24장에서 트럭·중장비의 J1939를 보았다. 같은 CAN 위에 또 다른 세계가 있다. 공장 자동화의 **CANopen**, 선박 전자장비의 **NMEA 2000**이다. 둘 다 CAN을 쓰지만 "무엇을 어떤 번호로, 어떤 방식으로 주고받는가"는 전혀 다르다.

웹 개발자에게 익숙한 비유를 하나 쓰자면 이렇다.

- **CANopen**은 장치마다 **OpenAPI 문서(객체 사전)**가 있고, 그 문서의 경로로 값을 읽고 쓰는 **REST**와, 관심 있는 값의 변화를 구독하는 **이벤트 스트림**이 함께 있는 구조다.
- **NMEA 2000**은 선박 기기들이 공유하는 **표준 토픽 사전(PGN)**과 **발행/구독** 구조다. 데이터링크는 J1939와 거의 같지만, 토픽 사전과 인증·물리 규격은 선박용으로 따로 정의되어 있다.

이 장에서 다루는 것:

- CANopen의 객체 사전, NMT 상태, SDO/PDO, 하트비트
- CANopen을 REST·이벤트 스트림에 대응시키기
- NMEA 2000이 J1939 위에 서 있다는 점과 PGN 재사용
- NMEA 2000의 fast packet과 대표 PGN
- python-can/canopen 가상 버스 실습

**안전 규칙은 9장과 같다.** 실제 차량·선박·산업 설비에서는 읽기만 한다. NMT 상태 전환, SDO 쓰기, PDO 송신은 실제 장비에서 하지 않고, 이 장의 가상 버스나 격리된 벤치에서만 한다.

## 25.1 CANopen: 장치를 객체 사전으로 본다

CANopen은 CiA(Can in Automation)가 표준화한 CAN 기반 응용 프로토콜이다. 핵심 표준은 **CiA 301**이고, 그 위에 장치 프로파일(CiA 401 I/O, CiA 402 모션 등)이 올라간다.

- 클래식 CANopen은 **11비트 CAN ID**를 쓴다.
- 노드 ID는 **1~127**이다. 0은 NMT, 128 이상은 예약·확장용으로 둔다.
- 데이터 레이트는 10kbit/s~1Mbit/s다.
- 모든 장치는 **객체 사전(Object Dictionary, OD)**을 가진다.

### 객체 사전

객체 사전은 "이 장치가 어떤 값을 어떤 주소로 제공하는가"를 정의한 표다. 주소는 **16비트 index**와 **8비트 subindex**로 이루어진다.

```text
index (16비트)  subindex (8비트)
0x1000          0x00
```

| 범위 | 용도 |
|---|---|
| `0x1000`~`0x1FFF` | 통신 파라미터·표준 객체 |
| `0x2000`~`0x5FFF` | 제조사 정의 |
| `0x6000`~`0x9FFF` | 장치 프로파일(예: CiA 402) |

대표 객체는 다음과 같다.

| Index | 이름 | 의미 |
|---|---|---|
| `0x1000` | Device Type | 장치 종류·프로파일 |
| `0x1001` | Error Register | 현재 오류 상태 |
| `0x1005` | COB-ID SYNC | SYNC 메시지의 CAN ID |
| `0x1017` | Producer Heartbeat Time | 하트비트 주기(ms) |
| `0x1018` | Identity Object | 제조사·제품·버전·일련번호 |
| `0x1800` | TPDO1 Communication | TPDO1의 COB-ID·전송 형식 |
| `0x1A00` | TPDO1 Mapping | TPDO1에 실을 객체 목록 |
| `0x1400` | RPDO1 Communication | RPDO1의 COB-ID·전송 형식 |
| `0x1600` | RPDO1 Mapping | RPDO1에 실을 객체 목록 |

이 표는 장치의 **API 문서**와 같다. REST에서 `/devices/5/objects/0x1000`을 읽는 대신, CANopen에서는 SDO로 index `0x1000`, subindex `0x00`을 읽는다. EDS(Electronic Data Sheet) 파일은 이 객체 사전을 텍스트로 표현한 것이다. 웹의 OpenAPI/Swagger 파일에 해당한다.

### 웹 개념과 대응

| 웹 | CANopen | 차이 |
|---|---|---|
| OpenAPI/JSON Schema | 객체 사전(OD), EDS | 장치 안에 있고, 인덱스·서브인덱스로 접근 |
| 리소스 경로 | index/subindex | 계층이 아니라 16비트+8비트 주소 |
| 장치 ID | Node ID(1~127) | CAN ID의 하위 7비트에 반영 |
| API 문서 버전 | Device Type/Profile | CiA 301 + 장치 프로파일 |

## 25.2 NMT: 장치의 상태 기계

CANopen 노드는 아무 때나 PDO를 보내지 않는다. **NMT(Network Management)** 상태 기계가 통신 범위를 결정한다.

| 상태 | 값 | 할 수 있는 일 |
|---|---:|---|
| Initialisation | 0 | 부팅·초기화. 아직 통신하지 않는다 |
| Pre-operational | 127 (`0x7F`) | SDO, NMT, EMCY, 하트비트. PDO는 안 된다 |
| Operational | 5 | SDO, PDO, NMT, EMCY, 하트비트 |
| Stopped | 4 | NMT, 하트비트만. SDO·PDO는 안 된다 |

NMT 명령은 CAN ID `0x000` 고정으로 보낸다. 데이터는 2바이트이고, 첫 바이트가 명령, 두 번째 바이트가 대상 노드 ID다.

| 명령 | 값 | 뜻 |
|---|---:|---|
| Start Remote Node | `0x01` | Operational로 |
| Stop Remote Node | `0x02` | Stopped로 |
| Enter Pre-operational | `0x80` | Pre-operational로 |
| Reset Node | `0x81` | 노드 리셋 |
| Reset Communication | `0x82` | 통신 파라미터만 리셋 |

예를 들어 노드 5를 시작하려면 `0x000`에 `01 05`를 보낸다. 모든 노드를 대상으로 하려면 노드 ID를 0으로 둔다.

### 왜 상태가 필요한가

- **Pre-operational**은 "설정 모드"다. SDO로 객체 사전을 읽고 쓰며 PDO 매핑을 설정할 수 있지만, PDO 트래픽은 나가지 않는다.
- **Operational**은 "서비스 모드"다. 설정된 PDO가 주기·이벤트로 흐른다.
- **Stopped**는 "정지 모드"다. 제어 트래픽을 멈추고 NMT만 받는다.

웹의 배포 상태(설정 중 → 서비스 중 → 정지)와 비슷하다. 다른 점은 **상태를 바꾸는 것이 명령 프레임**이라는 것, 그리고 잘못된 상태에서는 SDO가 거부될 수 있다는 것이다.

## 25.3 SDO: 요청·응답으로 객체 읽기

**SDO(Service Data Object)**는 객체 사전의 한 항목을 읽거나 쓰는 요청·응답 프로토콜이다. REST의 `GET /objects/0x1000/0`에 가장 가깝다.

### COB-ID

| 방향 | COB-ID | 뜻 |
|---|---|---|
| 클라이언트 → 서버 | `0x600 + NodeID` | SDO 요청 |
| 서버 → 클라이언트 | `0x580 + NodeID` | SDO 응답 |

노드 5라면 요청은 `0x605`, 응답은 `0x585`다. CAN ID에 노드 ID가 들어가므로, 같은 버스에서 노드별 SDO를 구분할 수 있다.

### expedited와 segmented

- **expedited**: 데이터가 4바이트 이하일 때 한 프레임에 index·subindex·데이터를 모두 담는다.
- **segmented**: 4바이트를 넘으면 여러 프레임으로 나눈다. 첫 프레임에 총 길이를 넣고, 이후 세그먼트를 토글 비트로 주고받는다.

### 프레임 예

`0x1000`(Device Type)을 읽는 예를 보자.

```text
요청: 605  40 00 10 00 00 00 00 00
      │   │  └──┬──┘
      │   │     └─ index 0x1000, subindex 0x00 (리틀 엔디언)
      │   └─ 명령 0x40 = upload request
      └─ COB-ID 0x600 + node 5

응답: 585  43 00 10 00 91 01 02 00
      │   │  └──┬──┘  └─────┬─────┘
      │   │     └─ index   └─ 데이터 0x00020191
      │   └─ 명령 0x43 = upload response, expedited, 4바이트
      └─ COB-ID 0x580 + node 5
```

- `0x43`은 "expedited upload response, 4바이트"라는 뜻이다. 데이터 크기에 따라 `0x47`(3바이트), `0x4B`(2바이트), `0x4F`(1바이트)가 된다.
- 쓰기는 `0x23`(4바이트), `0x27`(3바이트), `0x2B`(2바이트), `0x2F`(1바이트)를 쓴다.
- 응답 데이터 `91 01 02 00`은 리틀 엔디언으로 `0x00020191`이다.

### Abort

SDO 서버가 요청을 처리할 수 없으면 **Abort** 프레임을 보낸다. 첫 바이트는 `0x80`이고, 뒤에 index/subindex와 4바이트 abort code가 온다.

| Abort code | 의미 |
|---|---|
| `0x06010000` | 지원하지 않는 접근 |
| `0x06020000` | 객체 사전에 없는 객체 |
| `0x06090011` | 없는 subindex |
| `0x06010002` | 읽기 전용 객체에 쓰기 시도 |

REST의 `405 Method Not Allowed`, `404 Not Found`에 해당한다. 다른 점은 **에러 코드가 4바이트 16진수**이고, 요청한 index/subindex가 응답에 그대로 들어 있다는 것이다. 로그에서 "어떤 객체가 없어서 실패했는가"를 바로 알 수 있다.

## 25.4 PDO: 설정된 값의 이벤트 스트림

**PDO(Process Data Object)**는 객체 사전의 여러 값을 묶어 주기적·이벤트 기반으로 보내는 메시지다. SDO가 "질문해서 읽는 REST"라면, PDO는 "구독해 두면 알아서 오는 이벤트 스트림"이다.

### COB-ID와 매핑

| 방향 | 기본 COB-ID | 객체 |
|---|---|---|
| TPDO1(노드 → 버스) | `0x180 + NodeID` | `0x1800`/`0x1A00` |
| RPDO1(버스 → 노드) | `0x200 + NodeID` | `0x1400`/`0x1600` |
| TPDO2 | `0x280 + NodeID` | `0x1801`/`0x1A01` |
| RPDO2 | `0x300 + NodeID` | `0x1401`/`0x1601` |

PDO에는 **어떤 객체를 몇 비트로 실을지**를 매핑해 둔다. 예를 들어 TPDO1에 `0x2000/0x01`(온도, 16비트)와 `0x2000/0x02`(압력, 16비트)를 매핑하면, 8바이트 프레임의 앞 4바이트에 두 값이 들어간다. 수신자는 EDS의 매핑을 보고 해석한다.

### 전송 형식

PDO 통신 파라미터의 transmission type이 전송 시점을 정한다.

| 값 | 의미 |
|---:|---|
| 0 | 동기, 비주기. SYNC 후 값이 변했을 때만 |
| 1~240 | 동기, 주기. n번째 SYNC마다 |
| 252 | RTR 요청 시, 동기 |
| 253 | RTR 요청 시, 비동기 |
| 254 | 제조사 정의 이벤트 |
| 255 | 장치 프로파일 정의 이벤트 |

254/255는 값 변화·내부 이벤트로 보낼 수 있고, **inhibit time**(최소 간격)과 **event timer**(주기)로 폭주를 막는다. 웹의 이벤트 스트림에서 디바운스·스로틀을 두는 것과 같은 이유다.

### SDO와 PDO 비교

| | SDO | PDO |
|---|---|---|
| 방향 | 요청/응답(점대점) | 발행/구독(브로드캐스트) |
| 데이터 크기 | 4바이트 초과 가능(segmented) | 클래식 CAN 8바이트 |
| 시점 | 클라이언트가 요청할 때 | 주기·SYNC·이벤트 |
| 설정 | 객체 사전을 직접 지정 | 매핑을 미리 설정 |
| 웹 대응 | REST GET/PUT | SSE/WebSocket 이벤트 |
| 오류 | Abort code | EMCY, 하트비트, 애플리케이션 타임아웃 |

PDO는 "설정이 틀리면 아무것도 안 온다"는 점이 함정이다. SDO처럼 "요청했는데 404"가 아니라, 매핑·전송 형식·NMT 상태 중 하나가 어긋나면 조용히 침묵한다. 그래서 CANopen 디버깅은 **객체 사전 → 매핑 → NMT 상태 → 버스 트래픽** 순서로 본다.

## 25.5 하트비트와 EMCY

### 하트비트

노드는 `0x700 + NodeID`로 **하트비트**를 보낼 수 있다. 데이터는 1바이트이며, 하위 7비트가 NMT 상태, 최상위 비트가 토글 비트다.

| 상태 바이트 | 의미 |
|---:|---|
| `0x00` | Boot-up |
| `0x04` | Stopped |
| `0x05` | Operational |
| `0x7F` | Pre-operational |

생산 주기는 객체 `0x1017`(ms)로 설정한다. 수신자는 일정 시간 동안 하트비트가 오지 않으면 노드가 죽었다고 판단한다. 웹의 헬스 체크·하트비트와 같다.

### EMCY

**EMCY(Emergency)**는 노드가 오류를 감지했을 때 보내는 메시지다. COB-ID는 `0x080 + NodeID`다. 오류 코드와 오류 레지스터(`0x1001`)를 실어 보낸다. 하트비트가 "살아 있나"라면 EMCY는 "무슨 문제가 생겼나"다.

- 하트비트가 끊기면: 전원·케이블·노드 리셋을 의심한다.
- EMCY가 오면: 오류 코드·레지스터를 읽고, SDO로 진단 객체를 확인한다.
- PDO가 안 오면: NMT 상태·매핑·전송 형식을 확인한다.

## 25.6 NMEA 2000: 바다 위의 J1939

NMEA 2000은 선박 전자장비의 CAN 기반 네트워크다. 국제 표준은 **IEC 61162-3**이고, 데이터링크는 **ISO 11783/SAE J1939**를 바탕으로 한다.

- 속도는 **250kbit/s**로 고정이다.
- 한 네트워크에 최대 **50개**의 물리 장치를 연결한다.
- 백본 양 끝에 **120Ω 종단**을 둔다.
- 29비트 CAN ID를 쓰고, **PGN + 소스 주소** 구조도 J1939와 같다.
- 전원은 버스 케이블로 공급하며, 장치별 소비 전류를 LEN(Load Equivalency Number)으로 계산한다.
- NMEA 인증을 받으려면 PGN 사전뿐 아니라 주소 클레임·요청/응답·물리 규격·상호운용 시험을 통과해야 한다.

### J1939와 같은 점, 다른 점

| | J1939 | NMEA 2000 |
|---|---|---|
| 데이터링크 | 29비트 CAN, PGN/SA | 같음 |
| 속도 | 250k(J1939-11), 500k(J1939-14) | 250k 고정 |
| PGN 사전 | J1939-71(트럭·건설기계) | NMEA 2000 PGN 표(선박) |
| 주소 클레임 | PGN 60928 | 같은 PGN 60928을 사용 |
| 큰 메시지 | TP.CM/TP.DT(최대 1785바이트) | fast packet(최대 223바이트) |
| 물리·커넥터 | 차량용 커넥터·배선 | M12 5핀·백본/드롭, 전원 공급 |
| 인증 | SAE 적합성 | NMEA 인증 |

**가장 중요한 함정은 PGN 번호의 재사용이다.** 둘 다 "PGN"이라는 말을 쓰지만, 같은 숫자가 같은 의미라는 보장이 없다. J1939 PGN 61444(EEC1)와 NMEA 2000 PGN 127488(Engine Parameters, Rapid Update)은 서로 다른 사전의 항목이다. NMEA 2000 장비를 J1939 DBC로 디코딩하면 숫자는 나오지만 의미는 틀린다.

### 대표 PGN

다음은 canboat의 공개 PGN 정의에서 확인한 예이다.

| PGN | 이름 | 길이 | 내용 |
|---:|---|---:|---|
| 60928 | ISO Address Claim | 8 | 주소 클레임(NAME) |
| 127250 | Vessel Heading | 8 | 선수 방향. 0.0001 rad/bit |
| 129025 | Position, Rapid Update | 8 | 위도·경도. 1e-7도/bit, 32비트 signed |
| 129029 | GNSS Position Data | fast packet | 날짜·시각·위도·경도·고도·위성 수 |
| 127488 | Engine Parameters, Rapid Update | 8 | 엔진 회전수·부스트 |
| 127489 | Engine Parameters, Dynamic | 26 (fast packet) | 오일·냉각수·연료 압력 등 |

예를 들어 PGN 127250의 8바이트는 다음과 같다.

```text
바이트 1: SID
바이트 2-3: Heading (0.0001 rad/bit, unsigned)
바이트 4-5: Deviation (0.0001 rad/bit, signed)
바이트 6-7: Variation (0.0001 rad/bit, signed)
바이트 8: Reference(2비트) + reserved(6비트)
```

### Fast packet

NMEA 2000은 일반 응용 메시지에 J1939 TP 대신 **fast packet**을 쓴다. 일부 ISO 계열 PGN은 ISO 11783-3 TP를 쓰므로, 장비 문서에서 해당 PGN의 전송 형식을 확인한다.

- 첫 프레임: 1바이트 제어 + 1바이트 총 길이 + 최대 6바이트 데이터
- 연속 프레임: 1바이트 제어 + 최대 7바이트 데이터
- 제어 바이트의 상위 3비트는 시퀀스 카운터, 하위 5비트는 프레임 카운터다.
- 최대 `6 + 31×7 = 223`바이트다.
- ACK가 없다. 손실되면 다음 전송을 기다린다.

fast packet은 J1939 TP보다 단순하지만, **프레임 순서와 시퀀스 카운터를 직접 관리**해야 한다. canboat 같은 공개 구현도 순서가 뒤바뀐 프레임을 휴리스틱으로 처리한다.

## 25.7 가상 버스 실습

### CANopen: SDO 읽기와 NMT

`canopen` 파이썬 패키지는 가상 버스에서 LocalNode/RemoteNode를 만들 수 있다. 아래 예는 노드 5의 객체 `0x1000`을 SDO로 읽고, NMT로 Operational 상태로 바꾼 뒤, TPDO1 프레임을 해석한다.

```python
import time
import can
import canopen
from canopen.objectdictionary import Variable, UNSIGNED16, UNSIGNED32


def make_od():
    od = canopen.ObjectDictionary()
    dev = Variable("Device type", 0x1000)
    dev.data_type = UNSIGNED32
    dev.access_type = "ro"
    dev.value = 0x00020191
    od.add_object(dev)

    hb = Variable("Producer heartbeat time", 0x1017)
    hb.data_type = UNSIGNED16
    hb.access_type = "rw"
    hb.value = 100
    od.add_object(hb)
    return od


channel = "canopen-demo"
server_net = canopen.Network()
server_net.connect(interface="virtual", channel=channel)
local = canopen.LocalNode(5, make_od())
server_net.add_node(local)

client_net = canopen.Network()
client_net.connect(interface="virtual", channel=channel)
remote = canopen.RemoteNode(5, make_od())
client_net.add_node(remote)

sniffer = can.Bus(interface="virtual", channel=channel)
local.nmt.state = "PRE-OPERATIONAL"
print("NMT:", local.nmt.state)

print("SDO 0x1000:", hex(remote.sdo[0x1000].raw))

client_net.send_message(0x000, [0x01, 0x05])  # start node 5
time.sleep(0.2)
print("NMT:", local.nmt.state)

# TPDO1: 온도 300(0.1 C), 압력 1000(0.1 kPa)
pdo = (300).to_bytes(2, "little", signed=True) + (1000).to_bytes(2, "little")
print("TPDO1 0x185:", pdo.hex(" ").upper())
print("temp", int.from_bytes(pdo[0:2], "little", signed=True) / 10,
      "C, pressure", int.from_bytes(pdo[2:4], "little") / 10, "kPa")

sniffer.shutdown()
server_net.disconnect()
client_net.disconnect()
```

실행하면 SDO 요청·응답이 `0x605`/`0x585`로 오가고, 하트비트가 `0x705`로 보인다.

```text
NMT: PRE-OPERATIONAL
SDO 0x1000: 0x20191
NMT: OPERATIONAL
TPDO1 0x185: 2C 01 E8 03
temp 30.0 C, pressure 100.0 kPa
```

- `0x20191`은 `0x00020191`과 같다. 앞의 0은 표시에서 생략된다.
- TPDO1의 COB-ID는 `0x180 + 5 = 0x185`다. 매핑은 객체 `0x1A00`에 정의되어 있다고 가정했다.
- 실제 장비에서는 NMT 상태를 바꾸기 전에 장비 문서와 안전 절차를 확인한다. 가상 버스가 아닌 곳에서 무단 NMT 전환은 위험하다.

### NMEA 2000: PGN 127250 해석

```python
import can

def nmea_id(priority, pgn, sa):
    return (priority << 26) | ((pgn & 0x3FFFF) << 8) | sa

bus = can.Bus(interface="virtual", channel="nmea-demo",
              receive_own_messages=True)
# 90.0000도 = 1.5708 rad -> raw 15708
raw = round(1.5708 / 0.0001)
data = bytes([0x00, raw & 0xFF, raw >> 8, 0, 0, 0, 0, 0])
bus.send(can.Message(arbitration_id=nmea_id(2, 0x1F112, 0x23),
                     data=data, is_extended_id=True))
got = bus.recv(timeout=1.0)
pgn = (got.arbitration_id >> 8) & 0x3FFFF
heading = int.from_bytes(got.data[1:3], "little") * 0.0001
print(pgn, f"{heading:.4f} rad = {heading * 180 / 3.141592653589793:.2f} deg")
bus.shutdown()
```

```text
127250 1.5708 rad = 90.00 deg
```

- `0x1F112`가 PGN 127250이다. CAN ID `0x09F11223`은 priority 2, PGN 127250, SA 0x23을 뜻한다.
- `is_extended_id=True`가 필요하다.
- fast packet은 첫 프레임의 총 길이와 프레임 카운터를 보고 재조립한다. 43바이트 예제라면 첫 프레임 1개와 연속 프레임 6개, 총 7프레임이 된다.

## 25.8 흔한 실수

| 증상 | 원인 | 확인 |
|---|---|---|
| SDO가 응답하지 않는다 | NMT가 Stopped이거나 노드 ID가 틀림 | `0x600+ID`/`0x580+ID`, NMT 상태 |
| PDO가 안 온다 | 매핑·전송 형식·NMT 상태 | `0x1A00`, transmission type, Operational |
| SDO Abort `0x06020000` | 객체 사전에 없는 index | EDS와 index/subindex 확인 |
| SDO Abort `0x06010002` | 읽기 전용에 쓰기 | 접근 권한 확인 |
| 온도가 10배 틀린다 | 0.1°C 해상도를 빠뜨림 | `raw / 10` |
| 하트비트가 끊긴다 | 주기·케이블·노드 리셋 | `0x1017`, 버스 전원 |
| NMEA PGN이 이상하다 | J1939 PGN 사전으로 해석 | NMEA 2000 PGN 표 사용 |
| fast packet이 깨진다 | 시퀀스·프레임 카운터 무시 | 상위 3비트/하위 5비트 |
| NMEA 장비가 인증되지 않는다 | 물리·주소 클레임·PGN 시험 미통과 | NMEA 인증 요구사항 |

특히 **CANopen의 COB-ID를 "장치 주소"로만 보면 안 된다.** COB-ID에는 기능(PDO/SDO/NMT)과 노드 ID가 함께 들어간다. `0x185`는 "노드 5의 TPDO1"이지 "노드 0x185"가 아니다.

## 25.9 체크리스트

- [ ] 객체 사전의 index/subindex와 주요 범위를 설명할 수 있다.
- [ ] NMT 상태와 명령, 상태별 가능한 통신을 설명할 수 있다.
- [ ] SDO의 요청/응답 COB-ID와 expedited/segmented를 구분할 수 있다.
- [ ] SDO Abort code의 의미를 읽을 수 있다.
- [ ] PDO의 COB-ID·매핑·전송 형식을 설명할 수 있다.
- [ ] 하트비트와 EMCY의 역할을 구분할 수 있다.
- [ ] NMEA 2000이 J1939 데이터링크를 쓰지만 PGN 사전은 다르다는 점을 설명할 수 있다.
- [ ] fast packet의 프레임 구조와 최대 223바이트를 설명할 수 있다.
- [ ] 실제 장비에서는 읽기만 하고 NMT·SDO 쓰기를 하지 않는다.

## 장 요약

- CANopen은 11비트 CAN 위에서 객체 사전(OD)을 중심으로 동작한다. index 16비트, subindex 8비트다.
- NMT는 Initialisation/Pre-operational/Operational/Stopped 상태 기계다. 상태에 따라 SDO·PDO 사용 가능 여부가 달라진다.
- SDO는 `0x600+ID`/`0x580+ID`의 요청·응답이다. 4바이트 이하는 expedited, 초과는 segmented다.
- PDO는 `0x180+ID` 등으로 보내는 이벤트 스트림이다. 매핑·전송 형식·NMT 상태가 모두 맞아야 한다.
- 하트비트는 `0x700+ID`, EMCY는 `0x080+ID`다. 하트비트는 생존, EMCY는 오류를 알린다.
- NMEA 2000은 IEC 61162-3이며 J1939/ISO 11783 데이터링크를 쓴다. 250kbps, 50노드, 120Ω 종단, 29비트 PGN/SA다.
- NMEA 2000은 일반 응용 메시지에 fast packet을 쓴다. 최대 223바이트이고, 일부 ISO 계열 PGN은 ISO-TP를 쓴다.
- 같은 "PGN"이라도 J1939와 NMEA 2000의 사전은 다르다. DBC를 그대로 재사용하지 않는다.

## 연습 문제

### 1. NMT 상태

노드 7이 Pre-operational 상태다. 다음 명령을 보낸 뒤 각각 어떤 상태가 되는가?

```text
a) 0x000  01 07
b) 0x000  02 07
c) 0x000  80 07
```

### 2. SDO 프레임

노드 3의 객체 `0x1018` subindex `0x01`을 읽으려 한다. 요청 CAN ID와 첫 바이트를 쓰라. 응답이 `43 18 10 01 78 56 34 12`라면 값은 얼마인가?

### 3. PDO 매핑

TPDO1에 `0x2000/0x01`(16비트 온도, 0.1°C)와 `0x2000/0x02`(16비트 압력, 0.1kPa)를 매핑했다. TPDO1 프레임이 `2C 01 E8 03 00 00 00 00`일 때 온도와 압력을 계산하라.

### 4. NMEA 2000 PGN

NMEA 2000 PGN 127250 프레임의 heading 바이트가 `5C 3D`다. 방향을 라디안과 도로 계산하라. 이 PGN을 J1939 PGN 61444로 해석하면 왜 틀리는가?

### 5. fast packet

NMEA 2000 fast packet으로 43바이트를 보낸다. 총 프레임 수와 첫 프레임·연속 프레임의 데이터 바이트 수를 쓰라.

## 정답과 해설

### 1.

- a) `0x01` Start Remote Node → Operational
- b) `0x02` Stop Remote Node → Stopped
- c) `0x80` Enter Pre-operational → Pre-operational

NMT 명령은 CAN ID `0x000` **고정**으로 보내고, 데이터 두 번째 바이트가 노드 ID다. 노드 7이면 `01 07`, `02 07`, `80 07`처럼 보낸다. Stopped에서는 SDO·PDO가 동작하지 않으므로, 설정을 바꾸려면 Pre-operational로 돌아와야 한다.

### 2.

요청 CAN ID는 `0x600 + 3 = 0x603`이고, 첫 바이트는 `0x40`(upload request)이다. index/subindex는 리틀 엔디언으로 `18 10 01`이다.

```text
603  40 18 10 01 00 00 00 00
```

응답 `43 18 10 01 78 56 34 12`에서 명령 `0x43`은 expedited 4바이트 upload response다. 데이터 `78 56 34 12`는 리틀 엔디언으로 `0x12345678`이다.

### 3.

- 온도: `2C 01` = `0x012C` = 300 → `300 / 10 = 30.0°C`
- 압력: `E8 03` = `0x03E8` = 1000 → `1000 / 10 = 100.0 kPa`

PDO는 매핑된 순서대로 값이 이어지고, 각 값은 리틀 엔디언이다. 매핑을 모르면 바이트를 해석할 수 없다.

### 4.

`5C 3D`는 리틀 엔디언으로 `0x3D5C = 15708`이다. 해상도가 0.0001 rad/bit이므로 `15708 × 0.0001 = 1.5708 rad`이고, `1.5708 × 180 / π ≈ 90.00°`다.

J1939 PGN 61444는 EEC1(엔진 회전수·토크)이고, NMEA 2000 PGN 127250은 Vessel Heading이다. 숫자 61444와 127250은 서로 다른 사전의 항목이므로, 같은 29비트 ID 구조를 써도 PGN 번호의 의미는 공유되지 않는다. NMEA 2000 장비는 NMEA PGN 표로 디코딩해야 한다.

### 5.

- 총 프레임 수: 첫 프레임 1개 + 연속 프레임 6개 = **7개**.
- 첫 프레임: 제어 1바이트 + 길이 1바이트 + 데이터 6바이트.
- 연속 프레임: 제어 1바이트 + 데이터 7바이트. 마지막 프레임은 남는 바이트를 채운다.
- 43바이트 = 6 + 7×5 + 2이므로, 마지막 연속 프레임에는 2바이트 데이터와 5바이트 패딩이 들어간다.
