# 20장 CAN 기록과 데이터 파이프라인

## 이 장에서

웹 개발자는 로그·메트릭·트레이스를 수집해 저장하고 시각화하는 일에 익숙하다. CAN도 똑같다. 버스에서 프레임을 받아 **원본 그대로 저장**하고, 필요할 때 디코딩해 시계열로 만들고, 대시보드와 알람에 연결한다. 다른 점은 프레임의 의미가 데이터 안에 없고, 시간·버스·오류 상태를 함께 남겨야 한다는 것이다.

이 장의 흐름은 다음과 같다.

```text
수집(candump/python-can) → 원본 로그 → 디코딩(DBC/ISO-TP) → 저장(SQLite/TSDB)
                                      → 시각화(Grafana/웹) → 알람
```

웹과 대응시키면 다음과 같다.

| 웹 | CAN |
|---|---|
| 액세스 로그 | candump/ASC/BLF 원본 프레임 |
| 구조화 로그(JSON) | DBC로 디코딩한 신호 |
| Kafka/수집 파이프라인 | 로거·버퍼·전송 |
| ClickHouse/Postgres | SQLite·InfluxDB·TimescaleDB |
| Grafana 대시보드 | CAN 신호 대시보드 |
| APM 알람 | 냉각수·전압·Bus-Off 알람 |
| 개인정보 마스킹 | VIN·GPS·주행 경로 제거 |

이 장에서 다루는 것:

- candump·ASC·BLF·MF4 형식의 차이와 선택 기준
- python-can과 asammdf로 로그 읽기
- DBC로 원시 프레임을 신호로 디코딩하기
- SQLite와 InfluxDB에 시계열 저장하기
- 백프레셔·타임스탬프·중복·보존·개인정보를 고려한 파이프라인 설계

## 20.1 원시 기록이 원본이다

디코딩한 값만 저장하면 편해 보인다. 하지만 파서나 DBC가 틀렸을 때 되돌아갈 수 없다. **원시 프레임과 시각, 버스, 방향, 오류 상태를 원본으로 남기고, 디코딩 결과는 파생 데이터로 취급한다.**

원본에 남길 것:

- **시각**: 가능하면 마이크로초 이상. 절대 시각(UTC)과 단조 시각을 함께.
- **버스/인터페이스**: `can0`, `vcan0`, 채널 번호.
- **CAN ID와 확장 여부**: 11비트/29비트.
- **DLC와 데이터 바이트**: 패딩 포함.
- **방향**: RX/TX.
- **프레임 종류**: 데이터, 원격, 오류, FD(BRS/ESI).
- **환경**: 비트레이트, 어댑터, DBC 버전, 펌웨어 버전.

디코딩 결과에는 다음을 붙인다.

- 사용한 DBC 파일과 버전
- 신호 이름, 값, 단위, 배율·오프셋
- 디코딩 시각과 코드 버전
- 신뢰도(실차 확인/문헌 기반/추정)

이렇게 해야 "그때 그 값이 왜 그렇게 나왔는가"를 재현할 수 있다.

## 20.2 로그 형식 비교

| 형식 | 종류 | 장점 | 단점 | 잘 맞는 용도 |
|---|---|---|---|---|
| candump log(`.log`) | 텍스트 | 단순, `canplayer`·python-can 호환, 사람이 읽기 쉬움 | 메타데이터·단위가 거의 없음, 파일이 큼 | 빠른 기록, 재생, 테스트 픽스처 |
| ASC(`.asc`) | 텍스트 | Vector 도구 호환, 헤더·방향·오류/FD 정보 | 파일이 큼, 도구마다 미세한 차이 | 벤치 분석, 도구 교환 |
| BLF(`.blf`) | 바이너리 | 압축적, 빠름, Vector 생태계 호환 | 사람이 읽기 어려움, 라이브러리 필요 | 장시간 기록, 대용량 |
| MF4(`.mf4`) | 바이너리(ASAM MDF) | 채널·단위·메타데이터, 측정 도구 호환 | CAN 전용이 아님, 큰 도구 체인 | 측정 데이터 아카이브, 분석 |
| CSV | 텍스트 | 어디서나 열림, 간단 | 타입·메타데이터 손실, 크기 | 디버깅, 작은 표 |
| SQLite | 데이터베이스 | SQL 질의, 인덱스, 단일 파일 | 실시간 대량 쓰기에 부적합 | 로컬 분석, 소규모 파이프라인 |

### candump log

```text
(1000.000000) vcan0 7DF#02010C0000000000
(1000.100000) vcan0 7E8#04410C1AF8000000
```

- `(타임스탬프) 인터페이스 ID#데이터` 형식이다. 타임스탬프는 초 단위, 인터페이스 이름은 기록 당시 이름이다.
- `canplayer`와 python-can `CanutilsLogReader`가 읽는다.
- 확장 ID는 ID 자릿수로 구분한다. 8자리면 29비트 확장 ID로 해석하는 규칙이 있다.
- 오류 프레임·FD 플래그를 표현하는 데 한계가 있다. 필요하면 ASC/BLF를 쓴다.

### ASC

python-can으로 만든 ASC 파일의 형식은 다음과 같다. 요청과 응답을 함께 넣은 예다.

```text
date Wed Oct 28 23:27:19.173 2026
base hex  timestamps absolute
internal events logged
Begin Triggerblock Thu Jan 01 09:16:40.0 1970
 0.000000 Start of measurement
 0.000000 1  7DF             Rx   d 8 02 01 0C CC CC CC CC CC
 0.100000 1  7E8             Rx   d 8 04 41 0C 1A F8 00 00 00
End TriggerBlock
```

- 헤더에 날짜·기준·타임스탬프 방식이 들어간다.
- 각 줄에 채널, ID, 방향(Rx/Tx), 프레임 종류(d), DLC, 데이터가 들어간다.
- FD 프레임은 `CANFD` 같은 표시와 BRS/ESI 플래그가 붙는다. 도구·버전에 따라 표기가 다르다.
- 사람이 읽을 수 있고 Vector 도구와 교환하기 좋지만, 파일이 크다.

### BLF

BLF는 Vector의 바이너리 로그다. 파일 시작에 `LOGG` 매직이 보인다.

```text
00000000: 4c4f 4747 9000 0000 0500 0000 0206 0801  LOGG............
```

- 바이너리라서 텍스트 편집기로 읽을 수 없다. `can.BLFReader`·Vector 도구로 읽는다.
- 프레임·오류·FD 정보를 구조적으로 담고, 장시간 기록에 유리하다.
- 라이선스·도구 호환성을 확인한다. 모든 도구가 BLF를 읽는 것은 아니다.

### MF4(ASAM MDF)

MF4는 ASAM MDF(Measurement Data Format) 4.x의 파일 확장자다. CAN 로그 전용이 아니라 **측정 채널과 메타데이터를 담는 컨테이너**다.

- 채널마다 이름·단위·설명·샘플레이트를 가질 수 있다.
- python-can은 `MF4Writer`/`MF4Reader`로 CAN 프레임을 MF4에 쓰고 읽는다. 내부적으로 `asammdf`가 필요하다.
- asammdf로 열면 `CAN_DataFrame.ID`, `CAN_DataFrame.DataBytes`, `CAN_DataFrame.DLC` 같은 채널이 보인다.
- 측정·분석 도구와 교환하기 좋지만, 파일과 도구가 무겁다. "일단 원본 프레임을 남기는" 용도로는 candump/BLF가 가볍다.

## 20.3 로그 읽기

### python-can

```python
import can

reader = can.LogReader("capture.log")   # 확장자로 형식 자동 선택
try:
    for msg in reader:
        print(
            f"{msg.timestamp:.6f} "
            f"{msg.arbitration_id:03X} "
            f"{'EXT' if msg.is_extended_id else 'STD'} "
            f"{msg.dlc} {msg.data.hex(' ')}"
        )
finally:
    reader.stop()
```

- `can.LogReader`는 `.log`, `.asc`, `.blf`, `.csv` 등을 확장자로 고른다. `.mf4`는 asammdf가 설치되어 있어야 한다.
- `msg.timestamp`는 초 단위 float다. 마이크로초 정밀도를 기대하려면 원본 형식과 어댑터를 확인한다.
- `msg.is_error_frame`, `msg.is_remote_frame`, `msg.is_fd`, `msg.bitrate_switch`를 함께 출력하면 오류·FD 프레임을 구분할 수 있다.
- `reader.stop()`을 호출해 파일 핸들을 닫는다.

### 쓰기

```python
import can

messages = [
    can.Message(
        timestamp=1000.0,
        arbitration_id=0x7DF,
        is_extended_id=False,
        data=bytes.fromhex("02 01 0C CC CC CC CC CC"),
    )
]
logger = can.Logger("capture.asc")
try:
    for msg in messages:
        logger(msg)
finally:
    logger.stop()
```

- `can.Logger`는 확장자로 writer를 고른다. `.log`(candump), `.asc`, `.blf`, `.csv`, `.mf4` 등.
- 로거를 별도 스레드나 프로세스로 두면 수집과 저장을 분리할 수 있다. 버스 수신이 느려지면 프레임을 놓치므로, 링 버퍼와 백프레셔 정책을 정한다.
- 로그를 주기적으로 닫고 새 파일로 회전한다. 파일이 너무 커지면 분석·백업·전송이 어려워진다.

### MF4 읽기

```python
from asammdf import MDF

mdf = MDF("capture.mf4")
try:
    print(mdf.channels_db)          # 채널 이름과 그룹
    ids = mdf.get("CAN_DataFrame.ID")
    data = mdf.get("CAN_DataFrame.DataBytes")
    print(ids.samples[:5])
    print(data.samples[:1])
finally:
    mdf.close()
```

- `DataBytes`는 고정 폭 바이트 배열로 저장된다. 클래식 CAN 8바이트도 64바이트로 패딩되어 보일 수 있다.
- 채널 이름은 writer·버전에 따라 다르다. `channels_db`를 먼저 출력해 확인한다.
- MF4는 신호 단위·설명을 담기 좋지만, 원시 프레임을 그대로 넣었는지, 디코딩된 신호를 넣었는지 파일마다 다르다. 메타데이터를 확인한다.

## 20.4 DBC로 신호 디코딩

6장에서 DBC의 개념을 보았다. 여기서는 로그를 신호로 바꾸는 파이프라인에 집중한다.

```text
VERSION ""
NS_ :
BS_:
BU_: ECU
BO_ 256 EngineData: 8 ECU
 SG_ RPM : 0|16@1+ (0.25,0) [0|16383.75] "rpm" ECU
 SG_ Speed : 16|8@1+ (1,0) [0|255] "km/h" ECU
```

```python
import cantools

dbc_text = """VERSION ""
NS_ :
BS_:
BU_: ECU
BO_ 256 EngineData: 8 ECU
 SG_ RPM : 0|16@1+ (0.25,0) [0|16383.75] "rpm" ECU
 SG_ Speed : 16|8@1+ (1,0) [0|255] "km/h" ECU
"""
db = cantools.database.load_string(dbc_text, "dbc")
msg = db.get_message_by_name("EngineData")

encoded = msg.encode({"RPM": 1726, "Speed": 50})
print(encoded.hex(" "))          # f8 1a 32 00 00 00 00 00
print(msg.decode(encoded))       # {'RPM': 1726.0, 'Speed': 50}
```

- `encode()`/`decode()`는 배율·오프셋·부호·엔디언을 적용한다.
- DBC의 시작 비트와 바이트 순서는 헷갈리기 쉽다. `@1`은 Intel(little-endian), `@0`은 Motorola(big-endian)다.
- DBC에 없는 ID는 `KeyError`가 난다. 건너뛰되 **디코딩하지 않은 ID 수**를 메트릭으로 남긴다.
- DBC 버전과 원본 로그를 함께 보관한다. DBC가 바뀌면 같은 로그도 다른 값이 된다.
- 공개 DBC는 차량·연식·옵션마다 다르다. 라이선스와 적용 범위를 확인한다.

### 로그 → 신호 테이블

```python
import can
import cantools

db = cantools.database.load_file("vehicle.dbc")
reader = can.LogReader("capture.blf")
rows = []
try:
    for msg in reader:
        if msg.is_error_frame or msg.is_remote_frame:
            continue
        try:
            values = db.decode_message(msg.arbitration_id, msg.data)
        except KeyError:
            continue
        for name, value in values.items():
            rows.append((msg.timestamp, name, float(value)))
finally:
    reader.stop()
```

- 오류·원격 프레임은 신호 디코딩에서 제외한다.
- 한 프레임에 여러 신호가 있으면 신호별 행으로 펼친다. 저장소에 따라 JSON 한 행이 나을 수도 있다.
- 디코딩 결과가 물리적으로 말이 되는지 확인한다. rpm이 음수이거나 냉각수가 200°C면 DBC·바이트 순서를 의심한다.

## 20.5 저장: SQLite와 InfluxDB

### SQLite: 작은 파이프라인에 충분하다

SQLite는 파일 하나로 끝나는 데이터베이스다. 노트북·라즈베리파이·현장 장비에서 로컬 분석용으로 좋다.

```python
import sqlite3

con = sqlite3.connect("can.db")
con.execute("""
CREATE TABLE IF NOT EXISTS frames (
    ts REAL NOT NULL,
    bus TEXT NOT NULL,
    can_id INTEGER NOT NULL,
    extended INTEGER NOT NULL,
    dlc INTEGER NOT NULL,
    data BLOB NOT NULL
)
""")
con.execute("CREATE INDEX IF NOT EXISTS idx_frames_ts ON frames(ts)")
con.execute("CREATE INDEX IF NOT EXISTS idx_frames_id_ts ON frames(can_id, ts)")

rows = [
    (1000.0, "vcan0", 0x7DF, 0, 8, bytes.fromhex("02010C0000000000")),
    (1000.1, "vcan0", 0x7E8, 0, 8, bytes.fromhex("04410C1AF8000000")),
]
con.executemany("INSERT INTO frames VALUES (?, ?, ?, ?, ?, ?)", rows)
con.commit()
con.close()
```

- `ts`는 REAL(초) 또는 INTEGER(마이크로초/나노초)로 저장한다. 정밀도가 필요하면 정수 마이크로초를 권한다.
- `data`는 BLOB으로 원시 바이트를 그대로 넣는다. hex 문자열보다 작고, 다시 파싱하기 쉽다.
- 인덱스는 `(can_id, ts)`와 `(ts)`를 기본으로 둔다. 모든 컬럼에 인덱스를 만들면 쓰기가 느려진다.
- WAL 모드(`PRAGMA journal_mode=WAL`)를 쓰면 읽기와 쓰기 동시성이 좋아진다. 장시간 수집에는 필수에 가깝다.
- SQLite는 단일 writer에 적합하다. 초당 수만 프레임을 여러 프로세스가 쓰는 용도라면 TSDB나 메시지 큐를 검토한다.

디코딩한 신호를 별도 테이블에 넣으면 질의가 쉬워진다.

```sql
CREATE TABLE signals (
    ts REAL NOT NULL,
    name TEXT NOT NULL,
    value REAL NOT NULL
);
CREATE INDEX idx_signals_name_ts ON signals(name, ts);

-- 10초 버킷 평균 rpm
SELECT CAST(ts / 10 AS INTEGER) * 10 AS bucket, AVG(value)
FROM signals
WHERE name = 'rpm'
GROUP BY bucket
ORDER BY bucket;
```

- 원본 `frames`와 파생 `signals`를 모두 유지한다. `signals`는 언제든 다시 만들 수 있어야 한다.
- 버킷 크기는 질의 목적에 맞춘다. 1초 버킷은 세밀하지만 행이 많고, 1분 버킷은 추세에 좋다.

### InfluxDB: 시계열 질의와 보존 정책

InfluxDB 같은 TSDB는 시간 범위 질의·다운샘플링·보존 정책에 강하다. 라인 프로토콜 예는 다음과 같다.

```text
engine,source=obd rpm=1726.0,speed=50i 1793197633000000000
```

- 측정 이름 `engine`, 태그 `source=obd`, 필드 `rpm=1726.0`, `speed=50i`, 타임스탬프는 나노초(UTC)다.
- **태그는 인덱스된다.** 카디널리티가 낮은 값(버스, 소스, 차량 별칭)을 태그로 쓴다. VIN·세션 ID·주행 ID처럼 값이 계속 늘어나는 것을 태그로 넣으면 시리즈가 폭증한다.
- 필드는 값이다. rpm·speed·coolant처럼 수치가 계속 변하는 것을 필드로 둔다.
- 보존 정책(retention)으로 오래된 원본을 자동 삭제하고, 다운샘플을 별도 보존한다. 원본을 지우기 전에 필요한 해상도를 확인한다.
- TimescaleDB(PostgreSQL 확장)는 SQL 친화적이다. 이미 PostgreSQL을 쓰는 팀이라면 선택지가 된다.
- 웹의 Prometheus/Grafana 경험이 있다면 개념이 거의 같다. 다만 CAN은 초당 프레임 수가 많고, 원본 바이트를 함께 저장해야 한다.

## 20.6 파이프라인 설계

```text
[버스] → [수신 링 버퍼] → [원본 로거] → [디코더] → [저장소] → [대시보드/알람]
              │                              │
              └── 프레임 드롭 카운터          └── DBC 버전
```

### 백프레셔

- 버스는 기다려 주지 않는다. 디스크·네트워크·DB가 느리면 링 버퍼가 차고 프레임을 놓친다.
- **드롭 정책**을 정한다. 오래된 프레임을 버릴지, 원본만 저장하고 디코딩을 나중에 할지, 버스 부하를 낮출지.
- 드롭 수·버퍼 하이워터마크·마지막 처리 시각을 메트릭으로 남긴다. "로그에 구멍이 있다"를 나중에 발견하면 원인을 못 찾는다.
- 원본 로거를 디코더보다 앞에 둔다. 디코더가 느려도 원본은 남는다.

### 타임스탬프

- **절대 시각(UTC)**: 여러 장비·로그를 맞출 때. NTP 동기화 오차를 기록한다.
- **단조 시각**: 경과 시간·주기·타임아웃. 벽시계가 바뀌어도 영향을 받지 않는다.
- 두 시각을 함께 저장하고, 변환 규칙을 문서화한다.
- 타임존은 저장하지 말고 UTC로 저장한다. 표시할 때 로컬 시간으로 바꾼다.
- 로그의 첫 프레임 기준 상대 시간은 재생·테스트에 유용하다.

### 중복과 순서

- CAN은 재전송이 있다. 같은 프레임이 두 번 올 수 있다.
- 파이프라인이 at-least-once라면 중복이 생긴다. `(타임스탬프, CAN ID, 데이터)` 해시나 시퀀스로 중복을 제거한다.
- 순서가 뒤바뀔 수 있는 전송(UDP 멀티캐스트 등)은 타임스탬프로 정렬한다. 단, 같은 타임스탬프의 순서는 보장하지 않는다.
- 멱등성 키를 정해 두면 재처리·재전송이 안전해진다.

### 보존과 회전

- 원본은 압축·체크섬과 함께 보관한다. 삭제 정책과 백업을 정한다.
- 파일 회전은 크기·시간·프레임 수 기준으로 한다. 회전 중 프레임을 잃지 않도록 원자적으로 이름을 바꾼다.
- 장시간 로그는 날짜·차량 별칭·DBC 버전으로 디렉터리를 나눈다.
- 로그에 비밀값(인증 토큰, 개인정보)을 남기지 않는다.

### 개인정보

- VIN·번호판·GPS·주행 경로·연락처는 로그에 남기지 않거나, 저장 전에 해시/별칭으로 바꾼다.
- 원본을 공개할 때는 프레임에 VIN이 들어 있는지 확인한다. Mode 09 응답, UDS DID, 인포테인먼트 로그에 섞일 수 있다.
- 접근 제어·암호화·보존 기간을 정한다. 9장의 개인정보 규칙이 파이프라인에도 적용된다.

## 20.7 시각화와 알람

### 질의

```sql
-- 최근 10분 rpm 통계
SELECT
  MIN(value) AS min_rpm,
  AVG(value) AS avg_rpm,
  MAX(value) AS max_rpm,
  COUNT(*) AS samples
FROM signals
WHERE name = 'rpm'
  AND ts >= CAST(strftime('%s', 'now') AS INTEGER) - 600;
```

- SQLite의 `strftime('%s','now')`는 UTC 초를 돌려준다. `ts`를 초로 저장했다면 비교할 수 있다.
- InfluxDB는 `SELECT mean("rpm") FROM "engine" WHERE time > now() - 10m GROUP BY time(10s)` 같은 질의를 쓴다.
- 대시보드는 Grafana·웹 앱·노트북 모두 가능하다. 중요한 것은 **원본과 디코딩 버전을 함께 보여 주는 것**이다.

### 알람

알람은 "값이 높다"보다 **지속 시간·히스테리시스·맥락**이 중요하다.

- 냉각수 110°C 초과가 5초 이상 지속될 때.
- 전압 11V 미만이 10초 이상, 시동 OFF 상태는 제외.
- Bus-Off 이벤트가 한 번이라도 발생했을 때.
- 로그 드롭·DBC 미지원 ID 비율이 임계값을 넘을 때.

- 알람이 너무 많으면 무시하게 된다. 임계값·지속 시간·복구 조건을 튜닝한다.
- 알람에는 원시 프레임·DBC 버전·차량 상태를 붙인다. "rpm 알람"만으로는 원인을 못 찾는다.
- 실제 차량에서 알람을 시험할 때는 정차 상태에서 읽기만 한다. 알람 때문에 운전 중 화면을 보지 않는다.

## 20.8 흔한 실수

| 실수 | 결과 | 대신 |
|---|---|---|
| 디코딩 값만 저장 | DBC·파서 오류를 복구할 수 없음 | 원시 프레임 + 디코딩 버전 저장 |
| 절대 시각만 저장 | 재생·경과 시간 계산이 어려움 | UTC + 단조 시각 |
| VIN을 태그로 사용 | 시리즈 폭증, 개인정보 노출 | 별칭/해시, 낮은 카디널리티 태그 |
| 로그 회전 중 파일 유실 | 구멍 난 로그 | 원자적 회전, 드롭 카운터 |
| 오류 프레임을 신호로 디코딩 | 엉뚱한 값 | `is_error_frame` 제외 |
| DBC 없이 ID만 저장 | 나중에 해석 불가 | DBC 버전·출처 함께 보관 |
| 테스트에서 절대 타임스탬프 사용 | 다른 날 실패 | 첫 프레임 기준 상대 시간 |
| 알람 임계값만 보고 지속 시간 무시 | 순간 스파이크에 울림 | 지속 시간·히스테리시스 |

## 20.9 체크리스트

- [ ] 원시 프레임·시각·버스·방향·오류 상태를 저장하는가
- [ ] 절대 시각과 단조 시각을 구분했는가
- [ ] DBC 버전·출처·라이선스를 함께 보관하는가
- [ ] 로그 형식의 장단점을 알고 골랐는가
- [ ] 드롭·백프레셔를 메트릭으로 남기는가
- [ ] 중복·순서·재처리를 고려했는가
- [ ] 보존·회전·백업 정책이 있는가
- [ ] VIN·GPS·주행 경로를 제거했는가
- [ ] 알람에 지속 시간·히스테리시스·맥락이 있는가
- [ ] 실제 차량에서는 읽기 전용인가

## 장 요약

- 원시 프레임과 시각·버스·방향·오류 상태가 원본이다. 디코딩 값은 파생 데이터다.
- candump log는 단순·재생에, ASC는 도구 교환에, BLF는 대용량·구조화에, MF4는 측정 메타데이터에 강하다.
- python-can `LogReader`/`Logger`로 형식을 읽고 쓰며, MF4는 asammdf가 필요하다.
- DBC로 프레임을 신호로 디코딩하되, DBC 버전과 원본 로그를 함께 보관한다.
- SQLite는 작은 파이프라인에 충분하고, InfluxDB/TimescaleDB는 시계열 질의·보존에 강하다.
- 파이프라인은 수신 → 원본 로거 → 디코더 → 저장 → 시각화/알람 순으로 두고, 백프레셔·드롭·중복·타임스탬프를 설계한다.
- 개인정보와 높은 카디널리티를 피하고, 알람에는 지속 시간·히스테리시스·맥락을 넣는다.

## 연습 문제

### 1. (중급) 형식 선택

다음 요구에 맞는 로그 형식을 고르고 이유를 쓰라.

1. 8시간 동안 원시 CAN 프레임을 최대한 작게 기록하고 Vector 도구로 열고 싶다.
2. 테스트 픽스처로 쓰려고 사람이 읽을 수 있는 작은 로그를 만들고 싶다.
3. 채널·단위·설명이 있는 측정 데이터를 분석 도구와 교환하고 싶다.
4. 노트북에서 SQL로 rpm 추세를 조회하고 싶다.

### 2. (중급) 타임스탬프

로그에 절대 시각만 저장했더니 재생할 때 문제가 생겼다.

1. 어떤 문제가 생기는가?
2. 절대 시각과 단조 시각을 어떻게 함께 쓸 것인가?
3. 타임존은 어떻게 저장하는가?

### 3. (중급) 카디널리티

InfluxDB에 `vehicle` 태그로 VIN을 넣으려 한다.

1. 왜 문제인가?
2. 대신 무엇을 태그로 쓸 수 있는가?
3. VIN이 꼭 필요하면 어떻게 저장하는가?

### 4. (중급) 원본과 파생

디코딩한 rpm 값만 DB에 저장했다. 나중에 DBC의 바이트 순서가 틀렸다는 것을 발견했다.

1. 무엇을 할 수 없는가?
2. 원본을 함께 저장했다면 어떻게 복구하는가?
3. 앞으로 어떤 메타데이터를 함께 남겨야 하는가?

### 5. (중급) 알람 설계

냉각수 온도가 110°C를 넘을 때 알람을 만들려 한다. 순간 스파이크가 자주 있어 알람이 너무 많이 울린다.

1. 지속 시간과 히스테리시스를 어떻게 넣겠는가?
2. 시동 OFF 상태를 어떻게 제외하겠는가?
3. 알람에 어떤 맥락을 붙이겠는가?

## 정답과 해설

### 1.

1. BLF. 바이너리라 작고, Vector 도구가 읽는다. ASC는 텍스트라 크고, candump log는 메타데이터가 적다.
2. candump log. `(타임스탬프) 인터페이스 ID#데이터` 형식이라 사람이 읽고 `can.LogReader`로 재생하기 쉽다.
3. MF4. 채널·단위·설명을 담는 ASAM MDF 형식이다.
4. SQLite. 파일 하나로 SQL 질의가 가능하고, 작은 파이프라인에 충분하다.

### 2.

1. 며칠 전 로그를 재생하면 첫 프레임까지의 절대 시간 차이가 커서, 그대로 기다릴 수 없다. 벽시계가 바뀌면 경과 시간도 틀어진다.
2. 절대 시각(UTC)은 여러 로그를 맞추는 데, 단조 시각은 경과·주기·타임아웃에 쓴다. 로그에는 둘을 함께 남기고, 재생은 첫 프레임 기준 상대 시간으로 한다.
3. UTC로 저장하고, 표시할 때 로컬 타임존으로 변환한다.

### 3.

1. VIN은 차량마다 다르고 시간이 지나도 늘어난다. 태그로 쓰면 시리즈 수가 차량 수만큼 늘어나 메모리·인덱스가 폭증한다. 개인정보이기도 하다.
2. `source=obd`, `bus=powertrain`, `vehicle_class=sedan`처럼 낮은 카디널리티 값을 태그로 쓴다.
3. VIN은 해시/별칭으로 바꾸거나, 접근이 제한된 별도 테이블에 두고 태그에는 별칭만 쓴다. 원본 VIN은 로그에 남기지 않는다.

### 4.

1. 원시 바이트가 없어서 다시 디코딩할 수 없다. 잘못된 값만 남아 있다.
2. 원본 프레임을 올바른 DBC로 다시 디코딩해 `signals`를 재생성한다.
3. 원본 프레임, 사용한 DBC 파일·버전, 디코더 코드 버전, 디코딩 시각, 신호 정의(배율·오프셋·단위)를 남긴다.

### 5.

1. "110°C 초과가 5초 이상 지속"으로 지속 시간을 넣고, 복구는 105°C 미만으로 내려갈 때로 히스테리시스를 둔다.
2. rpm=0·차속=0·시동 상태 PID(01 01)를 함께 보고, 시동 OFF 구간은 알람에서 제외한다. 차량별로 판단 기준을 문서화한다.
3. 원시 프레임, DBC 버전, 타임스탬프, 차량 상태, 최근 추세, 알람 발생·복구 시각을 붙인다.
