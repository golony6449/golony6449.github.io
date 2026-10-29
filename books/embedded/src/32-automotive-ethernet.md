# 32장 차량 이더넷과 DoIP·SOME/IP

## 이 장에서

30장의 CAN FD는 버스의 대역폭을 늘렸고, 31장의 LIN은 값싼 액추에이터를 묶었다. 하지만 카메라 영상, 레이다 포인트 클라우드, 중앙 컴퓨터와의 OTA 업데이트는 CAN FD로도 감당하기 어렵다. 그래서 차량 안에 **이더넷**이 들어왔다. 차량 이더넷은 사무실의 이더넷과 같은 IP/TCP/UDP 세계를 쓰지만, **한 쌍의 꼬임선**으로 100Mbps~1Gbps를 보내고, 스위치로 점대점 링크를 연결하며, 차량용 커넥터와 EMC 조건을 따른다.

웹 개발자에게 이 구조는 낯설지 않다. CAN이 허브에 여러 노드가 매달린 공유 버스라면, 차량 이더넷은 **스위치 기반 LAN**이다. 그 위에 DoIP는 "진단용 REST over TCP"처럼, SOME/IP는 "gRPC + 서비스 디스커버리 + pub/sub"처럼 올라간다. HTTP/1.1·HTTP/2·WebSocket·메시지 큐가 목적별로 공존하듯, 차 안에서도 클래식 CAN·CAN FD·LIN·FlexRay·이더넷이 **목적과 비용에 따라** 공존한다.

이 장은 차량 이더넷의 물리 계층과 토폴로지, 도메인·존 아키텍처, DoIP로 UDS를 IP 위에서 주고받는 구조, SOME/IP의 서비스·메서드·이벤트와 서비스 디스커버리를 다룬다. DoIP 헤더는 파이썬으로 만들어 **127.0.0.1 루프백에서만** 주고받아 확인한다. 2019 쏘렌토 UM의 진단은 CAN 기반이라는 점을 다시 확인하고, 실차 이더넷 진단 포트는 다루지 않는다.

이 장에서 다루는 것:

- 차량 이더넷이 필요한 이유와 100BASE-T1·1000BASE-T1·10BASE-T1S
- 스위치 기반 토폴로지, VLAN·QoS·TSN
- 도메인 아키텍처에서 존 아키텍처로의 변화와 중앙 게이트웨이
- DoIP(ISO 13400-2)의 8바이트 헤더, 차량 탐색, 라우팅 활성화, 진단 메시지
- SOME/IP의 16바이트 헤더, 메서드·이벤트·필드, 서비스 디스커버리
- 고전 CAN·CAN FD·LIN·FlexRay·이더넷의 비교와 웹 대응
- 2019 쏘렌토의 CAN 기반 진단과 이 장의 경계

## 32.1 왜 차량 이더넷인가

차량의 데이터 양은 기능마다 다르다. TI의 존 아키텍처 자료는 대략적인 대역폭 요구를 다음과 같이 정리한다.

| 기능 | 대략적인 대역폭 |
|---|---:|
| 바디 제어 | ≤10Mbps |
| 레이다 | 0.1~15Mbps |
| 라이다 | 20~100Mbps |
| 카메라 | 500Mbps~3.5Gbps |

- 클래식 CAN은 1Mbps, CAN FD는 데이터 구간 5~8Mbps다. 카메라 원본 영상을 싣기에는 부족하다.
- CAN FD의 64바이트 프레임도 수천 바이트의 이미지 프레임을 나누어 보내기에는 오버헤드가 크다.
- OTA 업데이트·진단 로그·중앙 컴퓨트와의 데이터 교환도 대역폭을 요구한다.
- 그래서 **센서·카메라·중앙 컴퓨터**는 이더넷으로, **파워트레인·샤시**는 CAN/CAN FD로, **창문·시트**는 LIN으로 나누는 계층 구조가 자연스러워졌다.

차량 이더넷은 사무실 이더넷과 같지 않다.

- **100BASE-T1**은 한 쌍의 꼬임선으로 100Mbps를 보낸다. 사무실의 100BASE-TX는 두 쌍을 쓴다.
- 케이블 길이는 15m(Type A) 안팎이고, 차량용 커넥터·EMC·온도 조건을 따른다. 사무실처럼 100m를 끌지 않는다.
- 링크는 보통 **스위치**로 점대점 연결한다. CAN처럼 한 쌍의 선을 모든 노드가 공유하지 않는다(10BASE-T1S는 예외).
- IP·TCP·UDP·VLAN·TSN을 쓸 수 있지만, 차량용 PHY와 전원·웨이크 조건이 다르다.
- RJ45 커넥터를 그대로 쓰지 않는다. 차량용 커넥터와 하네스가 따로 있다.

> 2019 쏘렌토 UM 2.2 디젤의 OBD-II 포트에서 확인된 것은 **클래식 CAN 11비트 500kbps**다(실차 기록). 이 차의 내부 백본이 이더넷인지, OBD 포트에 이더넷 진단 핀이 있는지는 확인하지 않았다. 이 책은 실차 이더넷 진단 포트를 다루지 않는다.

## 32.2 물리 계층과 토폴로지

차량 이더넷의 대표적인 PHY는 다음과 같다.

| PHY | 표준 | 속도 | 케이블 | 거리 | 토폴로지 |
|---|---|---:|---|---:|---|
| 100BASE-T1 | IEEE 802.3bw | 100Mbps | 단일 꼬임쌍 | 15m(Type A), 40m(Type B) | 점대점 |
| 1000BASE-T1 | IEEE 802.3bp | 1Gbps | 단일 꼬임쌍 | 15m(Type A), 40m(Type B) | 점대점 |
| 10BASE-T1S | IEEE 802.3cg | 10Mbps | 단일 꼬임쌍 | 15m(점대점), 25m(멀티드롭) | 점대점 또는 버스 |
| 100BASE-TX | IEEE 802.3 | 100Mbps | 2쌍 | 100m | 점대점 |

- **100BASE-T1/1000BASE-T1**은 전이중 통신이다. 한 쌍으로 송수신을 동시에 한다.
- **10BASE-T1S**는 저속 엔드포인트를 위한 멀티드롭 버스다. 한 세그먼트에 8개 이상의 노드를 붙일 수 있고, **PLCA(Physical Layer Collision Avoidance)** 로 충돌을 피한다. CAN/LIN을 대체할 수 있는 저가 이더넷으로 거론된다.
- 10BASE-T1S의 멀티드롭은 CAN처럼 선을 공유하지만, 프레임 형식과 접근 방식은 이더넷이다.

### 스위치와 TSN

CAN은 버스 위에서 모든 노드가 프레임을 듣는다. 차량 이더넷은 스위치가 링크별로 프레임을 전달한다.

- 스위치는 목적지 MAC 주소를 보고 해당 포트로만 프레임을 보낸다. 브로드캐스트·멀티캐스트는 여러 포트로 복사한다.
- 링크별 전이중이라 충돌 도메인이 없다. CAN의 중재 같은 것이 필요 없다.
- **VLAN**으로 논리적 네트워크를 나눌 수 있다. 진단·인포테인먼트·ADAS를 같은 물리 스위치 위에서 분리한다.
- **QoS**로 우선순위를 줄 수 있다. 하지만 기본 이더넷은 **best-effort**다. 혼잡하면 지연·드롭이 생긴다.
- **TSN(Time-Sensitive Networking)** 은 시간 동기(802.1AS), 예약 트래픽(802.1Qbv), 스트림 필터링(802.1Qci) 등으로 지연을 제한한다. TSN을 켜지 않으면 결정성은 CAN보다 낮다.
- CAN의 우선순위 중재는 "낮은 ID가 먼저"라는 단순한 규칙이지만, 이더넷 QoS는 스위치 설정·VLAN·트래픽 클래스·스케줄러에 의존한다. 설정이 틀리면 우선순위가 적용되지 않는다.

## 32.3 도메인·존 아키텍처와 중앙 게이트웨이

차량 전자 구조는 대략 세 단계로 발전해 왔다.

1. **분산 아키텍처**: 기능별 ECU가 각자의 CAN 버스에 붙고, 필요하면 중앙 게이트웨이가 버스를 잇는다.
2. **도메인 중앙집중**: 파워트레인·샤시·바디·인포테인먼트·ADAS 도메인별로 ECU를 묶고, 도메인 컨트롤러와 중앙 게이트웨이가 CAN·이더넷을 혼합해 연결한다.
3. **존 아키텍처**: ECU를 기능이 아니라 **차량의 물리적 위치(전·후·좌·우)** 로 묶는다. 존 컨트롤러가 해당 구역의 I/O를 모으고, 이더넷 백본으로 중앙 컴퓨터에 연결한다.

존 아키텍처의 목적은 **배선 하네스 단순화**와 **소프트웨어 정의 차량**이다. 기능이 바뀌어도 물리 배선을 다시 깔지 않고, 존 컨트롤러와 중앙 컴퓨터의 소프트웨어를 바꿔 대응한다. 대신 중앙 컴퓨터·백본·스위치에 장애가 몰리지 않도록 이중화·격리·QoS를 설계해야 한다.

```text
                 ┌──────────────────────────┐
                 │   중앙 컴퓨터 / 게이트웨이  │
                 │  CAN·LIN·Ethernet 라우팅   │
                 └───────┬─────────┬────────┘
                         │ Ethernet│
          ┌──────────────▼──┐   ┌──▼──────────────┐
          │ 전방 존 컨트롤러  │   │ 후방 존 컨트롤러  │
          │ 카메라·레이다     │   │ 램프·도어·시트    │
          └────────┬─────────┘   └────────┬─────────┘
                   │ CAN/LIN               │ LIN
              파워트레인 ECU           액추에이터
```

- 중앙 게이트웨이는 **도메인 사이의 라우터**다. CAN 프레임을 이더넷으로, 이더넷의 DoIP 진단을 CAN의 UDS로 변환한다.
- 게이트웨이는 **진단 방화벽**의 집행점이 된다. OBD 포트·정비 도구가 접근할 수 있는 ECU·서비스·세션을 제한한다.
- 도메인·존 분리는 보안의 **심층 방어**이기도 하다. 인포테인먼트 침해가 파워트레인 버스로 바로 번지지 않게 한다.
- 웹의 API 게이트웨이·서비스 메시와 비슷하지만, 차량에서는 **실시간성·안전·fail-operational**이 추가 요구사항이다. 게이트웨이가 죽으면 차가 멈출 수 있다.

## 32.4 DoIP: IP 위의 UDS

DoIP(Diagnostics over IP)는 ISO 13400-2로 표준화된 **IP 기반 진단**이다. 진단 도구(tester)와 차량의 DoIP 엔티티가 TCP/UDP로 통신하고, 그 안에 UDS 메시지를 싣는다. CAN의 ISO-TP가 하던 일을 IP가 대신하는 셈이다.

- 포트는 **UDP/TCP 13400**을 쓴다. 차량 탐색은 UDP, 진단 세션은 보통 TCP다.
- 논리 주소(logical address)는 2바이트다. CAN의 7E0/7E8 같은 주소 대신, DoIP 엔티티와 ECU를 논리 주소로 구분한다.
- UDS 메시지는 그대로 실린다. `22 F1 87`은 여전히 `22 F1 87`이고, 응답 `62 F1 87 ...`도 그대로다.
- 진단 도구는 먼저 차량을 찾고(vehicle discovery), TCP 연결을 연 뒤 **라우팅 활성화(routing activation)** 를 해야 진단 메시지를 보낼 수 있다.

### 8바이트 헤더

DoIP의 모든 메시지는 8바이트 고정 헤더로 시작한다.

| 필드 | 크기 | 내용 |
|---|---:|---|
| Protocol Version | 1바이트 | 프로토콜 버전 |
| Inverse Protocol Version | 1바이트 | 버전의 비트 반전 |
| Payload Type | 2바이트 | 메시지 종류 |
| Payload Length | 4바이트 | 헤더 뒤 payload 길이 |

- `Inverse Protocol Version`은 `0xFF - version`이다. 버전 바이트가 깨졌는지 싼 값으로 확인한다.
- `Payload Length`는 **8바이트 헤더를 제외한** 길이다.
- 버전 값은 `0x01`(ISO/DIS 13400-2:2010), `0x02`(ISO 13400-2:2012), `0x03`(ISO 13400-2:2019)이다. 차량 탐색 요청처럼 버전을 모를 때는 `0xFF`를 쓸 수 있다.
- 페이로드 타입은 다음과 같다.

| 값 | 이름 | 전송 |
|---:|---|---|
| `0x0001` | Vehicle Identification Request | UDP |
| `0x0002` | Vehicle Identification Request with EID | UDP |
| `0x0003` | Vehicle Identification Request with VIN | UDP |
| `0x0004` | Vehicle Announcement / Identification Response | UDP |
| `0x0005` | Routing Activation Request | TCP |
| `0x0006` | Routing Activation Response | TCP |
| `0x0007` | Alive Check Request | TCP |
| `0x0008` | Alive Check Response | TCP |
| `0x4001` | Entity Status Request | UDP |
| `0x4002` | Entity Status Response | UDP |
| `0x8001` | Diagnostic Message | TCP |
| `0x8002` | Diagnostic Message Positive Ack | TCP |
| `0x8003` | Diagnostic Message Negative Ack | TCP |

### 차량 탐색

진단 도구는 먼저 같은 네트워크의 DoIP 엔티티를 찾는다.

1. UDP 13400으로 **Vehicle Identification Request**(`0x0001`)를 보낸다. 페이로드는 비어 있다.
2. 차량이 **Vehicle Announcement / Identification Response**(`0x0004`)로 응답한다.

응답 페이로드에는 다음이 들어 있다.

| 필드 | 크기 |
|---|---:|
| VIN | 17바이트 |
| Logical Address | 2바이트 |
| EID(Entity Unique ID) | 6바이트 |
| GID(Group Unique ID) | 6바이트 |
| Further Action Required | 1바이트 |
| VIN/GID Sync Status(선택) | 1바이트 |

- EID는 보통 엔티티의 MAC 주소다. GID는 같은 그룹의 엔티티를 묶는다.
- VIN은 개인정보이므로 로그·화면·공개 자료에 남기지 않는다. 이 장의 예제는 **가짜 VIN**을 쓴다.
- `0x0002`는 EID로, `0x0003`은 VIN으로 특정 차량을 찾는다. 실제 차량에서는 남의 VIN을 질의하지 않는다.

### 라우팅 활성화

TCP 연결을 연 뒤에는 **Routing Activation Request**(`0x0005`)를 보낸다. 이 단계가 없으면 진단 메시지(`0x8001`)는 거부된다.

요청 페이로드:

| 필드 | 크기 |
|---|---:|
| Source Address(테스터 논리 주소) | 2바이트 |
| Activation Type | 1바이트 |
| Reserved | 4바이트 |
| OEM Reserved(선택) | 4바이트 |

응답 페이로드:

| 필드 | 크기 |
|---|---:|
| 테스터 논리 주소 | 2바이트 |
| DoIP 엔티티 논리 주소 | 2바이트 |
| Routing Activation Response Code | 1바이트 |
| Reserved | 4바이트 |
| OEM Reserved(선택) | 4바이트 |

응답 코드의 예:

| 코드 | 의미 |
|---:|---|
| `0x00` | 알 수 없는 source address |
| `0x01` | 모든 소켓이 이미 활성 |
| `0x02` | source address 불일치 |
| `0x03` | 다른 소켓에 이미 등록됨 |
| `0x04` | 인증 누락 |
| `0x05` | 확인 거부 |
| `0x06` | 지원하지 않는 activation type |
| `0x10` | 라우팅 활성화 성공 |
| `0x11` | 라우팅이 활성화될 예정 |

- `0x10`을 받아야 진단 메시지를 보낼 수 있다.
- `0x04`(인증 누락)는 게이트웨이가 추가 인증을 요구한다는 뜻이다. 이 책은 실제 차량에서 이 단계를 수행하지 않는다.
- 라우팅 활성화는 웹의 **세션 토큰 발급**과 비슷하다. 연결만 열었다고 모든 API를 쓸 수 있는 것이 아니다.

### 진단 메시지

라우팅이 활성화되면 **Diagnostic Message**(`0x8001`)로 UDS를 주고받는다.

| 필드 | 크기 |
|---|---:|
| Source Address | 2바이트 |
| Target Address | 2바이트 |
| UDS 데이터 | 0~n바이트 |

```text
tester ── 0x0001 (UDP) ──────────────▶ vehicle
       ◀─ 0x0004 (UDP, VIN/LA/EID) ──
       ── TCP 연결(13400) ───────────▶
       ── 0x0005 Routing Activation ─▶
       ◀─ 0x0006 code 0x10 ──────────
       ── 0x8001 SA=0x0E00 TA=0x1000, UDS 22 F1 87 ─▶
       ◀─ 0x8001 SA=0x1000 TA=0x0E00, UDS 62 F1 87 ... ─
```

- **Alive Check**(`0x0007`/`0x0008`)로 연결이 살아 있는지 확인한다.
- **Entity Status**(`0x4001`/`0x4002`)로 엔티티의 상태·최대 동시 연결 수 등을 읽는다.
- 진단 메시지의 긍정/부정 응답은 `0x8002`/`0x8003`이다. UDS의 `7F` 부정 응답과는 별개다.

### 2019 쏘렌토와 DoIP

- 2019 쏘렌토 UM 2.2 디젤의 OBD-II 진단은 **CAN 11비트 500kbps** 기반이다(실차 기록). 이 차에서 DoIP를 확인한 것은 아니다.
- OBD-II 16핀 커넥터의 3·8·11·12·13번 같은 핀이 제조사 재량으로 이더넷에 쓰일 수 있다는 이야기가 있지만, **핀 번호를 추측해 프로빙하지 않는다.** 차량마다 다르고, 잘못 연결하면 ECU를 손상시킬 수 있다.
- 이 책은 실차 이더넷 진단 포트를 다루지 않는다. DoIP 실습은 로컬 루프백에서만 한다.

## 32.5 파이썬으로 DoIP 헤더 주고받기 (루프백)

다음 예제는 DoIP 헤더를 만들고 해석하며, UDP 차량 탐색과 TCP 라우팅 활성화·진단 메시지를 **127.0.0.1에서만** 주고받는다. 실제 차량이나 외부 네트워크로 패킷을 보내지 않는다.

```python
import socket
import struct
import threading

HOST, PORT = "127.0.0.1", 13400
VERSION = 0x03          # ISO 13400-2:2019
INVERSE = 0xFF - VERSION

VEHICLE_ID_REQ = 0x0001
VEHICLE_ANNOUNCE = 0x0004
ROUTING_ACT_REQ = 0x0005
ROUTING_ACT_RES = 0x0006
DIAG_MSG = 0x8001


def pack_doip(payload_type: int, payload: bytes) -> bytes:
    return struct.pack(">BBHI", VERSION, INVERSE, payload_type, len(payload)) + payload


def unpack_doip(frame: bytes):
    version, inverse, payload_type, length = struct.unpack(">BBHI", frame[:8])
    if inverse != (0xFF - version):
        raise ValueError("protocol version/inverse mismatch")
    if len(frame) != 8 + length:
        raise ValueError("payload length mismatch")
    return version, payload_type, frame[8:]


def vehicle_announcement() -> bytes:
    vin = b"TESTCAR0000000000"          # 17바이트짜리 가짜 VIN
    logical_address = struct.pack(">H", 0x1000)
    eid = bytes.fromhex("02 00 00 00 00 01")
    gid = bytes(6)
    further_action = b"\x00"
    return vin + logical_address + eid + gid + further_action


def serve_udp():
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.bind((HOST, PORT))
        data, addr = s.recvfrom(2048)
        _, ptype, payload = unpack_doip(data)
        print("UDP request:", hex(ptype), "payload", len(payload), "bytes")
        s.sendto(pack_doip(VEHICLE_ANNOUNCE, vehicle_announcement()), addr)


def recv_exact(conn: socket.socket, n: int) -> bytes:
    buf = b""
    while len(buf) < n:
        chunk = conn.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("closed")
        buf += chunk
    return buf


def recv_doip(conn: socket.socket):
    header = recv_exact(conn, 8)
    length = struct.unpack(">I", header[4:8])[0]
    return unpack_doip(header + recv_exact(conn, length))


def serve_tcp():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind((HOST, PORT))
        s.listen(1)
        conn, _ = s.accept()
        with conn:
            _, ptype, payload = recv_doip(conn)
            tester_sa, act_type, reserved = struct.unpack(">HBI", payload)
            print("TCP routing activation:",
                  hex(ptype), f"SA=0x{tester_sa:04X}", f"type={act_type}", reserved)
            response = struct.pack(">HHBI", tester_sa, 0x1000, 0x10, 0)
            conn.sendall(pack_doip(ROUTING_ACT_RES, response))

            _, ptype, payload = recv_doip(conn)
            sa, ta, uds = struct.unpack(">HH", payload[:4]) + (payload[4:],)
            print("TCP diagnostic:", hex(ptype),
                  f"SA=0x{sa:04X} TA=0x{ta:04X}", "UDS", uds.hex(" "))
            uds_response = bytes.fromhex("62 F1 87 31 32 33")
            conn.sendall(pack_doip(DIAG_MSG, struct.pack(">HH", ta, sa) + uds_response))


for target in (serve_udp, serve_tcp):
    threading.Thread(target=target, daemon=True).start()

# 1) UDP로 차량을 찾는다.
with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
    s.settimeout(2.0)
    s.sendto(pack_doip(VEHICLE_ID_REQ, b""), (HOST, PORT))
    data, _ = s.recvfrom(2048)
    version, ptype, payload = unpack_doip(data)
    print("UDP response:", f"version=0x{version:02X}", hex(ptype),
          "VIN", payload[:17].decode(),
          "LA", f"0x{int.from_bytes(payload[17:19], 'big'):04X}")

# 2) TCP로 라우팅을 활성화하고 UDS를 한 번 주고받는다.
with socket.create_connection((HOST, PORT), timeout=2.0) as s:
    activation = struct.pack(">HBI", 0x0E00, 0x00, 0)
    s.sendall(pack_doip(ROUTING_ACT_REQ, activation))
    _, ptype, payload = recv_doip(s)
    tester_sa, entity_la, code, _ = struct.unpack(">HHBI", payload)
    print("routing response:", hex(ptype), f"tester=0x{tester_sa:04X}",
          f"entity=0x{entity_la:04X}", f"code=0x{code:02X}")

    s.sendall(pack_doip(DIAG_MSG, struct.pack(">HH", 0x0E00, 0x1000)
                        + bytes.fromhex("22 F1 87")))
    _, ptype, payload = recv_doip(s)
    sa, ta, uds = struct.unpack(">HH", payload[:4]) + (payload[4:],)
    print("diag response:", hex(ptype), f"SA=0x{sa:04X} TA=0x{ta:04X}",
          "UDS", uds.hex(" "))
```

실행 결과는 다음과 같다.

```text
UDP request: 0x1 payload 0 bytes
UDP response: version=0x03 0x4 VIN TESTCAR0000000000 LA 0x1000
TCP routing activation: 0x5 SA=0x0E00 type=0 0
routing response: 0x6 tester=0x0E00 entity=0x1000 code=0x10
TCP diagnostic: 0x8001 SA=0x0E00 TA=0x1000 UDS 22 f1 87
diag response: 0x8001 SA=0x1000 TA=0x0E00 UDS 62 f1 87 31 32 33
```

- `pack_doip`는 `>BBHI`로 빅 엔디언 헤더를 만든다. DoIP는 네트워크 바이트 순서를 쓴다.
- `unpack_doip`는 버전/반전 버전과 payload 길이를 검사한다. 길이가 맞지 않으면 즉시 거부한다.
- UDP 탐색은 "차량이 어디 있나"를 찾는 단계이고, TCP 진단은 "그 차량과 대화를 시작하겠다"는 단계다.
- 라우팅 응답 코드 `0x10`을 받은 뒤에야 `0x8001`을 보낸다. 이 순서를 지키지 않으면 실제 DoIP 엔티티는 진단 메시지를 거부한다.
- VIN은 예제용 가짜 값이다. 실제 차량 로그에서는 VIN을 지운다.

## 32.6 SOME/IP: 서비스·메서드·이벤트

SOME/IP(Scalable service-Oriented MiddlewarE over IP)는 AUTOSAR가 정의한 **서비스 지향 미들웨어**다. ECU가 제공하는 서비스를 서비스 ID로 식별하고, 메서드 호출·이벤트 알림·필드 접근을 UDP/TCP 위에서 주고받는다.

- **메서드(method)**: 요청/응답 RPC. `REQUEST` → `RESPONSE` 또는 `ERROR`.
- **이벤트(event)**: 서비스 제공자가 구독자에게 보내는 알림. `NOTIFICATION`.
- **필드(field)**: getter/setter/notifier를 묶은 개념. 값을 읽고 쓰고, 바뀌면 알림을 받는다.
- **서비스 디스커버리(SD)**: 어떤 서비스가 어느 인스턴스에서 제공되는지 찾고 구독한다. UDP 멀티캐스트를 쓴다.
- 직렬화는 HTTP의 JSON이 아니라 **바이너리**다. 필드 순서·엔디언·길이를 인터페이스 정의로 맞춘다.

### 16바이트 헤더

| 필드 | 크기 | 내용 |
|---|---:|---|
| Service ID | 2바이트 | 서비스 식별자 |
| Method ID | 2바이트 | 메서드 또는 이벤트 식별자 |
| Length | 4바이트 | Client ID부터 메시지 끝까지의 길이 |
| Client ID | 2바이트 | 요청한 클라이언트 |
| Session ID | 2바이트 | 요청/응답 상관자 |
| Protocol Version | 1바이트 | 현재 `0x01` |
| Interface Version | 1바이트 | 서비스 인터페이스의 주 버전 |
| Message Type | 1바이트 | 요청·응답·알림·오류 |
| Return Code | 1바이트 | 처리 결과 |

- `Length`는 **Client ID부터** 센다. 즉 `8 + payload 길이`다. 최소 8이다.
- 메서드 ID는 보통 `0x0000~0x7FFF`, 이벤트 ID는 상위 비트를 켠 `0x8000~0xFFFF`를 쓴다.
- `Session ID`는 요청과 응답을 짝지을 때 쓴다. `0`은 세션 관리를 끄는 값이고, 보통 `0x0001~0xFFFF`를 순환한다.
- 메시지 타입은 `0x00 REQUEST`, `0x01 REQUEST_NO_RETURN`, `0x02 NOTIFICATION`, `0x80 RESPONSE`, `0x81 ERROR`다. TP 플래그 `0x20`, ACK 플래그 `0x40`이 붙을 수 있다.
- 반환 코드는 `0x00 E_OK`, `0x01 E_NOT_OK`, `0x02 E_UNKNOWN_SERVICE`, `0x03 E_UNKNOWN_METHOD`, `0x04 E_NOT_READY`, `0x05 E_NOT_REACHABLE`, `0x06 E_TIMEOUT`, `0x07 E_WRONG_PROTOCOL_VERSION`, `0x08 E_WRONG_INTERFACE_VERSION`, `0x09 E_MALFORMED_MESSAGE`, `0x0A E_WRONG_MESSAGE_TYPE` 등이 있다.
- UDP payload는 0~1400바이트를 권장한다. 더 큰 메시지는 **SOME/IP-TP**로 나눈다. TP 헤더는 4바이트이고, 28비트 오프셋(16바이트 단위)과 more-segments 비트를 갖는다.

### 서비스 디스커버리

SOME/IP-SD는 서비스가 존재한다는 사실을 알리고 찾는 프로토콜이다.

- Service ID `0xFFFF`, Method ID `0x8100`을 쓴다. 메시지 타입은 `NOTIFICATION`, 반환 코드는 `E_OK`다.
- UDP 멀티캐스트를 쓰고, 관례적인 포트는 **30490**이다. 멀티캐스트 주소는 구성에 따라 다르다.
- 주요 엔트리는 `FindService`(`0x00`), `OfferService`(`0x01`), `SubscribeEventgroup`(`0x06`), `SubscribeEventgroupAck`(`0x07`)다.
- 각 엔트리는 서비스 ID·인스턴스 ID·주 버전·TTL·이벤트그룹 ID 등을 담는다. TTL이 지나면 구독이 만료된다.
- 서비스 제공자는 `OfferService`를 주기적으로 보내고, 클라이언트는 `FindService`로 찾거나 Offer를 받아 구독한다.

```text
provider ── OfferService(0x01, UDP 30490) ──▶ multicast
client   ── SubscribeEventgroup(0x06) ──────▶ provider
provider ── SubscribeEventgroupAck(0x07) ──▶ client
provider ── NOTIFICATION(event) ───────────▶ client
```

### 웹 개념과의 대응

| 웹 | SOME/IP | 닮은 점 | 다른 점 |
|---|---|---|---|
| REST `GET /resource` | 메서드 `REQUEST`/`RESPONSE` | 요청/응답, 서비스 경로 | HTTP 상태 코드 대신 Return Code, JSON 대신 바이너리 |
| gRPC | 메서드 + Interface Version | RPC, 버전 관리, 직렬화 | HTTP/2가 아니라 UDP/TCP 위 자체 헤더 |
| WebSocket/SSE | 이벤트 `NOTIFICATION` | 서버→클라이언트 push | 구독은 SD의 Eventgroup으로 관리 |
| MQTT pub/sub | 이벤트 + SD | 발행/구독 | 브로커가 없고, 서비스 제공자가 직접 보낸다 |
| 서비스 레지스트리(Consul/k8s DNS) | SOME/IP-SD | 서비스 발견, TTL | 멀티캐스트 Offer/Find, 인스턴스 ID |
| API 버전 | Interface Version | 호환성 관리 | 1바이트 주 버전, 메서드 ID 공간과 함께 관리 |
| 메시지 큐 | SOME/IP-TP | 큰 메시지 분할 | 16바이트 단위 오프셋, UDP 손실 고려 |

SOME/IP는 "HTTP를 조금 바꾼 것"이 아니다. **헤더 길이·길이 필드의 기준·세션 ID·서비스 디스커버리**가 모두 다르다. 웹 개발자가 익숙한 JSON·HTTP 상태 코드·URL 경로를 그대로 가져오면 안 된다.

## 32.7 파이썬으로 SOME/IP 헤더 해석하기

다음 예제는 SOME/IP 헤더를 만들고 해석한다. 네트워크로 보내지 않고 바이트 배열만 다룬다.

```python
import struct

REQUEST, REQUEST_NO_RETURN, NOTIFICATION = 0x00, 0x01, 0x02
RESPONSE, ERROR = 0x80, 0x81
E_OK, E_UNKNOWN_SERVICE, E_UNKNOWN_METHOD = 0x00, 0x02, 0x03


def pack_someip(service_id, method_id, client_id, session_id,
                message_type, return_code, payload=b"", interface_version=1):
    # Length는 Client ID부터 메시지 끝까지 센다. 즉 8 + payload 길이.
    length = 8 + len(payload)
    return struct.pack(">HHIHHBBBB",
                       service_id, method_id, length,
                       client_id, session_id,
                       0x01, interface_version, message_type, return_code) + payload


def unpack_someip(frame: bytes):
    if len(frame) < 16:
        raise ValueError("SOME/IP header is 16 bytes")
    (service_id, method_id, length, client_id, session_id,
     protocol_version, interface_version, message_type, return_code) = \
        struct.unpack(">HHIHHBBBB", frame[:16])
    if len(frame) != 8 + length:
        raise ValueError("Length does not match the frame")
    return {
        "service": service_id, "method": method_id,
        "client": client_id, "session": session_id,
        "protocol": protocol_version, "interface": interface_version,
        "type": message_type, "return": return_code,
        "payload": frame[16:],
    }


request = pack_someip(0x1234, 0x0001, 0x0001, 0x0001,
                      REQUEST, E_OK, bytes.fromhex("01 02 03 04"))
response = pack_someip(0x1234, 0x0001, 0x0001, 0x0001,
                       RESPONSE, E_OK, bytes.fromhex("0A 0B 0C 0D"))
for name, frame in (("request", request), ("response", response)):
    msg = unpack_someip(frame)
    print(name, frame.hex(" "), msg)

# SOME/IP-SD: Service ID 0xFFFF, Method ID 0x8100, NOTIFICATION, UDP
sd_payload = bytes([0x80, 0, 0, 0]) + struct.pack(">I", 0) + struct.pack(">I", 0)
sd = pack_someip(0xFFFF, 0x8100, 0x0000, 0x0001, NOTIFICATION, E_OK, sd_payload)
msg = unpack_someip(sd)
print("SD", sd.hex(" "), "length field", int.from_bytes(sd[4:8], "big"))
```

실행 결과의 핵심은 다음과 같다.

```text
request 12 34 00 01 00 00 00 0c 00 01 00 01 01 01 00 00 01 02 03 04 ...
response ... 80 00 0a 0b 0c 0d ...
SD ff ff 81 00 00 00 00 14 00 00 00 01 01 01 02 00 ...
```

- 요청 프레임은 20바이트다. 헤더 16바이트 + payload 4바이트, Length 필드는 12다.
- 응답은 `Message Type`이 `0x80`으로 바뀌고, 같은 Session ID를 돌려준다.
- SD 프레임은 28바이트다. 헤더 16바이트 + SD payload 12바이트(플래그 1 + 예약 3 + 엔트리 배열 길이 4 + 옵션 배열 길이 4), Length 필드는 20이다.
- `Length`가 "헤더 전체 길이"나 "payload 길이"라고 생각하면 8바이트만큼 어긋난다. **Client ID부터** 센다는 점을 기억하자.

## 32.8 세대별 비교: 무엇을 어디에 쓰는가

8장은 차량 네트워크의 **지도**를, 29장은 OBD-II·UDS·J1939·CANopen·NMEA 2000 같은 **응용 계약**을 비교했다. 이 절은 그 사이의 **물리·링크 세대**를 비교한다.

| 네트워크 | 속도 | 페이로드 | 토폴로지 | 결정성 | 비용 | 전형적인 용도 | 웹 대응 |
|---|---:|---:|---|---|---|---|---|
| 클래식 CAN | 최대 1Mbps | 0~8B | 공유 버스, 다중 마스터 | ID 우선순위 중재, 최악 지연 분석 필요 | 낮음 | 파워트레인·샤시·바디·진단 | 공유 메시지 버스, 브로커 없는 pub/sub |
| CAN FD | 중재 ≤1Mbps, 데이터 5~8Mbps | 0~64B | 공유 버스, 다중 마스터 | 클래식과 같은 중재, 데이터 구간만 고속 | 중간 | 진단·업데이트·센서 융합 | 큰 프레임을 쓰는 같은 버스 |
| CAN XL | 데이터 20Mbps급 | 1~2048B | 공유 버스 | 중재 + 대형 프레임 | 중간~높음 | 백본·IP 연동 | IP 패킷을 싣는 버스 |
| LIN | 1~20kbps | 1~8B | 1 master + 15 slave | 마스터 스케줄(주기 고정) | 매우 낮음 | 창문·시트·미러·공조 | cron으로 도는 작은 폴링 표 |
| FlexRay | 최대 10Mbps/channel | 최대 254B | 버스·스타, 2 channel | TDMA 정적 구간 + 동적 구간 | 높음 | 고성능 샤시·ADAS(채택은 차종별) | 시간표 기반 실시간 버스 |
| 차량 이더넷 | 100Mbps~1Gbps(10BASE-T1S는 10Mbps) | IP 패킷 | 스위치 점대점(10BASE-T1S는 버스) | 기본 best-effort, TSN으로 제한 | 높음 | 카메라·레이다·중앙 컴퓨트·OTA·DoIP | 스위치 LAN, gRPC/REST/pub-sub |

- **비용**은 정성적 비교다. LIN은 노드당 부품·배선이 가장 싸고, 이더넷은 PHY·스위치·케이블·커넥터가 상대적으로 비싸다. 정확한 단가는 차종·공급망에 따라 다르다(`확인 필요`).
- **결정성**은 "최악 지연을 보장할 수 있는가"다. CAN은 우선순위 중재로 결정적이지만, 최악 지연을 계산하려면 트래픽 분석이 필요하다. LIN은 마스터 스케줄로 주기가 고정된다. FlexRay는 TDMA로 시간이 정해져 있다. 이더넷은 TSN을 켜야 지연이 제한된다.
- **FlexRay**는 ISO 17458로 표준화되었고, 10Mbps·2채널·TDMA 정적 구간·동적 구간을 갖는다. 고성능 샤시·ADAS에 쓰였지만, 이더넷과 CAN FD의 발전으로 채택은 차종마다 다르다(`확인 필요`). 이 책은 개념만 다룬다.
- **CAN XL**은 2048바이트와 IP 연동을 겨냥한다. FD를 즉시 대체하는 기술이 아니고, 차량·ECU·도구의 지원이 필요하다.

### 웹 대응표

| 웹 | 차량 네트워크 | 닮은 점 | 다른 점 |
|---|---|---|---|
| HTTP/1.1 | 클래식 CAN | 작은 메시지, 널리 쓰임 | 요청/응답이 아니라 ID 기반 broadcast |
| HTTP/2 | CAN FD | 프레임을 크게 묶어 효율 향상 | 같은 버스에서 클래식과 혼용하기 어렵다 |
| WebSocket | LIN event-triggered | 이벤트가 있을 때만 전송 | 슬레이브가 먼저 말할 수 없다 |
| 메시지 큐 | J1939/CANopen PDO | 주기·이벤트 발행 | 브로커가 없고, 주소·스케줄이 프로토콜에 있다 |
| 스위치 LAN | 차량 이더넷 | 점대점 링크, VLAN, QoS | 차량용 PHY·거리·EMC·TSN |
| REST/gRPC over VPN | DoIP | IP 위 진단, 세션·라우팅 | UDS payload, 논리 주소, 라우팅 활성화 |
| gRPC + 서비스 디스커버리 | SOME/IP | 서비스·메서드·이벤트, SD | 바이너리 헤더, UDP/TCP, TTL 기반 SD |
| API 게이트웨이 | 중앙 게이트웨이 | 라우팅·필터·인증 | 안전·실시간·fail-operational |

### 선택 기준

```text
1. 창문·시트·미러·공조 플랩인가?
   └─ 예: LIN

2. 파워트레인·샤시·바디의 제어 메시지인가?
   ├─ 8바이트로 충분: 클래식 CAN
   └─ 64바이트·빠른 데이터 구간이 필요: CAN FD

3. 카메라·레이다·라이다·중앙 컴퓨트·OTA인가?
   └─ 예: 차량 이더넷(100BASE-T1/1000BASE-T1/10BASE-T1S)

4. IP 위에서 UDS 진단을 하는가?
   └─ 예: DoIP

5. ECU 사이의 서비스 호출·이벤트인가?
   └─ 예: SOME/IP

6. 고성능 샤시·ADAS의 기존 FlexRay 네트워크인가?
   └─ 예: 차량 문서를 따르고, 새 설계라면 이더넷·CAN FD와 비교한다
```

- 이 흐름은 **새로 설계할 때**의 출발점이다. 기존 차량에서는 제조사 문서와 기존 버스가 우선한다.
- 한 차량에 여러 네트워크가 공존한다. 중앙 게이트웨이가 CAN·LIN·이더넷을 잇고, 진단·OTA·보안 정책을 집행한다.
- 2019 쏘렌토에서 확인된 것은 클래식 CAN 500kbps다. 이 차의 LIN·CAN FD·이더넷 구성은 확인하지 않았다.

## 32.9 흔한 실수

| 증상 | 원인 후보 | 확인 |
|---|---|---|
| OBD 포트에서 이더넷이 보인다고 가정 | 차량마다 진단 구조가 다름 | 차량 문서, 커넥터 핀 배치 |
| 모르는 핀을 프로빙 | ECU 손상 위험 | 6/14 CAN, 나머지는 제조사 재량 |
| 100BASE-T1을 100BASE-TX로 착각 | 쌍 수·거리·커넥터가 다름 | PHY 표준, 차량용 커넥터 |
| 케이블이 너무 김 | 15m/40m 제한 | 링크 길이, 타입 A/B |
| 링크가 안 올라옴 | 전원·접지·웨이크, PHY 설정 | 전원, 링크 상태, 스위치 설정 |
| VLAN이 안 먹음 | 스위치 포트 설정, 태깅 | VLAN ID, tagged/untagged |
| DoIP 메시지가 거부됨 | 라우팅 활성화 누락, 코드 `0x04` | `0x0005` → `0x0006`, 코드 확인 |
| DoIP 길이 오류 | payload 길이에 헤더를 포함 | 8바이트 헤더 제외 |
| VIN이 로그에 남음 | 차량 탐색 응답을 그대로 저장 | VIN 마스킹·삭제 |
| SOME/IP 길이가 8 어긋남 | Length 기준을 payload로 착각 | Client ID부터 센다 |
| Session ID 불일치 | 응답을 다른 요청과 매칭 | Session ID·Client ID |
| SD가 안 보임 | 멀티캐스트·포트·TTL | 30490, 멀티캐스트 주소, TTL |
| UDP 이벤트 유실 | UDP는 전달 보장 없음 | 재전송·TTL·최신값 정책 |
| SOME/IP에 인증이 있다고 가정 | 기본 SOME/IP에는 인증·암호화가 없음 | TLS/DTLS, SecOC, 게이트웨이 정책 |
| TSN이 자동으로 결정적이라 가정 | 기본은 best-effort | 802.1AS/Qbv 설정, 스위치 |

## 32.10 체크리스트

- [ ] 차량 이더넷과 사무실 이더넷(PHY·거리·커넥터)을 구분했는가
- [ ] 100BASE-T1/1000BASE-T1/10BASE-T1S의 속도·거리·토폴로지를 아는가
- [ ] 스위치·VLAN·QoS·TSN의 역할을 설명할 수 있는가
- [ ] 도메인·존 아키텍처와 중앙 게이트웨이의 역할을 아는가
- [ ] DoIP 헤더 8바이트와 payload 길이 기준을 맞췄는가
- [ ] 차량 탐색(UDP) → 라우팅 활성화(TCP) → 진단 메시지 순서를 지켰는가
- [ ] 라우팅 응답 코드 `0x10`을 확인했는가
- [ ] VIN을 로그·화면·공개 자료에서 제거했는가
- [ ] SOME/IP Length가 Client ID부터 시작함을 확인했는가
- [ ] 메서드·이벤트·세션 ID를 올바르게 매칭했는가
- [ ] SOME/IP-SD의 멀티캐스트·포트·TTL을 확인했는가
- [ ] SOME/IP에 기본 인증이 없다는 점을 알고 있는가
- [ ] 실제 차량의 이더넷 핀을 프로빙하지 않았는가
- [ ] DoIP·SOME/IP 실습은 로컬 루프백·가상 환경에서만 했는가

## 장 요약

- 차량 이더넷은 카메라·레이다·중앙 컴퓨트·OTA를 위해 100Mbps~1Gbps를 제공한다.
- 100BASE-T1/1000BASE-T1은 단일 꼬임쌍·15m(Type A)/40m(Type B), 10BASE-T1S는 10Mbps 멀티드롭·25m·PLCA다.
- 차량 이더넷은 스위치 기반 점대점 토폴로지이고, VLAN·QoS·TSN으로 트래픽을 분리·제한한다.
- 도메인 아키텍처에서 존 아키텍처로 이동하면서 중앙 게이트웨이와 이더넷 백본의 역할이 커졌다.
- DoIP는 ISO 13400-2의 IP 기반 진단이다. 8바이트 헤더, UDP/TCP 13400, 차량 탐색, 라우팅 활성화, 진단 메시지로 구성된다.
- DoIP의 진단 메시지는 UDS를 그대로 싣는다. 라우팅 활성화 코드 `0x10`을 받아야 진단 메시지를 보낼 수 있다.
- SOME/IP는 AUTOSAR의 서비스 지향 미들웨어다. 16바이트 헤더, 메서드·이벤트·필드, 서비스 디스커버리를 갖는다.
- SOME/IP의 Length는 Client ID부터 세고, SD는 Service ID `0xFFFF`·Method ID `0x8100`·UDP 30490을 쓴다.
- 고전 CAN·CAN FD·CAN XL·LIN·FlexRay·이더넷은 속도·토폴로지·결정성·비용이 다르며, 한 차량에서 목적별로 공존한다.
- 2019 쏘렌토의 진단은 클래식 CAN 500kbps다. 실차 이더넷 진단 포트는 이 책에서 다루지 않는다.
- 실제 차량의 이더넷·DoIP·SOME/IP에 임의 패킷을 보내지 않는다. 실습은 로컬 루프백과 가상 환경에서만 한다.

여기까지 읽었다면 차량 네트워크의 아래쪽(전기·CAN·LIN·이더넷)과 위쪽(OBD-II·UDS·J1939·CANopen·SOME/IP)을 한 번씩 만난 셈이다. 다음 장은 이 책을 어떻게 실습으로 이어 갈지, 무엇부터 손에 쥐고 어떤 순서로 익힐지를 정리한다.

## 연습 문제

### 1. (기초) DoIP 헤더

다음 바이트열을 해석하라.

```text
03 FC 80 01 00 00 00 07 0E 00 10 00 22 F1 87
```

1. 프로토콜 버전과 inverse 버전은?
2. payload type은 무엇인가?
3. payload 길이와 실제 payload는?
4. source address와 target address는?

### 2. (중급) 라우팅 활성화

1. DoIP에서 라우팅 활성화가 필요한 이유는 무엇인가?
2. 응답 코드 `0x10`과 `0x04`의 의미를 쓰라.
3. 라우팅 활성화를 건너뛰고 `0x8001`을 보내면 어떻게 되는가?

### 3. (중급) SOME/IP Length

SOME/IP 요청이 Service ID `0x1234`, Method ID `0x0001`, Client ID `0x0001`, Session ID `0x0001`, payload 4바이트다.

1. Length 필드 값은?
2. 전체 프레임 길이는?
3. 같은 요청에 대한 응답의 Message Type과 Session ID는?

### 4. (중급) PHY 선택

다음 요구에 가장 적합한 네트워크를 고르라.

1. 1Gbps 카메라 링크
2. 운전석 창문 모터
3. 2019 쏘렌토의 OBD-II 진단
4. 중앙 컴퓨터와 후방 존 컨트롤러 사이의 백본

### 5. (심화) 존 게이트웨이와 DoIP 보안

중앙 게이트웨이가 DoIP 진단을 CAN의 UDS로 라우팅한다. 외부 정비 도구가 OBD 포트로 접근한다고 할 때, 게이트웨이에서 제한할 항목을 네 가지 쓰고 이유를 설명하라.

## 정답과 해설

### 1.

1. 프로토콜 버전 `0x03`(ISO 13400-2:2019), inverse `0xFC`(`0xFF - 0x03`).
2. payload type `0x8001`(Diagnostic Message).
3. payload 길이 `0x00000007`(7바이트), payload는 `0E 00 10 00 22 F1 87`.
4. source address `0x0E00`, target address `0x1000`. UDS 데이터는 `22 F1 87`이다.

### 2.

1. TCP 연결만으로는 진단 권한이 생기지 않는다. 테스터의 논리 주소를 등록하고, 게이트웨이가 허용하는 진단 세션을 열어야 한다.
2. `0x10`은 라우팅 활성화 성공, `0x04`는 인증 누락이다. `0x04`를 받으면 추가 인증 없이 진단 메시지를 보낼 수 없다.
3. 실제 DoIP 엔티티는 라우팅이 활성화되지 않은 소켓의 진단 메시지를 거부하거나 무시한다. CAN의 ISO-TP처럼 "보냈는데 응답이 없다"로 보일 수 있다.

### 3.

1. Length는 Client ID부터 세므로 `8 + 4 = 12`(`0x0000000C`)다.
2. 헤더 16바이트 + payload 4바이트 = 20바이트다.
3. Message Type은 `0x80 RESPONSE`, Session ID는 요청과 같은 `0x0001`이다. Client ID도 같은 값을 쓴다.

### 4.

1. 1000BASE-T1(또는 100BASE-T1로 충분한 카메라 사양이면 100BASE-T1). 카메라 대역폭과 링크 거리를 확인한다.
2. LIN. 저속·저가 액추에이터이며 마스터가 주기적으로 폴링한다.
3. 클래식 CAN 11비트 500kbps(ISO 15765-4). 2019 쏘렌토에서 확인된 구성이다.
4. 1000BASE-T1 또는 100BASE-T1 이더넷 백본. 거리·대역폭·TSN 요구를 확인한다.

### 5.

예: ① 허용할 source address·논리 주소 범위를 제한한다(외부 도구가 임의 ECU에 접근하지 못하게). ② 허용할 UDS 서비스·세션을 제한한다(읽기 `0x22`·`0x19`만, 쓰기·루틴·보안 접근은 금지). ③ 라우팅 활성화에 인증을 요구하고, 실패·성공을 로그로 남긴다(코드 `0x04`, 이상 접근 탐지). ④ 진단 트래픽의 rate limit·동시 연결 수를 제한한다(버스·게이트웨이 과부하 방지). 여기에 VIN·위치 등 개인정보를 로그에서 제거하는 항목을 더할 수 있다.
