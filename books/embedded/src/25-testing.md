# 25장 테스트 전략: 가상 버스에서 HIL까지

## 이 장에서

웹 개발자는 테스트에 익숙하다. 단위 테스트, 통합 테스트, E2E 테스트, 목과 스텁, CI를 당연하게 쓴다. 임베디드에서도 같은 사고가 통한다. 다만 **하드웨어가 끼어드는 순간** 테스트의 경계를 다시 그어야 한다.

이 장의 핵심은 하나다. **하드웨어를 인터페이스 뒤로 숨기고, 가능한 한 위쪽에서 테스트한다.** CAN 프레임을 만들고 해석하는 코드는 PC에서 단위 테스트할 수 있다. 가짜 ECU를 붙이면 통합 테스트가 된다. 기록 로그를 재생하면 회귀 테스트가 된다. 실제 ECU와 실시간 시뮬레이터를 붙이면 HIL이 된다.

웹과 대응시키면 다음과 같다.

| 웹 | 임베디드·CAN |
|---|---|
| 단위 테스트(Jest/pytest) | PID 공식, 프레임 파서, ISO-TP 조립기 |
| 목 API 서버 | 가짜 ECU |
| 녹화한 API 응답 픽스처 | candump 로그 재생 |
| 통합 테스트(Testcontainers 등) | virtual/vcan 위의 ECU↔클라이언트 |
| E2E 테스트(Playwright) | 실제 차량·벤치에서 읽기 |
| 스테이징 환경 | HIL(하드웨어 + 시뮬레이션) |
| 카나리·관측 | 버스 부하, TEC/REC, 로그 |

이 장에서 다루는 것:

- 프레임 파서·ISO-TP 조립기·PID 공식의 단위 테스트
- candump 기록을 재생하는 회귀 테스트
- 가짜 ECU를 이용한 통합 테스트
- HIL(Hardware-in-the-Loop)의 개념과 이 책 규모의 축소판
- CI에서 어디까지 자동화하고, 무엇을 사람이 확인할지

## 25.1 테스트 피라미드를 CAN에 맞추기

웹의 테스트 피라미드는 "단위 테스트를 많이, E2E를 적게"라고 말한다. CAN에서도 같다. 다만 "E2E"의 비용이 차량·벤치·시간이라 더 비싸다.

```text
        [실차 읽기]            적음, 수동, 느림, 위험
      [HIL]                  적음, 실시간, 장비 필요
    [가짜 ECU 통합]          보통, virtual/vcan
  [로그 재생 회귀]           많음, 결정적
[단위 테스트]                가장 많음, 빠름
```

| 계층 | 무엇을 검증하나 | 도구 | 실행 시간 |
|---|---|---|---|
| 단위 | PID 공식, 파서, ISO-TP 조립, 상태 전이 | pytest | ms |
| 로그 재생 | 실제 프레임에 대한 디코딩·알람 | pytest + `can.LogReader` | ms~s |
| 가짜 ECU 통합 | 요청→응답, 타임아웃, 오류 처리 | python-can virtual/vcan | s |
| HIL | 실시간성, 전원·센서·액추에이터, Bus-Off | 실시간 시뮬레이터, 전원 장치 | 분~시간 |
| 실차 | 실제 ECU·배선·차량 거동 | ELM327/USB-CAN, 사람 | 수동 |

- 아래로 갈수록 **현실성**이 높아지고, 위로 갈수록 **속도·재현성**이 좋아진다.
- 모든 것을 실차에서 확인하려 하면 느리고 위험하다. 반대로 단위 테스트만 있으면 배선·전원·타이밍 문제를 못 잡는다.
- 이 책의 실습은 **단위 → 로그 재생 → 가짜 ECU → HIL 축소판 → 실차 읽기** 순서를 권한다.

## 25.2 단위 테스트: 순수 함수부터

CAN 코드에서 단위 테스트하기 가장 좋은 것은 **바이트를 넣으면 값이 나오는 함수**다.

- PID 공식: `parse_pid(pid, data)`
- 프레임 파서: 바이트 스트림 → 프레임
- ISO-TP 조립기: FF/CF → 메시지
- DBC 디코더: ID+바이트 → 신호
- 상태 기계: 이벤트 → 다음 상태

### pytest 예제

23장의 `probe.py`에 있는 `parse_pid()`를 테스트한다.

```python
import pytest

from probe import parse_pid


@pytest.mark.parametrize(
    ("pid", "data", "expected"),
    [
        (0x0C, bytes.fromhex("1A F8"), 1726),
        (0x0D, bytes([50]), 50),
        (0x05, bytes([90 + 40]), 90),
        (0x11, bytes([0x80]), 50.196),
        (0x1F, bytes.fromhex("01 2C"), 300),
    ],
)
def test_parse_pid(pid, data, expected):
    assert parse_pid(pid, data) == pytest.approx(expected, abs=0.05)
```

- `parametrize`로 경계값을 표로 만든다. PID마다 공식이 다르므로, 각 PID에 최소 하나의 알려진 바이트를 둔다.
- 부동소수점은 `==` 대신 `pytest.approx`를 쓴다. 0x80/255*100은 50.2가 아니라 50.196...이다.
- **데이터 길이가 부족한 경우**도 테스트한다. `parse_pid(0x0C, b"\x1A")`는 `None`이어야 한다. 길이 검사를 빼먹으면 인덱스 오류가 난다.

```python
@pytest.mark.parametrize("pid", [0x05, 0x0C, 0x0D, 0x11, 0x1F])
def test_parse_pid_rejects_short_data(pid):
    assert parse_pid(pid, b"") is None
```

- `parse_pid`가 `b""`에서 `None`을 돌려주는지 확인한다. 실제 코드가 `IndexError`를 내면 테스트가 잡는다.
- 함수가 예외를 던지는 것이 설계라면 `pytest.raises`로 명시한다.

### ISO-TP 조립기 테스트

3장의 `IsoTpAssembler`는 프레임을 하나씩 넣고 완성된 메시지를 돌려준다. 정상 시퀀스, 시퀀스 어긋남, 다른 CAN ID가 섞이는 경우를 테스트한다.

```python
from isotp import IsoTpAssembler


def test_assembler_handles_multiframe():
    frames = [
        bytes.fromhex("10 14 49 02 01 54 45 53"),
        bytes.fromhex("21 54 56 49 4E 30 30 30"),
        bytes.fromhex("22 30 30 30 30 30 30 30"),
    ]
    a = IsoTpAssembler()
    out = [a.feed(0x7E8, f) for f in frames]
    assert out[-1] == b"\x49\x02\x01TESTVIN0000000000"


def test_assembler_rejects_wrong_sequence():
    a = IsoTpAssembler()
    assert a.feed(0x7E8, bytes.fromhex("10 14 49 02 01 54 45 53")) is None
    assert a.feed(0x7E8, bytes.fromhex("22 30 30 30 30 30 30 30")) is None
    assert a.feed(0x7E8, bytes.fromhex("21 54 56 49 4E 30 30 30")) is None
```

- 시퀀스가 어긋나면 조립을 포기하고 `None`을 돌려주는지 확인한다. 부분 데이터를 붙이면 더 위험한 버그가 된다.
- **같은 CAN ID만 조립**하는지도 테스트한다. 0x7E8 FF 뒤에 0x7E9 CF가 오면 조립하면 안 된다.
- 타임아웃은 조립기 밖의 책임인지, 안쪽인지 설계를 정하고 테스트한다. 3장 조립기는 타임아웃을 직접 다루지 않는다.

### 파서 불변식

"전체 바이트를 한 번에 넣은 결과"와 "1바이트씩 나눠 넣은 결과"가 같아야 한다. 이 불변식은 청크 경계 버그를 잡는다.

```python
from parser import FrameParser          # 3장의 FrameParser

FRAME = bytes.fromhex("A5 03 01 2A 00 C1 01")


def test_parser_is_chunk_boundary_safe():
    whole = FrameParser()
    assert whole.feed(FRAME) == [b"\x01\x2A\x00"]

    byte_by_byte = FrameParser()
    out = []
    for b in FRAME:
        out.extend(byte_by_byte.feed(bytes([b])))
    assert out == [b"\x01\x2A\x00"]
```

- 3장의 `FrameParser.feed()`는 바이트를 넣을 때마다 상태를 진행한다. 전체를 한 번에 넣은 결과와 1바이트씩 넣은 결과가 같아야 한다.
- 시리얼·BLE·파일 읽기에서 청크 크기는 실행마다 달라진다. 이 테스트가 없으면 "내 PC에서는 되는데"가 된다.
- 같은 방식으로 ELM327 줄 파서(24장)도 청크 경계 테스트를 만든다.

## 25.3 로그 재생 회귀 테스트

실차에서 기록한 candump 로그는 가장 현실적인 픽스처다. 같은 프레임을 재생해 디코딩·알람·대시보드 로직이 이전과 같은 결과를 내는지 확인한다.

```python
import can

from probe import parse_pid


def test_replay_rpm(tmp_path):
    log = tmp_path / "capture.log"
    log.write_text(
        "(1000.000000) vcan0 7DF#02010C0000000000\n"
        "(1000.100000) vcan0 7E8#04410C1AF8000000\n",
        encoding="ascii",
    )
    reader = can.LogReader(str(log))
    try:
        messages = list(reader)
    finally:
        reader.stop()

    assert len(messages) == 2
    response = messages[1]
    assert response.arbitration_id == 0x7E8
    payload = bytes(response.data)
    assert payload[1:3] == b"\x41\x0C"
    assert parse_pid(0x0C, payload[3:5]) == 1726
```

- 로그의 **타임스탬프는 절대값이 아니다.** 테스트에서는 순서와 내용만 본다. 타이밍을 검증하려면 별도의 시계를 주입한다.
- `candump` 로그의 프레임 데이터는 `ID#바이트` 형식이다. `can.LogReader`가 파싱해 `can.Message`로 돌려준다.
- 응답 프레임의 `04`는 ISO-TP SF 길이다. `payload[1:3]`이 `41 0C`, `payload[3:5]`가 데이터다. 오프셋을 헷갈리지 않는다.
- 로그 파일은 `tests/fixtures/`에 두고, 개인정보(VIN·위치)를 제거한다. 원본은 저장소 밖에 보관한다.

### 골든 테스트

디코딩 결과 전체를 JSON으로 저장하고, 새 코드의 출력과 비교할 수 있다.

```python
import json

import can


def decode_log(path: str) -> list[dict]:
    reader = can.LogReader(path)
    try:
        return [
            {"id": msg.arbitration_id, "data": bytes(msg.data).hex()}
            for msg in reader
        ]
    finally:
        reader.stop()


def test_decoded_snapshot(tmp_path):
    log = tmp_path / "capture.log"
    log.write_text("(1000.0) vcan0 7E8#04410C1AF8000000\n", encoding="ascii")
    golden = tmp_path / "capture.json"
    golden.write_text(
        json.dumps([{"id": 0x7E8, "data": "04410c1af8000000"}]),
        encoding="utf-8",
    )
    assert decode_log(str(log)) == json.loads(golden.read_text(encoding="utf-8"))
```

- 실제 프로젝트에서는 골든 파일을 `tests/fixtures/`에 두고, 새 출력과 비교한다. 위 코드는 형식을 보여 주기 위해 `tmp_path`에 만든다.
- 골든 파일은 **리뷰 대상**이다. 코드가 바뀌어 골든이 바뀌면, 왜 바뀌었는지 diff를 확인한다. 자동으로 덮어쓰지 않는다.
- 부동소수점은 반올림 규칙을 정해 저장한다. 원시 바이트도 함께 저장하면 나중에 재해석할 수 있다.
- 로그가 길면 전체를 비교하지 말고, 관심 PID·이벤트·구간만 잘라 비교한다.

### 재생 속도와 결정성

- 테스트에서는 `speed`를 크게 해 **즉시 재생**한다. 실제 시간 지연은 단위 테스트에서 피한다.
- 타임아웃·재전송을 테스트하려면 `time.monotonic`을 주입하거나, 가짜 시계를 쓴다. `time.sleep(1)`을 테스트에 넣으면 CI가 느려지고 불안정해진다.
- 재생 순서는 로그 순서를 따른다. 같은 타임스탬프의 프레임이 여럿이면 정렬 규칙을 정한다.
- 로그에 오류 프레임이 있으면 `msg.is_error_frame`을 확인한다. 오류 프레임을 데이터로 디코딩하지 않는다.

## 25.4 가짜 ECU 통합 테스트

단위 테스트는 함수 하나를 본다. 통합 테스트는 **버스 경계**에서 요청과 응답을 주고받는다. 23장의 가짜 ECU를 pytest fixture로 띄운다.

```python
import can
import pytest

from fake_ecu import FakeEcu
from probe import parse_pid, request


@pytest.fixture
def bench():
    channel = "test-obd"
    ecu = FakeEcu(channel=channel)
    ecu.start()
    bus = can.Bus(interface="virtual", channel=channel)
    try:
        yield bus
    finally:
        bus.shutdown()
        ecu.stop()
        ecu.join()
        ecu.bus.shutdown()


def test_fake_ecu_answers_rpm(bench):
    data = request(bench, 0x01, 0x0C)
    assert data == bytes.fromhex("41 0C 1A F8")
    assert parse_pid(0x0C, data[2:]) == 1726


def test_fake_ecu_answers_vin(bench):
    data = request(bench, 0x09, 0x02)
    assert data == b"\x49\x02\x01TESTVIN0000000000"


def test_unsupported_pid_times_out(bench):
    assert request(bench, 0x01, 0x99, timeout=0.2) is None
```

- fixture의 `finally`에서 버스·스레드를 반드시 정리한다. 정리하지 않으면 다음 테스트가 이전 ECU의 응답을 받는다.
- 채널 이름을 테스트마다 바꾸면 병렬 실행에서 충돌을 줄일 수 있다. virtual은 프로세스 안에서만 통하므로 pytest-xdist의 프로세스 간에는 격리된다.
- `request()`의 타임아웃을 짧게 줘 테스트가 빨리 끝나게 한다. 실제 ECU의 응답 시간을 검증하는 테스트라면 타임아웃을 별도로 정한다.
- **버스 경계에서 테스트**하는 것이 핵심이다. `FakeEcu.answer()`를 직접 호출하면 프레임 형식·주소·ISO-TP 조립 버그를 놓친다.

### 오류 주입

가짜 ECU에 일부러 오류를 넣어 클라이언트의 복구 로직을 시험한다.

| 주입 | 클라이언트가 보여야 할 반응 |
|---|---|
| 응답 없음 | 타임아웃, 재시도, `NO DATA` 표시 |
| 잘못된 시퀀스(CF 2→1) | 조립 포기, 다음 FF 대기 |
| 잘못된 PID 에코 | 해당 응답 무시 |
| 긴 응답 중 FF만 보냄 | FC 후 타임아웃, 버퍼 정리 |
| Bus-Off 상태 | 송신 중단, 복구 정책 |

- 오류 주입은 **테스트용 플래그**로 만든다. 운영 코드에 `if test_mode`를 흩뿌리지 말고, 가짜 ECU 쪽에 주입 지점을 둔다.
- 재시도가 무한 루프가 되지 않는지, 타임아웃 뒤 버퍼가 비는지 확인한다.
- 오류 로그에 원시 프레임을 남긴다. "왜 실패했는지"를 나중에 재현할 수 있어야 한다.

## 25.5 HIL(Hardware-in-the-Loop)

HIL은 **실제 하드웨어(ECU)를 실시간으로 시뮬레이션된 환경에 연결해 시험하는 것**이다. ECU는 실제로 동작하지만, 센서·액추에이터·차량 거동은 컴퓨터가 만든다.

```text
[실시간 시뮬레이터] ── 센서 신호(아날로그/디지털/CAN) ──▶ [ECU under test]
        ▲                                                  │
        └──────── 액추에이터 신호 / CAN 응답 ◀──────────────┘
```

- **plant simulation**: 엔진·변속기·차량 동역학 같은 대상 시스템의 수학 모델.
- **I/O**: 실제 ECU의 센서 입력을 전기적으로 흉내 내고, 액추에이터 출력을 읽는다.
- **실시간성**: 시뮬레이터가 정해진 주기 안에 계산·입출력을 끝내야 한다. OS 지터와 지연이 HIL의 품질을 좌우한다.
- **remaining bus simulation**: ECU가 기대하는 다른 ECU들의 CAN 프레임을 시뮬레이터가 대신 보낸다.
- **fault injection**: 센서 단선, 신호 범위 초과, CAN 프레임 손실, 전원 순단을 넣어 ECU의 반응을 본다.

웹에 비유하면 HIL은 **하드웨어가 붙은 스테이징 환경**이다. 실제 ECU 펌웨어를 돌리면서, 주변 세계만 시뮬레이션한다. E2E 테스트와 비슷하지만, 시간·전기·물리량이 결과에 들어간다는 점이 다르다.

### HIL이 잡는 것과 못 잡는 것

| HIL이 잘 잡는다 | HIL이 대신하지 못한다 |
|---|---|
| 실시간 주기·지연·지터 | 실제 차량의 진동·온도·EMC |
| 센서 단선·범위 초과 | 도로·날씨·운전자 습관 |
| CAN 프레임 손실·Bus-Off | 장기 마모·노화 |
| 전원 순단·재부팅 | 실제 배선 하네스의 모든 접점 |
| 진단 세션·재프로그래밍 | 법규·인증 시험 전체 |

- HIL은 **재현 가능성**이 강점이다. 같은 시나리오를 몇 번이고 돌릴 수 있다.
- HIL은 **비싸다.** 상용 HIL 장비는 수천만 원대일 수 있다. 이 책의 규모에서는 "축소판 HIL"로 개념만 익힌다.

### 이 책 규모의 축소판 HIL

```text
[PC: 파이썬 시뮬레이터] ── USB-CAN ──▶ [ESP32/Arduino ECU]
        ▲                                      │
        └──────── CAN 응답 / 센서 입력 ◀────────┘
```

- PC가 다른 ECU의 프레임을 주기적으로 보내고, 보드가 그 프레임에 반응하는지 본다.
- 전원 장치로 12V를 넣고, 퓨즈·강압·TVS를 거쳐 보드에 공급한다. 전원 순단은 릴레이로 흉내 낸다.
- 액추에이터를 붙일 때는 부하를 분리한 상태에서 시작한다. 회전체·고전류·열을 다루지 않는다.
- 실제 차량 대신 **책상 위 두 노드**로 시작한다. 7장의 벤치와 16장의 ESP35 장치가 이 축소판 HIL의 재료다.

## 25.6 CI에 어디까지 넣을까

| 계층 | CI | 이유 |
|---|---|---|
| 단위 | 매 push | 빠르고 결정적 |
| 로그 재생 | 매 push | 파일만 있으면 재현 |
| 가짜 ECU 통합 | 매 push 또는 nightly | virtual은 빠르지만 스레드·시간 의존 |
| HIL | nightly | 장비·실시간·전원 필요 |
| 실차 | 수동 | 사람·안전·법규 |

GitHub Actions 예시는 다음과 같다.

```yaml
name: test
on: [push, pull_request]
jobs:
  pytest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
      - run: uv sync
      - run: uv run pytest -q
```

- CAN 하드웨어가 필요 없는 테스트만 CI에 넣는다. virtual·로그 재생·순수 함수가 여기에 해당한다.
- HIL은 self-hosted runner에 장비를 붙여 nightly로 돌린다. 장비 상태·전원·펌웨어 버전을 로그에 남긴다.
- 실차 시험은 CI가 아니라 **체크리스트와 사람**이 담당한다. 11장의 안전 규칙을 자동화로 대체할 수 없다.

### 테스트 산출물

- 실패한 테스트의 **원시 CAN 프레임**을 아티팩트로 남긴다. 로그가 없으면 재현이 어렵다.
- 사용한 DBC·펌웨어 커밋·어댑터·비트레이트를 기록한다. "내 환경에서는 된다"를 없앤다.
- 커버리지는 참고만 한다. 100% 커버리지가 배선 오류를 잡지는 않는다.
- 테스트 이름에 **무엇을 검증하는지** 쓴다. `test_obd_2`보다 `test_unsupported_pid_times_out`이 낫다.

## 25.7 흔한 실수

| 실수 | 결과 | 대신 |
|---|---|---|
| 실제 시간 `sleep`으로 타임아웃 테스트 | CI가 느리고 불안정 | 가짜 시계·짧은 타임아웃 |
| `FakeEcu.answer()`를 직접 호출 | 프레임·주소·ISO-TP 버그를 놓침 | 버스 경계에서 요청 |
| fixture 정리 누락 | 다음 테스트가 이전 응답을 받음 | `finally`에서 bus/thread 종료 |
| 로그의 절대 타임스탬프에 의존 | 다른 날 재생 시 실패 | 첫 프레임 기준 상대 시간 |
| 골든 파일 자동 갱신 | 버그를 정상으로 덮음 | diff 리뷰 후 수동 갱신 |
| 실차에서만 E2E | 느리고 위험, 재현 불가 | 단위→재생→가짜 ECU→HIL |
| HIL을 만능으로 기대 | 실제 도로·EMC 문제를 놓침 | HIL + 실차 + 인증 시험 |
| 오류 로그에 원시 프레임 없음 | 실패 원인 추적 불가 | ID·DLC·바이트·시각 저장 |

## 25.8 체크리스트

- [ ] PID 공식·파서·ISO-TP 조립기에 단위 테스트가 있는가
- [ ] 짧은 데이터·잘못된 시퀀스·다른 CAN ID를 테스트하는가
- [ ] 청크 경계를 바꿔도 결과가 같은가
- [ ] 실제 로그를 픽스처로 쓰고, 개인정보를 제거했는가
- [ ] 가짜 ECU를 버스 경계에서 테스트하는가
- [ ] fixture가 버스·스레드를 정리하는가
- [ ] 타임아웃·재시도·버퍼 정리를 테스트하는가
- [ ] HIL의 실시간성·전원·안전을 문서화했는가
- [ ] CI에 하드웨어 의존 테스트를 넣지 않았는가
- [ ] 실패 시 원시 프레임과 환경 정보를 남기는가

## 장 요약

- 테스트 피라미드를 CAN에 맞추면 단위 → 로그 재생 → 가짜 ECU 통합 → HIL → 실차 순이다.
- PID 공식·파서·ISO-TP 조립기는 순수 함수에 가깝게 만들어 pytest로 빠르게 테스트한다.
- 청크 경계 불변식(`parse(full) == parse(byte_by_byte)`)은 시리얼·BLE 버그를 잡는다.
- candump 로그 재생은 실제 프레임에 대한 회귀 테스트다. 타임스탬프는 상대 시간으로 다룬다.
- 가짜 ECU는 버스 경계에서 테스트한다. `answer()` 직접 호출은 프레임·주소·ISO-TP 버그를 놓친다.
- HIL은 실제 ECU + 실시간 시뮬레이션 + 전기 I/O다. 실시간성·재현성이 강점이고, 실제 도로·EMC를 대신하지 못한다.
- CI에는 단위·로그 재생·가짜 ECU를 넣고, HIL은 nightly, 실차는 사람이 체크리스트로 확인한다.
- 실패 시 원시 프레임·DBC·펌웨어·환경을 남겨야 재현할 수 있다.

## 연습 문제

### 1. (기초) 테스트 계층 분류

다음 테스트를 단위·로그 재생·가짜 ECU 통합·HIL·실차 중 어디에 두는 것이 적절한가?

1. `parse_pid(0x0C, b"\x1A\xF8") == 1726`
2. 저장한 candump 로그를 디코딩해 rpm 시계열이 이전과 같은지 확인
3. 가짜 ECU에 PID 0C를 요청해 `41 0C 1A F8`을 받는지 확인
4. 실제 ECU에 센서 단선 신호를 넣고 경고등 프레임이 나오는지 확인
5. 정차한 차에서 ELM327로 PID 0C를 읽어 계기판과 비교

### 2. (중급) 실패하는 테스트

`parse_pid(0x0C, b"\x1A")`가 `None`이 아니라 `IndexError`를 낸다. 어떤 테스트를 추가하고, 코드를 어떻게 고치겠는가?

### 3. (중급) 로그 재생의 결정성

로그 재생 테스트가 실행할 때마다 실패했다 성공했다 한다. 원인 후보를 세 가지 쓰고, 각각의 해결책을 쓰라.

### 4. (중급) 가짜 ECU 테스트

가짜 ECU의 `answer()`를 직접 호출하는 테스트와, 버스에 요청을 보내는 테스트의 차이를 설명하라. 후자가 잡는 버그를 두 가지 쓰라.

### 5. (심화) HIL의 한계

HIL 시뮬레이터에서 모든 테스트를 통과했다. 실제 차량에 올리기 전에 무엇을 더 확인해야 하는가? 세 가지를 쓰라.

## 정답과 해설

### 1.

1. 단위. 순수 함수다.
2. 로그 재생 회귀. 실제 프레임을 픽스처로 쓴다.
3. 가짜 ECU 통합. 버스 경계에서 요청·응답을 본다.
4. HIL. 실제 ECU에 전기적 fault를 주입한다.
5. 실차. 사람이 안전을 확인하며 읽기 전용으로 한다.

### 2.

`parse_pid`에 길이 검사를 추가하고, `test_parse_pid_rejects_short_data` 같은 테스트를 넣는다. 예: `if pid == 0x0C and len(data) >= 2: ...` 그렇지 않으면 `None`. 빈 데이터·1바이트·PID별 최소 길이를 parametrize한다.

### 3.

- 실제 시간 `sleep`에 의존 → 가짜 시계 또는 `speed`를 크게 한 즉시 재생.
- 로그의 절대 타임스탬프에 의존 → 첫 프레임 기준 상대 시간.
- 스레드·버스 정리 누락으로 이전 응답이 섞임 → fixture `finally`에서 정리, 테스트마다 고유 채널.
- 부동소수점 비교 → `pytest.approx` 또는 반올림 규칙.
- 로그 순서가 같은 타임스탬프에서 불안정 → 정렬 키를 명시.

### 4.

`answer()` 직접 호출은 애플리케이션 데이터만 본다. 버스 테스트는 CAN ID, SF/FF/CF, FC, 패딩, 응답 주소까지 포함한다. 후자가 잡는 예: 응답 ID를 7E8이 아니라 7E0으로 보내는 버그, SF 길이를 잘못 넣는 버그, FF 뒤 FC를 기다리지 않는 버그.

### 5.

예: 실제 배선·커넥터·접지, 전원 변동·load dump·크랭킹, 온도·진동·EMC, 실제 센서·액추에이터의 비선형성, 장시간 운행·노화, 법규·인증 시험. HIL은 재현 가능한 실험실이고, 실제 차량과 도로를 대신하지 않는다.
