# 7장 OBD-II 실전: 쏘렌토에서 데이터 읽기

## 이 장에서

6장에서 OBD-II 포트가 차량 네트워크의 진단 창구라는 것을 보았다. 이 장에서는 실제로 포트에 어댑터를 꽂고, 엔진 회전수·차속·냉각수 온도를 읽고, 값을 계산하고, 웹 대시보드에 표시한다.

예시 차량은 **기아 쏘렌토 UM 2019년식 2.2 디젤**이다. 모든 실습은 **정차 상태의 읽기 전용**이다. 시동을 걸고 데이터를 읽는 것은 가능하지만, 차량을 움직이면서 노트북을 조작하지 않는다. 고장코드 삭제, 쓰기, 코딩, 액추에이터 구동은 하지 않는다.

이 장에서 다루는 것:

- 준비물과 안전 확인
- ELM327 연결, 포트·보율·프로토콜 확인
- Mode 01 PID 읽기와 값 계산
- PID 지원 비트마스크 해석
- DTC 읽기와 디코딩
- VIN·Calibration ID 읽기(개인정보 주의)
- 쏘렌토에서 확인된 값과 이상한 PID
- pyserial + Flask 웹 대시보드
- 문제 해결 체크리스트

## 7.1 준비물과 안전

### 준비물

| 준비물 | 비고 |
|---|---|
| ELM327 호환 어댑터 | USB 권장. Bluetooth/Wi-Fi는 지연·끊김이 더 많다 |
| 노트북 | USB 포트, 파이썬 3.10+, `uv` |
| 차량 | 쏘렌토 UM 2019 2.2 디젤(예시) |
| (선택) USB 절연기 | 노트북과 차량 접지 전위차 보호 |
| (선택) 퓨즈 달린 OBD 케이블 | 어댑터 전원 보호 |

### 안전 확인

- [ ] 차량을 안전한 곳에 정차했다
- [ ] 기어를 P(또는 N)에 두고 주차 브레이크를 걸었다
- [ ] 주행 중에는 노트북을 조작하지 않는다
- [ ] 시동 상태(OFF/ACC/ON/엔진 시동)를 기록한다
- [ ] 어댑터를 꽂기 전에 OBD 포트와 커넥터 상태를 확인한다
- [ ] 배터리 전압이 낮으면 장시간 실습하지 않는다
- [ ] 읽기 요청만 보낸다. `04`, `14`, `2E`, `2F`, `31`, `27`, `34`~`37`은 보내지 않는다

시동을 끈 상태(ACC/ON)에서는 응답하지 않는 ECU가 많다. 엔진 회전수는 엔진이 돌아야 의미가 있고, 일부 제조사 DID는 엔진이 돌 때만 응답한다. 반대로 시동을 걸면 배터리 전압이 13~14V대로 올라가고, 크랭킹 순간에는 전압이 떨어진다. **첫 연결은 시동을 끄고(ON) 포트와 어댑터를 확인한 뒤, 필요할 때 시동을 건다.**

## 7.2 연결과 첫 대화

### 포트 찾기

```bash
python -m serial.tools.list_ports -v
```

Windows에서는 `COM5`, Linux에서는 `/dev/ttyUSB0`, macOS에서는 `/dev/cu.usbserial-...` 같은 이름이 나온다. ELM327 클론은 CH340을 쓰는 경우가 많고, 재연결하면 COM 번호가 바뀔 수 있다.

```python
from serial.tools import list_ports

for p in list_ports.comports():
    print(p.device, "|", p.description, "|", p.hwid)
```

### 첫 명령

2장의 `Elm327` 클래스를 그대로 쓴다. 보율을 모르면 38400, 9600, 115200 순으로 `ATI`를 시도한다.

```python
elm = Elm327("COM5", baudrate=38400)
try:
    print(elm.command("ATZ", timeout=3))       # ['ELM327 v1.5'] 같은 버전
    print(elm.command("ATE0"))                 # ['OK']
    print(elm.command("ATL0"))
    print(elm.command("ATSP0", timeout=10))
    print(elm.command("ATDPN"))                # 예: ['A6']
    print(elm.command("ATRV"))                 # 예: ['12.4V']
    print(elm.command("0100"))                 # 예: ['41 00 BE 1F A8 13']
finally:
    elm.close()
```

- `ATZ`는 어댑터를 리셋한다. 응답이 `STOPPED`면 리셋이 실행되지 않았을 수 있으니 다시 시도한다.
- `ATE0`은 에코를 끈다. 스크립트에서 응답 파싱이 쉬워진다.
- `ATL0`은 LF를 끄고, `ATS0`은 공백을 끈다. 다만 `ATS0`을 쓰면 응답이 `410C1AF8`처럼 붙어 오므로 파서가 두 형식을 모두 처리해야 한다. 이 책의 대시보드는 공백을 그대로 두고 `ATS0`을 보내지 않는다.
- `ATSP0`는 프로토콜 자동 검색이다. 몇 초 걸릴 수 있다.
- `ATDPN`이 `A6`이면 ISO 15765-4 CAN 11비트 500k다. 쏘렌토에서 확인된 값이다.
- `ATRV`는 배터리 전압이다. 시동 OFF에서 12V 안팎, 시동 중 13~14V대가 나온다.

### PID 지원 비트마스크

`0100`은 "PID 01~20 중 무엇을 지원하는가"를 4바이트 비트마스크로 돌려준다. 응답 `41 00 BE 1F A8 13`을 풀어 보자.

```python
def supported_pids(mask: bytes, base: int = 0x00) -> list[int]:
    if len(mask) != 4:
        raise ValueError("PID 지원 마스크는 4바이트다")
    value = int.from_bytes(mask, "big")
    return [base + i + 1 for i in range(32) if value & (1 << (31 - i))]


mask = bytes.fromhex("BE 1F A8 13")
print([f"{pid:02X}" for pid in supported_pids(mask)])
# ['01', '03', '04', '05', '06', '07', '0C', '0D', '0E', '0F',
#  '10', '11', '13', '15', '1C', '1F', '20']
```

- 첫 비트(MSB)가 PID 01, 마지막 비트(LSB)가 PID 20이다.
- `20`이 지원 목록에 있으면 `0120`으로 다음 32개(PID 21~40)를 물을 수 있다.
- `40`, `60`도 같은 방식이다. 지원하지 않는 PID를 물으면 `NO DATA`가 오거나 응답이 없다.
- 쏘렌토 엔진(7E0)은 표준 PID 79개를 지원했다(실차 기록). 변속기(7E1)는 16개였고, 그중 `0xA4`(기어비)는 지원하지 않았다.

## 7.3 Mode 01: 현재 데이터 읽기

Mode 01은 현재 센서 값을 읽는다. 요청은 `01 <PID>` 두 바이트이고, 응답은 `41 <PID> <데이터...>`다. 데이터 길이와 공식은 PID마다 다르다.

| PID | 이름 | 데이터 | 공식 | 단위 |
|---|---|---|---|---|
| 04 | 계산된 엔진 부하 | 1바이트 A | A × 100 / 255 | % |
| 05 | 냉각수 온도 | 1바이트 A | A − 40 | °C |
| 0A | 연료 압력 | 1바이트 A | A × 3 | kPa |
| 0B | 흡기 매니폴드 절대압 | 1바이트 A | A | kPa |
| 0C | 엔진 회전수 | 2바이트 A,B | (256A + B) / 4 | rpm |
| 0D | 차속 | 1바이트 A | A | km/h |
| 0F | 흡기 온도 | 1바이트 A | A − 40 | °C |
| 10 | MAF 공기 유량 | 2바이트 A,B | (256A + B) / 100 | g/s |
| 11 | 스로틀 위치 | 1바이트 A | A × 100 / 255 | % |
| 1F | 시동 후 경과 시간 | 2바이트 A,B | 256A + B | s |
| 2F | 연료 탱크 수준 | 1바이트 A | A × 100 / 255 | % |
| 42 | 제어 모듈 전압 | 2바이트 A,B | (256A + B) / 1000 | V |
| 46 | 외기 온도 | 1바이트 A | A − 40 | °C |
| 49 | 가속 페달 위치 D | 1바이트 A | A × 100 / 255 | % |
| 5C | 엔진 오일 온도 | 1바이트 A | A − 40 | °C |

### 계산 예

```text
41 0C 1A F8   → (0x1A × 256 + 0xF8) / 4 = (26×256 + 248)/4 = 6904/4 = 1726 rpm
41 0D 50      → 0x50 = 80 km/h
41 05 7B      → 0x7B − 40 = 123 − 40 = 83 °C
41 11 40      → 0x40 × 100 / 255 = 64 × 100 / 255 ≈ 25.1 %
41 2F 80      → 0x80 × 100 / 255 ≈ 50.2 %
41 42 3A 98   → (0x3A × 256 + 0x98) / 1000 = 15000/1000 = 15.0 V
41 10 00 64   → (0×256 + 0x64)/100 = 1.00 g/s
41 46 73      → 0x73 − 40 = 115 − 40 = 75 °C
```

- `0C`는 빅엔디언 16비트다. `1A F8`을 리틀엔디언으로 읽으면 완전히 다른 값이 된다.
- `05`와 `0F`는 `A − 40`이다. 0이면 −40°C다. 값이 0으로 고정되어 있으면 센서가 없거나 응답이 무효일 수 있다.
- `42`는 0.001V 단위다. 12.4V = 12400 = `0x3070`이므로 `30 70`이다. `0x0C40`은 3136 → 3.136V이므로 헷갈리지 않는다.
- `2F`는 퍼센트다. 연료 탱크 용량을 곱하면 리터가 된다. 쏘렌토 계기판 DID `B002`는 리터를 직접 준다(8장).

### 여러 PID를 한 번에

CAN에서는 한 요청에 최대 6개 PID를 넣을 수 있다. ELM327 데이터시트 기준이다.

```text
>01 0C 0D 05 11 2F 42
00F
0: 41 0C 1A F8 0D 50
1: 05 7B 11 40 2F 80
2: 42 3A 98
```

- 응답은 요청한 순서와 다를 수 있다. **PID 번호로 찾아야 한다.**
- 응답 길이가 가변적이므로, PID별 데이터 길이를 알아야 다음 PID의 위치를 계산할 수 있다.
- 쏘렌토에서는 다중 PID 요청으로 7개 항목을 0.09~0.11초 주기로 읽었다(실차 기록). 단일 PID를 7번 요청하는 것보다 훨씬 빠르다.
- 초보자는 단일 PID부터 시작하고, 동작을 확인한 뒤 다중 PID로 최적화한다.

### 엔진 OFF/ON에 따라 달라지는 것

| PID | 엔진 OFF(ON) | 엔진 시동 | 비고 |
|---|---|---|---|
| 0C rpm | 0 | 실제 회전수 | 시동 전에는 0 |
| 0D 차속 | 0 | 0(정차) | 주행 중에만 변함 |
| 05 냉각수 | 냉간 온도 | 상승 | 시동 후 점점 올라감 |
| 42 전압 | 12V 안팎 | 13~14V대 | 크랭킹 순간 떨어짐 |
| 1F 경과 시간 | 0 | 증가 | 시동 후 시간 |
| 5C 오일 온도 | 무효일 수 있음 | 차량에 따라 | 쏘렌토는 항상 −40°C로 나왔다 |

## 7.4 쏘렌토에서 확인된 값과 이상한 PID

다음은 실제 차량에서 확인한 기록이다. **이 차 한 대의 결과**이고, 다른 연식·펌웨어에서는 다를 수 있다.

### 확인된 것

| 항목 | 결과 | 상태 |
|---|---|---|
| OBD 프로토콜 | ISO 15765-4 CAN 11비트 500k (`ATDPN` = `A6`) | 실차 확인 |
| 엔진 표준 PID | 79개 | 실차 확인 |
| 변속기 표준 PID | 16개, `0xA4` 미지원 | 실차 확인 |
| 다중 PID | 한 요청에 6개, 7항목 0.09~0.11초 주기 | 실차 확인 |
| MAF | 속도-밀도 추정보다 유지 가치 있음 | 실차 기록 |
| 계기판 주행거리 | `22 B002` 바이트 6..8, 24비트 km, 계기판과 일치 | 실차 확인 |
| 변속기 rpm | `22 01A0` 바이트 4..5, 값/4, 엔진 rpm과 일치 | 실차 확인 |
| 변속 레버 | `22 01A0` 바이트 20, 0B=P, 0A=R, 09=N, 08=D, 0C=수동 | 실차 확인 |
| 현재/목표 단 | `22 01A0` 바이트 21/22, 정차 시 00 | 실차 확인 |

### 이상한 것

| 항목 | 관찰 | 해석 |
|---|---|---|
| PID 0B 흡기압 | 255 kPa에서 막힘 | 과급 디젤의 실제 부스트를 표준 PID로 다 못 읽음 |
| PID 5C 오일 온도 | 항상 `00`(−40°C) | 센서 없음 또는 PID 미구현 추정 |
| PID 46 외기 온도 | 51°C 고정 | 무효 값 추정 |
| PID 78/7A/7C | 규격(9/7/9바이트)보다 짧게(5/3/3바이트) 응답 | 제조사 구현 차이. 길이를 고정하지 말 것 |
| 항상 0인 PID | 약 29개(0x65, 0x67, 0x69~6C 등) | 지원한다고 답하지만 값이 0. 대시보드에서 걸러야 함 |
| PID 0x88 F~G | 1km마다 1 증가 | 거리 카운터로 추정 |
| PID 0x8F B | 재생 직전 상태 변화 | 근거 약함 |

이 표의 교훈은 **"지원한다"와 "의미 있는 값을 준다"가 다르다**는 것이다. PID 지원 비트마스크만 보고 대시보드에 모든 PID를 올리면, −40°C 오일 온도와 51°C 외기 온도가 화면에 뜬다. 값의 범위·변화·물리적 의미를 확인한 뒤 표시한다.

## 7.5 DTC 읽기

DTC(Diagnostic Trouble Code)는 차량의 고장 코드다. Mode 03은 저장된(confirmed) DTC, Mode 07은 pending, Mode 0A는 permanent DTC를 읽는다.

```text
>03
43 01 01 33 00 00 00 00
```

CAN에서는 `43` 뒤에 DTC 개수가 한 바이트 더 붙는다. 위 응답은 DTC 1개, `01 33`이다.

```python
def decode_dtc(a: int, b: int) -> str:
    category = ["P", "C", "B", "U"][(a >> 6) & 0x03]
    number = ((a & 0x3F) << 8) | b
    return f"{category}{number:04X}"


print(decode_dtc(0x01, 0x33))  # P0133
print(decode_dtc(0x03, 0x01))  # P0301
print(decode_dtc(0xC1, 0x58))  # U0158
```

- 첫 바이트의 상위 2비트가 계열(P/C/B/U)이고, 나머지 14비트가 번호다.
- `P0133`은 산소 센서 회로 느린 응답, `P0301`은 1번 실린더 실화(misfire)다. 코드의 의미는 제조사·차종에 따라 달라질 수 있으므로, 일반 코드 표와 정비 문서를 함께 본다.
- `43 01 01 33`에서 `01`은 DTC 개수, `01 33`은 DTC다. 개수와 코드를 혼동하지 않는다.
- DTC를 읽는 것은 차량 상태를 바꾸지 않는다. **지우는 것(Mode 04)은 다르다.** 9장에서 다룬다.

### DTC를 읽었을 때

- DTC는 "무엇이 고장났다"가 아니라 "어떤 조건이 감지됐다"는 기록이다. 같은 코드도 배선·센서·기계·소프트웨어 원인이 있을 수 있다.
- Freeze frame(Mode 02)은 DTC가 발생한 순간의 PID 스냅샷이다. 원인을 좁히는 데 도움이 된다.
- Pending(07)은 아직 confirmed가 아닌 코드다. 한 번 나타났다가 사라질 수 있다.
- Permanent(0A)는 배출가스 관련으로, 스캔 도구로 지워도 차량이 스스로 지우기 전까지 남는다.
- DTC를 지우면 readiness monitor가 초기화되어 배출가스 검사에서 불합격할 수 있다. **진단 없이 지우지 않는다.**

### DTC 형식 더 깊이

DTC는 2바이트다. 첫 바이트의 상위 2비트가 계열을 정하고, 나머지 14비트가 번호다. 표시할 때는 계열 글자와 4자리 16진수를 붙여 `P0133`처럼 다섯 글자로 쓴다.

| 첫 바이트 상위 2비트 | 계열 | 뜻 |
|---|---|---|
| `00` | P | Powertrain(엔진·변속기) |
| `01` | C | Chassis(제동·조향·현가) |
| `10` | B | Body(에어백·도어·조명) |
| `11` | U | Network(버스 통신) |

```text
01 33  →  P + 0x0133  = P0133
03 01  →  P + 0x0301  = P0301
C1 58  →  U + 0x0158  = U0158
```

- 두 번째 글자는 첫 바이트의 상위 2비트에서 나오므로 **0~3까지만** 나온다. `P4...` 같은 코드는 이 인코딩으로 만들 수 없다.
- `P0xxx`는 SAE/일반 코드, `P1xxx`는 제조사 코드로 쓰이는 경우가 많다. `P2xxx`, `P3xxx`도 있으므로 두 번째 글자만 보고 단정하지 말고 코드표에서 확인한다.
- 세 번째 글자는 하위 시스템, 마지막 두 글자는 구체 번호다. `P0133`은 산소 센서 회로 응답 느림(Bank 1 Sensor 1), `P0301`은 1번 실린더 실화다. 코드의 설명은 차종·제조사 문서에서 다시 확인한다.
- DTC 두 바이트가 `00 00`이면 패딩이지 코드가 아니다. 응답의 DTC 개수만큼만 읽는다.

CAN에서 Mode 03 응답은 `43` 뒤에 **DTC 개수 1바이트**가 붙는다.

```text
>03
43 02 01 33 03 01 00 00
```

- `43` = Mode 03 긍정 응답
- `02` = DTC 2개
- `01 33` = P0133, `03 01` = P0301
- `00 00` = 남는 바이트 패딩. 개수가 2이므로 해석하지 않는다.

여러 ECU가 응답하면 `43` 줄이 여러 개 올 수 있다. ELM327에서 헤더를 켜지 않으면 어느 ECU의 코드인지 구분하기 어렵다. 기능 주소 `7DF`로 물었을 때는 `ATH1`로 응답 ID를 보거나, 물리 주소 `7E0`/`7E1`로 하나씩 물는다.

### 프리즈 프레임(Mode 02)

프리즈 프레임은 DTC가 저장된 순간의 PID 스냅샷이다. 현재 값(Mode 01)과 같은 PID·같은 공식을 쓰지만, 요청에 **프레임 번호**를 하나 더 붙인다.

```text
요청:  02 <PID> <프레임 번호>
응답:  42 <PID> <프레임 번호> <데이터...>
```

먼저 어떤 DTC 때문에 스냅샷이 저장됐는지 확인한다. PID `02`가 그 DTC를 돌려준다.

```text
>020200
42 02 00 01 33        ← 프레임 00의 DTC는 P0133
```

- `42` = Mode 02 긍정 응답
- `02` = PID 02(DTC)
- `00` = 프레임 번호
- `01 33` = P0133

이어서 같은 프레임의 현재 값을 읽는다.

```text
>020C00
42 0C 00 1A F8 00 00 00
```

`42 0C 00` 뒤의 `1A F8`이 프레임 00의 rpm 데이터다. Mode 01과 같은 식으로 `(0x1A × 256 + 0xF8) / 4 = 1726 rpm`이다.

- `42 02 00 00 00`처럼 DTC가 0이면 그 프레임에 스냅샷이 없다는 뜻이다. 이때 다른 Mode 02 값은 의미가 없다.
- 차량에 따라 프레임이 하나뿐이거나, 아예 Mode 02를 지원하지 않을 수 있다. `NO DATA`가 오면 미지원으로 받아들인다.
- 프리즈 프레임은 과거의 값이다. 화면에 "현재 값"과 섞어 표시하지 말고 발생 시각·DTC와 함께 별도로 보여 준다.
- 프리즈 프레임을 새로 만들기 위해 DTC를 지우지 않는다. 지우면 진단 근거가 사라진다.

## 7.6 VIN과 Calibration ID

Mode 09는 차량 정보를 읽는다. PID 02는 VIN, PID 04는 Calibration ID, PID 06은 CVN이다.

```text
>0902
014
0: 49 02 01 54 45 53
1: 54 56 49 4E 30 30 30
2: 30 30 30 30 30 30 30
```

- `49 02 01` 뒤 17바이트가 VIN ASCII다. 위 예시는 `TESTVIN0000000000`(테스트용 가짜 VIN)이다.
- 실제 VIN은 차량 식별자다. 로그·책·공개 저장소에 그대로 남기지 않는다.
- Calibration ID는 ECU 소프트웨어의 캘리브레이션 식별자다. CVN은 그 무결성 확인 번호다. 펌웨어 버전을 추적할 때 유용하지만, 제조사마다 형식이 다르다.
- ELM327이 `ATH0`이면 `0:`/`1:` 형태로 조립해 준다. `ATH1`이면 `7E8 10 14 ...`처럼 원시 ISO-TP 프레임이 보인다.
- VIN을 읽는 것 자체는 차량 상태를 바꾸지 않는다. 하지만 **저장·전송·공개**에는 개인정보 관점의 주의가 필요하다.

### Mode 09의 다른 PID

Mode 09는 VIN만 있는 서비스가 아니다. PID `00`으로 지원 목록을 확인하고, 필요한 식별자만 골라 읽는다.

| PID | 내용 | 형식 |
|---|---|---|
| 00 | Mode 09 지원 PID 비트마스크 | 4바이트, Mode 01 PID 00과 같은 방식 |
| 02 | VIN | 17자 ASCII, 모자라면 `0x00` 패딩 |
| 04 | Calibration ID(CALID) | 16자 ASCII 단위, 여러 개일 수 있음 |
| 06 | Calibration Verification Number(CVN) | 4바이트 단위, CALID 수와 일치 |
| 0A | ECU name | 20자 ASCII, 오른쪽 `0x00` 패딩 |

```text
>0900
49 00 54 40 00 00     ← 예: PID 02, 04, 06, 0A 지원을 나타내는 비트마스크
>0904
49 04 01 54 45 53 54 43 41 4C 49 44 30 30 30 30 30 30 30
```

- `49`는 Mode 09 긍정 응답, 다음 바이트가 PID다.
- `49 02 01`의 세 번째 바이트 `01`은 **데이터 항목 수**다. VIN 17자에 포함되지 않는다. 이 바이트를 빼고 17자를 읽어야 한다.
- CALID는 16자씩 여러 개가 올 수 있다. `49 04 01` 뒤 16자를 하나의 CALID로 보고, 이어지는 항목이 있으면 같은 방식으로 나눈다.
- CVN은 4바이트짜리 숫자다. CALID 개수와 CVN 개수가 맞아야 하므로, 둘을 함께 저장해 펌웨어 이력을 만든다.
- `090A`의 ECU name은 `ECM-EngineControl`, `TCM-TransmisCtrl`처럼 제어기 역할을 알려 준다. 쏘렌토에서 엔진 7E0과 변속기 7E1을 구분할 때 쓴 값이다(실차 확인).
- 기능 주소 `7DF`로 `0900`을 보내면 여러 ECU가 각자의 지원 목록을 돌려준다. `ATH1`이면 `7E8`, `7E9` 같은 응답 ID로 구분한다.
- VIN·CALID·CVN은 차량 식별 정보에 가깝다. VIN은 특히 저장·전송·공개하지 않는다. CALID/CVN은 펌웨어 추적에 유용하지만, 차량과 함께 공개하면 식별 위험이 생길 수 있으므로 로그에서 차량 별칭과 분리한다.

## 7.7 파이썬 대시보드

이제 지금까지의 내용을 하나로 합친다. 구성은 다음과 같다.

```text
[ELM327] ── USB 시리얼 ── [ObdReader 스레드] ── 최신 값(dict) ── [Flask] ── HTTP ── [브라우저]
                             0.5~1초 주기              /api/values               500ms 폴링
```

- `ObdReader`는 별도 스레드에서 PID를 읽고 최신 값을 갱신한다.
- Flask는 최신 값만 JSON으로 돌려준다. 웹 페이지는 500ms마다 폴링한다.
- 차량이 없으면 `--demo` 모드로 가짜 값을 만들어 화면을 먼저 완성한다.

### 프로젝트 만들기

```bash
uv init obd-dashboard
cd obd-dashboard
uv add pyserial flask
```

### 코드

`obd_dashboard.py`를 만든다. 길지만, 각 부분은 앞에서 설명한 것들의 조합이다.

```python
from __future__ import annotations

import argparse
import math
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime

import serial
from flask import Flask, jsonify


class Elm327:
    def __init__(self, port: str, baudrate: int = 38400, timeout: float = 1.0):
        self.ser = serial.Serial(port, baudrate, timeout=0.1)
        self.timeout = timeout

    def close(self) -> None:
        self.ser.close()

    def command(self, cmd: str, timeout: float | None = None) -> list[str]:
        timeout = self.timeout if timeout is None else timeout
        self.ser.reset_input_buffer()
        self.ser.write((cmd + "\r").encode("ascii"))
        self.ser.flush()

        buf = bytearray()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            chunk = self.ser.read(1)
            if not chunk:
                continue
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
        """Mode 01 PID를 읽고 데이터 바이트만 돌려준다."""
        for line in self.command(f"01{pid:02X}"):
            if ":" in line:                 # ELM327의 '0:', '1:' 조립 줄
                line = line.split(":", 1)[1]
            compact = "".join(line.split())  # ATS0(공백 끔)과 ATS1 둘 다 처리
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


def parse_pid(pid: int, data: bytes) -> float | int | None:
    if pid == 0x04 and len(data) >= 1:
        return data[0] * 100 / 255
    if pid == 0x05 and len(data) >= 1:
        return data[0] - 40
    if pid == 0x0B and len(data) >= 1:
        return data[0]
    if pid == 0x0C and len(data) >= 2:
        return (data[0] * 256 + data[1]) / 4
    if pid == 0x0D and len(data) >= 1:
        return data[0]
    if pid == 0x0F and len(data) >= 1:
        return data[0] - 40
    if pid == 0x10 and len(data) >= 2:
        return (data[0] * 256 + data[1]) / 100
    if pid == 0x11 and len(data) >= 1:
        return data[0] * 100 / 255
    if pid == 0x1F and len(data) >= 2:
        return data[0] * 256 + data[1]
    if pid == 0x2F and len(data) >= 1:
        return data[0] * 100 / 255
    if pid == 0x42 and len(data) >= 2:
        return (data[0] * 256 + data[1]) / 1000
    if pid == 0x46 and len(data) >= 1:
        return data[0] - 40
    if pid == 0x49 and len(data) >= 1:
        return data[0] * 100 / 255
    if pid == 0x5C and len(data) >= 1:
        return data[0] - 40
    return None


@dataclass
class PidSpec:
    pid: int
    key: str
    label: str
    unit: str
    maximum: float


PIDS = [
    PidSpec(0x0C, "rpm", "엔진 회전수", "rpm", 7000),
    PidSpec(0x0D, "speed", "차속", "km/h", 200),
    PidSpec(0x05, "coolant", "냉각수 온도", "°C", 120),
    PidSpec(0x11, "throttle", "스로틀", "%", 100),
    PidSpec(0x2F, "fuel", "연료량", "%", 100),
    PidSpec(0x42, "voltage", "모듈 전압", "V", 16),
]


@dataclass
class Snapshot:
    ok: bool = False
    error: str | None = None
    updated: float = 0.0
    values: dict[str, float | int] = field(default_factory=dict)


class ObdReader(threading.Thread):
    def __init__(self, elm: Elm327 | None, demo: bool = False, interval: float = 1.0):
        super().__init__(daemon=True)
        self.elm = elm
        self.demo = demo
        self.interval = interval
        self.snapshot = Snapshot()
        self._stop_event = threading.Event()

    def stop(self) -> None:
        self._stop_event.set()

    def run(self) -> None:
        while not self._stop_event.is_set():
            try:
                if self.demo:
                    values = self._demo_values()
                else:
                    values = {}
                    for spec in PIDS:
                        data = self.elm.query_pid(spec.pid)
                        if data is not None:
                            parsed = parse_pid(spec.pid, data)
                            if parsed is not None:
                                values[spec.key] = round(parsed, 1)
                self.snapshot = Snapshot(
                    ok=True,
                    updated=time.time(),
                    values=values,
                )
            except Exception as exc:  # noqa: BLE001 - 대시보드는 오류를 화면에 보여 준다
                self.snapshot = Snapshot(ok=False, error=str(exc), updated=time.time())
            self._stop_event.wait(self.interval)

    @staticmethod
    def _demo_values() -> dict[str, float]:
        t = time.monotonic()
        return {
            "rpm": round(900 + 650 * (1 + math.sin(t / 4)), 1),
            "speed": round(max(0.0, 60 + 50 * math.sin(t / 7)), 1),
            "coolant": round(82 + 4 * math.sin(t / 15), 1),
            "throttle": round(20 + 15 * (1 + math.sin(t / 3)), 1),
            "fuel": round(62 + 2 * math.sin(t / 20), 1),
            "voltage": round(14.1 + 0.15 * math.sin(t / 5), 2),
        }


HTML = """<!doctype html>
<html lang="ko">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OBD-II 대시보드</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; background: #0f1419; color: #e6edf3; }
  main { max-width: 900px; margin: 0 auto; padding: 32px 20px; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .sub { color: #8b949e; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 16px; }
  .label { color: #8b949e; font-size: 13px; }
  .value { font-size: 32px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .unit { font-size: 14px; color: #8b949e; margin-left: 4px; }
  .bar { height: 8px; background: #21262d; border-radius: 999px; overflow: hidden; margin-top: 10px; }
  .bar > span { display: block; height: 100%; width: 0; background: #2f81f7; transition: width .3s; }
  #status { margin-top: 20px; color: #8b949e; font-size: 13px; }
  #status.err { color: #f85149; }
</style>
<main>
  <h1>쏘렌토 OBD-II</h1>
  <div class="sub">정차 상태에서 읽기 전용으로 수집한 값입니다.</div>
  <div class="grid" id="cards"></div>
  <p id="status">연결 중…</p>
</main>
<script>
const specs = [
  ["rpm", "엔진 회전수", "rpm", 7000, 0],
  ["speed", "차속", "km/h", 200, 0],
  ["coolant", "냉각수 온도", "°C", 120, 0],
  ["throttle", "스로틀", "%", 100, 0],
  ["fuel", "연료량", "%", 100, 0],
  ["voltage", "모듈 전압", "V", 16, 10],
];
const cards = document.getElementById("cards");
for (const [key, label, unit] of specs) {
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = `<div class="label">${label}</div>
    <div><span class="value" id="v-${key}">--</span><span class="unit">${unit}</span></div>
    <div class="bar"><span id="b-${key}"></span></div>`;
  cards.appendChild(el);
}
async function tick() {
  const status = document.getElementById("status");
  try {
    const res = await fetch("/api/values", { cache: "no-store" });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "읽기 실패");
    for (const [key, , , max, min] of specs) {
      const value = data.values[key];
      document.getElementById("v-" + key).textContent =
        value === undefined ? "--" : Number(value).toFixed(key === "voltage" ? 2 : 1);
      const pct = value === undefined ? 0 : Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
      document.getElementById("b-" + key).style.width = pct + "%";
    }
    status.className = "";
    status.textContent = "업데이트 " + new Date(data.updated * 1000).toLocaleTimeString();
  } catch (err) {
    status.className = "err";
    status.textContent = "오류: " + err.message;
  }
}
setInterval(tick, 500);
tick();
</script>
</html>
"""


def create_app(reader: ObdReader) -> Flask:
    app = Flask(__name__)

    @app.get("/")
    def index():
        return HTML

    @app.get("/api/values")
    def values():
        s = reader.snapshot
        return jsonify({
            "ok": s.ok,
            "error": s.error,
            "updated": s.updated,
            "values": s.values,
        })

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="OBD-II 웹 대시보드")
    parser.add_argument("--port", default="COM5", help="시리얼 포트")
    parser.add_argument("--baud", type=int, default=38400, help="ELM327 보율")
    parser.add_argument("--demo", action="store_true", help="차량 없이 가짜 값으로 실행")
    parser.add_argument("--http-port", type=int, default=8000)
    args = parser.parse_args()

    elm = None
    if not args.demo:
        elm = Elm327(args.port, args.baud)
        for cmd, timeout in [("ATZ", 3), ("ATE0", 1), ("ATL0", 1),
                             ("ATSP0", 10)]:
            print(cmd, "→", elm.command(cmd, timeout=timeout))
        print("protocol:", elm.command("ATDPN"))
        print("battery:", elm.command("ATRV"))

    reader = ObdReader(elm, demo=args.demo)
    reader.start()
    app = create_app(reader)
    try:
        app.run(host="127.0.0.1", port=args.http_port, debug=False, use_reloader=False)
    finally:
        reader.stop()
        if elm is not None:
            elm.close()


if __name__ == "__main__":
    main()
```

### 실행

```bash
# 차량 없이 화면부터 확인
uv run python obd_dashboard.py --demo

# 실제 차량
uv run python obd_dashboard.py --port COM5 --baud 38400
```

브라우저에서 <http://127.0.0.1:8000>을 연다. 실제 차량에서는 `ATZ`·`ATSP0` 로그가 콘솔에 찍히고, PID 읽기가 시작된다. 차량 없이 PID 요청·ISO-TP 조립까지 시험하려면 14장의 가짜 ECU나 ELM327-emulator를 붙인다. `--demo`는 화면·UI만 시험하고, 실제 요청 경로는 타지 않는다.

### 코드에서 눈여겨볼 점

- **읽기 스레드와 웹 서버를 분리**했다. 시리얼 읽기가 느려도 웹 요청이 막히지 않는다.
- `snapshot`은 한 번에 교체된다. 여러 필드를 읽는 도중 웹이 보면 반쯤 갱신된 값을 볼 수 있지만, 대시보드에는 충분하다. 정확한 동시성이 필요하면 `Lock`을 쓴다.
- 오류가 나도 스레드는 죽지 않고 `snapshot.error`에 남긴다. 웹 화면은 오류를 표시하고 다음 주기에 다시 시도한다.
- `query_pid`는 `41 <PID>`를 확인한다. 다른 PID나 상태 메시지는 무시한다.
- 데모 모드는 `math.sin`으로 그럴듯한 값을 만든다. 파싱·UI·오류 처리를 차량 없이 시험할 수 있다.
- 실제 차량에서는 PID 6개를 순차적으로 읽으므로 한 주기가 1초 안팎이다. 더 빠르게 하려면 7.3절의 다중 PID 요청을 쓴다.
- `debug=True`와 `use_reloader=True`를 끈다. 리로더가 시리얼 포트를 두 번 열 수 있다.

### 다음 단계

- PID 지원 비트마스크를 읽어 지원하는 항목만 카드로 만든다.
- `0902`로 VIN을 읽되, 화면에는 표시하지 않고 해시만 남긴다.
- 값을 SQLite나 CSV에 저장하고, 10장의 MQTT로 보낸다.
- 8장의 UDS `22` DID를 추가해 변속기 온도·DPF 데이터를 표시한다.

## 7.8 문제 해결

| 증상 | 확인 |
|---|---|
| 포트가 안 보임 | USB 케이블(데이터), 드라이버(CH340), 장치 관리자 |
| `Access is denied` | 시리얼 모니터·다른 스크립트가 포트를 잡고 있음 |
| `ATI` 응답이 깨짐 | 보율 불일치. 38400/9600/115200 시도 |
| `ATZ`가 `STOPPED` | 프롬프트 전에 입력. 다시 `ATZ` |
| `UNABLE TO CONNECT` | 시동 OFF, OBD 커넥터, 차량 프로토콜 |
| `ATDPN`이 `A6`이 아님 | 자동 검색 결과 확인. 쏘렌토는 `A6` |
| `NO DATA` | PID 미지원, 시동 상태, `ATST`, 헤더/필터 |
| `?` | 명령 오타, 클론 미지원 |
| `BUFFER FULL` | 보율↑, `ATH0`/`ATS0`, `ATCRA` |
| 값이 이상함 | PID 공식, 바이트 순서, 센서 유무, 차량별 quirk |
| 포트가 사라짐 | USB 전원/케이블/허브, 절연, 이벤트 로그 |
| COM 번호가 바뀜 | 재연결 후 포트 목록 다시 확인 |

### 실차에서 겪은 USB 끊김

실차 기록에서는 주행 중 CH340 어댑터가 USB에서 사라져 통신이 끊긴 적이 있다. Windows 이벤트 로그에 `USB\VID_1A86&PID_7523` 장치가 버스에서 누락된 기록이 남았다. 크랭킹 때 끊긴 사례는 노트북 충전 전원 변화와 시점이 겹쳤지만, 원인이라고 단정할 수는 없다. 재연결 후 COM 번호가 `COM5`에서 `COM6`으로 바뀌었다.

대응:

- 앱에서 `SerialException`을 잡고, 포트를 다시 열고, 초기화 명령을 다시 보낸다.
- 포트 이름을 하드코딩하지 말고, VID/PID나 설명으로 찾는다.
- USB 절연기·외부 전원 허브·짧은 케이블을 시도한다.
- 크랭킹 중에는 로깅을 잠시 멈추거나, 어댑터 전원을 안정화한다.
- 로그에 "끊김 시각"과 "마지막 성공 시각"을 남긴다. 원인 분석의 첫 단서다.

## 7.9 체크리스트

- [ ] 차량을 정차하고 P, 주차 브레이크를 확인했는가
- [ ] OBD 포트와 어댑터가 제대로 체결됐는가
- [ ] 보율(38400/9600/115200)을 찾았는가
- [ ] `ATZ`, `ATE0`, `ATL0`, `ATSP0`를 보냈는가
- [ ] `ATDPN`이 `A6`인지 확인했는가
- [ ] `ATRV`로 배터리 전압을 확인했는가
- [ ] `0100` 지원 비트마스크를 해석했는가
- [ ] PID 공식과 바이트 길이를 확인했는가
- [ ] `NO DATA`와 `7F ... 78`을 구분했는가
- [ ] DTC를 읽기만 하고 지우지 않았는가
- [ ] VIN을 로그·화면·책에 노출하지 않았는가
- [ ] 읽기 요청만 보냈는가

## 장 요약

- ELM327은 38400/9600/115200 보율을 시도하고, `ATSP0` 뒤 `ATDPN`으로 프로토콜을 확인한다. 쏘렌토는 `A6`(11비트 500k CAN)이다.
- Mode 01 응답은 `41 <PID> <데이터>`다. PID마다 길이와 공식이 다르다.
- PID 00/20/40의 4바이트 비트마스크로 지원 PID를 알 수 있다.
- 쏘렌토 엔진은 표준 PID 79개를 지원했고, 일부 PID는 값이 무효하거나 규격보다 짧게 응답했다(실차 기록).
- DTC는 Mode 03/07/0A로 읽는다. CAN 응답에는 DTC 개수가 한 바이트 더 붙고, 2바이트 코드의 상위 2비트가 P/C/B/U를 정한다.
- Mode 02는 DTC가 저장된 순간의 PID 스냅샷이다. `02 <PID> <프레임>`으로 요청하고, PID 02로 원인 DTC를 먼저 확인한다.
- VIN은 Mode 09 PID 02로 읽지만, 개인정보이므로 저장·공개하지 않는다. 같은 Mode 09의 CALID(04)·CVN(06)·ECU name(0A)은 펌웨어와 제어기 식별에 쓴다.
- pyserial 읽기 스레드와 Flask 웹 서버를 분리하면, 느린 시리얼이 웹 UI를 막지 않는다.
- 데모 모드로 차량 없이 파싱·UI·오류 처리를 시험할 수 있다.
- 차량 문제는 코드보다 전원·USB·포트·프로토콜·PID 지원 여부에서 먼저 찾는다.

다음 장에서는 표준 OBD-II로 닿지 않는 제조사 데이터를 UDS `22`(ReadDataByIdentifier)로 읽는다. 변속기 온도, 계기판 주행거리, DPF 매연량 같은 쏘렌토의 실제 DID를 다룬다.

## 연습 문제

### 1. 지원 PID 비트마스크

`0100` 응답이 `41 00 BE 1F A8 13`이다.

1. 이 마스크가 나타내는 PID 목록을 쓰라.
2. `0C`, `0D`, `05`는 이 마스크로 지원 여부를 알 수 있다. `42`는 어떻게 확인해야 하는가?
3. `20`이 목록에 있으면 다음에 무엇을 해야 하는가?

### 2. DTC 읽기

Mode 03 응답이 `43 02 01 33 03 01 00 00`이다.

1. DTC는 몇 개인가?
2. 각 DTC를 다섯 글자로 디코딩하라.
3. `00 00`을 DTC로 해석하면 안 되는 이유는 무엇인가?

### 3. 프리즈 프레임

1. `020200` 요청의 뜻을 쓰라.
2. 응답 `42 02 00 01 33`에서 원인 DTC를 구하라.
3. 이어서 `020C00`을 보냈을 때 `42 0C 00 1A F8`이 왔다. rpm을 구하라.
4. 응답에서 `00`은 무슨 뜻인가?

### 4. PID 공식

다음을 계산하라.

1. `41 0C 0B B8`
2. `41 05 00`
3. `41 42 30 70`

### 5. Mode 09

1. `49 02 01` 뒤에 17바이트가 온다. `01`은 VIN의 일부인가?
2. VIN 응답이 ISO-TP FF/CF로 오는 이유는 무엇인가?
3. 같은 요청에 여러 ECU가 응답할 수 있는데, 엔진 응답을 구분하려면 무엇을 보아야 하는가?

## 정답과 해설

### 1.

1. 책의 예와 같은 마스크다: `01, 03, 04, 05, 06, 07, 0C, 0D, 0E, 0F, 10, 11, 13, 15, 1C, 1F, 20`.
2. `0C`, `0D`, `05`는 지원한다. `42`는 PID `0x41`~`0x60` 그룹이므로 `0100` 마스크로는 판단할 수 없다. `0140`으로 그 그룹의 지원 비트마스크를 읽거나, `0142`를 직접 보내 응답 여부를 확인한다.
3. `0120`으로 다음 32개(PID 21~40)의 지원 비트마스크를 물을 수 있다. `20` 자체는 "다음 페이지가 있다"는 표시이기도 하다.

### 2.

1. `43` 뒤의 `02`가 DTC 개수다. 2개다.
2. `01 33` → P0133, `03 01` → P0301.
3. 개수가 2이므로 뒤의 `00 00`은 패딩이다. 패딩을 DTC로 읽으면 없는 코드가 생긴다.

### 3.

1. Mode 02, PID `02`(프리즈 프레임을 만든 DTC), 프레임 번호 `00`을 요청한다.
2. `42 02 00` 뒤의 `01 33`이 DTC다. P0133.
3. `42 0C 00` 뒤의 `1A F8`이 데이터다. `(0x1A × 256 + 0xF8) / 4 = 1726 rpm`.
4. `00`은 프레임 번호다. 응답은 `42 <PID> <프레임 번호> <데이터>` 형식이므로, PID와 데이터 사이의 프레임 번호를 빼고 해석해야 한다.

### 4.

1. `0x0BB8 = 3000`, `/4 = 750 rpm`
2. `0x00 − 40 = −40°C`
3. `0x3070 = 12400`, `/1000 = 12.4V`

### 5.

1. 아니다. `49 02 01`의 `01`은 데이터 항목 수다. VIN 17자에는 포함되지 않는다.
2. VIN 17자에 `49 02 01`을 더하면 20바이트로, 클래식 CAN 한 프레임(8바이트)을 넘는다. ISO-TP가 FF/CF로 나눠 보낸다.
3. `ATH1`로 응답 CAN ID를 보거나, 물리 주소 `7E0`/`7E1`로 하나씩 요청한다. 기능 주소 `7DF`에서는 `7E8`, `7E9` 등이 섞인다.
