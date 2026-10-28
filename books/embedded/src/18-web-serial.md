# 15장 브라우저에서 시리얼 다루기

## 이 장에서

7장에서는 파이썬이 시리얼 포트를 열어 ELM327과 대화했다. 그런데 현장에서 차량을 빠르게 확인하고 싶을 때, 노트북에 파이썬 환경을 만들고 Flask 서버를 띄우는 일이 부담스러울 수 있다. 브라우저에서 바로 시리얼 포트를 열 수 있다면? **Web Serial API**가 그 길을 연다.

웹 개발자에게 이 장은 두 가지 의미가 있다.

1. **브라우저가 하드웨어에 닿는 경계**를 이해한다. 지금까지 브라우저는 USB·시리얼·블루투스에 직접 접근하지 못했다. Web Serial·Web Bluetooth는 그 경계를 좁히지만, 보안 모델과 사용자 동의가 붙는다.
2. **7장의 파이썬 대시보드와 역할을 비교**한다. 브라우저는 설치·배포가 쉽고, 파이썬은 장시간 로깅·자동화에 강하다. 둘 중 하나가 정답이 아니라, 상황에 따라 고른다.

이 장에서 다루는 것:

- Web Serial API의 지원 브라우저·보안 컨텍스트·사용자 제스처
- ELM327에 연결해 AT 명령과 PID 요청을 보내는 예제
- 청크로 쪼개져 오는 응답의 줄 경계와 `>` 프롬프트 처리
- 7장 파이썬 대시보드와의 비교
- Web Bluetooth로 BLE 방식 ELM327에 연결하는 길과, 블루투스 클래식(SPP)의 한계

**안전 원칙**: 브라우저 예제도 실제 차량에서는 **정차 상태의 읽기 전용**으로만 쓴다. 이 장의 코드는 `AT` 명령과 Mode 01 PID 읽기만 보낸다. 쓰기·삭제·코딩·액추에이터 구동은 넣지 않는다.

## 15.1 브라우저가 시리얼 포트를 여는 방식

전통적인 웹 페이지는 운영체제의 장치에 직접 접근할 수 없다. 브라우저 샌드박스가 막는다. Web Serial API는 **사용자가 명시적으로 포트를 고르고 허가한 경우에만** 페이지에 `SerialPort` 객체를 준다.

```text
[사용자 클릭] → navigator.serial.requestPort()
                 → 브라우저 포트 선택 창
                 → 사용자가 포트 선택
                 → 페이지에 SerialPort 부여
                 → port.open({ baudRate: 38400 })
                 → readable / writable 스트림
```

- 포트 선택은 **사용자 제스처**(클릭 등) 안에서 시작해야 한다. 페이지가 로드되자마자 몰래 포트를 열 수 없다.
- 한 번 허가한 포트는 `navigator.serial.getPorts()`로 다시 가져올 수 있다. 그래도 새 포트를 고를 때는 다시 사용자 제스처가 필요하다.
- 페이지는 **보안 컨텍스트**에서 실행되어야 한다. HTTPS 또는 `localhost`다. `http://192.168.0.10` 같은 주소는 보안 컨텍스트가 아니므로 Web Serial이 동작하지 않는다.
- iframe 안에서 쓰려면 `Permissions-Policy: serial=(self)`와 `allow="serial"`이 필요하다. 서드파티 iframe에 포트 접근을 쉽게 넘기지 않는다.

### 지원 브라우저

2026-10 기준 MDN 브라우저 호환성 데이터는 다음과 같다.

| 브라우저 | Web Serial | Web Bluetooth |
|---|---|---|
| Chrome 데스크톱 | 89+ | 70+ (Linux는 기본 비활성) |
| Edge 데스크톱 | 89+ | 지원 |
| Firefox 데스크톱 | 151+ | 미지원 |
| Safari 데스크톱/iOS | 미지원 | 미지원 |
| Chrome Android | 148+ (138~147은 Bluetooth RFCOMM 포트만 부분 지원) | 56+ |

- 지원 여부는 브라우저 업데이트로 바뀐다. 배포 전에 `'serial' in navigator`로 확인하고, 안 되면 안내 문구를 보여 준다.
- Web Serial은 **직렬 포트**를 다룬다. USB-Serial 칩(CH340, CP210x, FTDI)의 드라이버는 운영체제가 잡는다. 브라우저가 드라이버를 대신 설치하지 않는다. Windows에서 CH340 드라이버가 없으면 포트 자체가 보이지 않는다.
- Web Bluetooth는 **BLE(Bluetooth Low Energy) GATT**만 다룬다. 블루투스 클래식 SPP는 직접 다루지 못한다. 15.7절에서 자세히 다룬다.

### baud rate는 직접 정한다

`port.open()`에는 `baudRate`가 필수다.

```javascript
await port.open({
  baudRate: 38400,
  dataBits: 8,        // 기본값 8
  stopBits: 1,        // 기본값 1
  parity: "none",     // 기본값 none
  flowControl: "none" // 기본값 none
});
```

- ELM327 클론은 38400이 흔하지만 9600인 제품도 있다. 어댑터 설명서를 확인한다.
- Web Serial에는 **자동 보율 감지**가 없다. 7장의 `ATZ`·`ATI`가 깨져 나오면 보율부터 바꿔 본다.
- `port.open()`은 이미 열린 포트에 다시 호출하면 예외가 난다. 연결 상태를 직접 관리한다.

## 15.2 첫 연결: AT 명령 보내기

최소 예제는 다음과 같다. 버튼을 누르면 포트를 고르고, `ATZ`·`ATE0`·`ATL0`·`ATSP0`를 보낸 뒤 `ATI`와 `ATDPN`을 출력한다.

```html
<!doctype html>
<html lang="ko">
<meta charset="utf-8">
<title>ELM327 Web Serial</title>
<button id="connect">ELM327 연결</button>
<pre id="log"></pre>
<script type="module" src="./app.js"></script>
```

`app.js`는 15.3절의 `Elm327Session`을 쓴다.

```javascript
import { Elm327Session } from "./elm327.js";

const logEl = document.getElementById("log");
const log = (line) => {
  logEl.textContent += line + "\n";
};

document.getElementById("connect").addEventListener("click", async () => {
  if (!("serial" in navigator)) {
    log("이 브라우저는 Web Serial을 지원하지 않습니다.");
    return;
  }
  try {
    const port = await navigator.serial.requestPort();
    const elm = new Elm327Session(port);
    await elm.open(38400);
    log("포트를 열었습니다.");

    for (const [cmd, timeout] of [
      ["ATZ", 3000],
      ["ATE0", 1000],
      ["ATL0", 1000],
      ["ATSP0", 10000],
    ]) {
      const lines = await elm.command(cmd, timeout);
      log(`${cmd} → ${lines.join(" | ")}`);
    }
    log(`ATI → ${(await elm.command("ATI")).join(" | ")}`);
    log(`ATDPN → ${(await elm.command("ATDPN")).join(" | ")}`);
  } catch (err) {
    log(`오류: ${err.message}`);
  }
});
```

- `ATZ`는 어댑터 리셋이라 3초 정도 기다린다. `ATSP0`는 프로토콜 자동 검색이라 최대 10초를 준다.
- `ATE0`는 에코 끄기, `ATL0`은 줄바꿈 끄기다. 에코가 켜져 있으면 보낸 명령이 응답에 섞인다. `Elm327Session.command()`는 명령과 같은 줄을 걸러 낸다.
- `ATI`는 어댑터 버전, `ATDPN`은 현재 프로토콜 번호다. `A6`이면 ISO 15765-4 CAN 11비트 500kbps다.

## 15.3 줄 경계와 프롬프트 처리

시리얼은 바이트 스트림이다. `reader.read()`가 돌려주는 `Uint8Array`는 **원하는 크기로 쪼개지지 않는다.** 한 번에 `"41 0C 1A"`까지만 올 수도 있고, `" F8\r\r>"`가 다음 청크에 올 수도 있다. 3장에서 본 프레이밍 문제가 브라우저에서도 그대로다.

ELM327의 응답은 보통 `\r`로 끝나고, 마지막에 `>` 프롬프트가 붙는다.

```text
ATI\rELM327 v1.5\r\r>
010C\r41 0C 1A F8 \r\r>
0902\r014\r0: 49 02 01 54 45 53 \r1: ...\r\r>
```

- 줄 경계는 `\r`(CR)다. `\n`이 아닐 수 있다.
- 프롬프트 `>`는 줄바꿈 없이 마지막 데이터에 붙을 수 있다. `"F8 \r\r>"`처럼.
- `>`를 보기 전에 반환하면 응답을 잘라 먹는다. 다음 명령의 응답과 섞인다.
- `reader.read()`를 명령마다 새로 만들면 스트림 잠금(lock)이 충돌한다. **리더는 하나만** 만들고, 읽기 루프에서 계속 읽는다.

### 줄 파서

```javascript
export class ElmLineParser {
  constructor() {
    this.buf = "";
  }

  feed(text) {
    this.buf += text;
    const lines = [];
    let prompt = false;

    const parts = this.buf.split(/\r\n|\r|\n/);
    this.buf = parts.pop();          // 마지막 조각은 아직 줄이 끝나지 않았을 수 있다
    for (let line of parts) {
      line = line.trim();
      if (!line) continue;
      if (line.endsWith(">")) {
        prompt = true;
        line = line.slice(0, -1).trim();
      }
      if (line) lines.push(line);
    }

    if (this.buf.includes(">")) {    // 프롬프트가 줄바꿈 없이 붙은 경우
      const i = this.buf.indexOf(">");
      const line = this.buf.slice(0, i).trim();
      if (line) lines.push(line);
      this.buf = this.buf.slice(i + 1);
      prompt = true;
    }

    return { lines, prompt };
  }
}
```

- `parts.pop()`으로 마지막 조각을 남긴다. 다음 청크가 이어 붙을 수 있다.
- `>`가 줄 끝에 있으면 떼어 내고 `prompt=true`로 표시한다.
- `>`가 버퍼 중간에 있으면 그 앞까지를 줄로 만들고, 뒤는 다음 명령의 에코일 수 있으므로 버퍼에 남긴다.
- 이 파서는 순수 함수에 가깝다. 브라우저 없이도 Node에서 테스트할 수 있다. 16장의 단위 테스트 대상이다.

### 세션 클래스

읽기 루프 하나와 명령 큐 하나를 두는 것이 핵심이다.

```javascript
import { ElmLineParser } from "./line-parser.js";

export class Elm327Session {
  constructor(port) {
    this.port = port;
    this.parser = new ElmLineParser();
    this.decoder = new TextDecoder();
    this.encoder = new TextEncoder();
    this.lines = [];
    this.busy = false;
    this.pending = null;
    this.reader = null;
    this.writer = null;
  }

  async open(baudRate = 38400) {
    await this.port.open({ baudRate });
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    this.readLoop();                 // 백그라운드에서 계속 읽는다
  }

  async readLoop() {
    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        const { lines, prompt } = this.parser.feed(
          this.decoder.decode(value, { stream: true }),
        );
        this.lines.push(...lines);
        if (prompt && this.pending) {
          const resolve = this.pending;
          this.pending = null;
          resolve();
        }
      }
    } catch (err) {
      if (this.pending) {
        const reject = this.pending.reject;
        this.pending = null;
        reject(err);
      }
    }
  }

  async command(cmd, timeoutMs = 1000) {
    if (this.busy) throw new Error("명령은 한 번에 하나씩 보낸다");
    this.busy = true;
    this.lines = [];
    let timer;
    try {
      const done = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          if (this.pending) this.pending = null;
          reject(new Error(`응답 타임아웃: ${cmd}`));
        }, timeoutMs);
        this.pending = () => {
          clearTimeout(timer);
          resolve();
        };
        this.pending.reject = reject;
      });
      await this.writer.write(this.encoder.encode(cmd + "\r"));
      await done;
      return this.lines.filter((line) => line !== cmd);
    } catch (err) {
      clearTimeout(timer);
      this.pending = null;
      throw err;
    } finally {
      this.busy = false;
    }
  }

  async close() {
    if (this.reader) {
      await this.reader.cancel();
      this.reader.releaseLock();
    }
    if (this.writer) {
      await this.writer.close();
    }
    await this.port.close();
  }
}
```

- `command()`는 **한 번에 하나만** 허용한다. 여러 명령을 동시에 보내면 응답이 섞인다. UI에서도 버튼을 잠그거나 큐를 쓴다.
- 타임아웃이 나면 `pending`을 비운다. 늦게 도착한 응답은 다음 명령에 섞일 수 있으므로, 타임아웃 뒤에는 포트를 닫고 다시 여는 편이 안전하다.
- `close()`는 리더를 취소하고, 라이터를 닫고, 포트를 닫는다. 순서를 바꾸면 잠금이 남을 수 있다.
- `readLoop()`는 `await`하지 않는다. 백그라운드에서 계속 돌면서 `pending`을 깨운다.

## 15.4 PID 요청과 값 표시

`41 <PID>` 줄에서 데이터 바이트를 꺼내 7장과 같은 공식으로 계산한다.

```javascript
export function parsePid(pid, data) {
  if (pid === 0x0c && data.length >= 2) return (data[0] * 256 + data[1]) / 4;
  if (pid === 0x0d && data.length >= 1) return data[0];
  if (pid === 0x05 && data.length >= 1) return data[0] - 40;
  return null;
}

export async function queryPid(session, pid) {
  const cmd = `01${pid.toString(16).padStart(2, "0").toUpperCase()}`;
  const lines = await session.command(cmd, 1500);
  for (const line of lines) {
    if (line.startsWith("SEARCHING") || line.startsWith("NO DATA")) continue;
    const compact = line.replace(/\s+/g, "");
    if (!compact.startsWith("41") || compact.length < 4) continue;
    if (parseInt(compact.slice(2, 4), 16) !== pid) continue;
    const hex = compact.slice(4);
    if (!hex || hex.length % 2 !== 0) continue;
    return Uint8Array.from(hex.match(/../g).map((b) => parseInt(b, 16)));
  }
  return null;
}
```

- `SEARCHING...`은 `ATSP0`가 프로토콜을 찾는 중이라는 뜻이다. 데이터가 아니다.
- `NO DATA`는 ECU가 응답하지 않았다는 뜻이다. 7장의 문제 해결 순서를 따른다.
- `41`로 시작하지 않는 줄(에코, `OK`, 다른 ECU의 응답)은 건너뛴다.
- 다중 프레임 응답은 ELM327이 `0:`, `1:`로 나눠 보여 준다. `queryPid()`는 단일 프레임 PID만 다룬다. VIN처럼 긴 응답은 `0:`/`1:` 줄을 모아 조립해야 한다(3장).

### 화면에 표시하기

15.2의 최소 페이지를 아래 마크업으로 바꾸고, 15.4의 `app.js`가 15.2의 예제를 대체한다고 하자. `v-*` 요소는 `render()`가 채운다.

```html
<!doctype html>
<html lang="ko">
<meta charset="utf-8">
<title>OBD-II Web Serial</title>
<button id="connect">연결</button>
<button id="disconnect">해제</button>
<p id="status">대기 중</p>
<div>
  <div><span>엔진 회전수</span> <span id="v-rpm">--</span> rpm</div>
  <div><span>차속</span> <span id="v-speed">--</span> km/h</div>
  <div><span>냉각수</span> <span id="v-coolant">--</span> °C</div>
</div>
<script type="module" src="./app.js"></script>
```

```javascript
import { Elm327Session, parsePid, queryPid } from "./elm327.js";

const specs = [
  { pid: 0x0c, key: "rpm", label: "엔진 회전수", unit: "rpm", max: 7000 },
  { pid: 0x0d, key: "speed", label: "차속", unit: "km/h", max: 200 },
  { pid: 0x05, key: "coolant", label: "냉각수", unit: "°C", max: 120 },
];

let session = null;
let timer = null;
let polling = false;

function render(value) {
  for (const spec of specs) {
    document.getElementById(`v-${spec.key}`).textContent =
      value[spec.key] === undefined ? "--" : value[spec.key].toFixed(1);
  }
}

async function tick() {
  if (!session || polling) return;
  polling = true;
  try {
    const values = {};
    for (const spec of specs) {
      const data = await queryPid(session, spec.pid);
      const parsed = data && parsePid(spec.pid, data);
      if (parsed !== null) values[spec.key] = parsed;
    }
    render(values);
    document.getElementById("status").textContent =
      `업데이트 ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    document.getElementById("status").textContent = `오류: ${err.message}`;
  } finally {
    polling = false;
  }
}

document.getElementById("connect").addEventListener("click", async () => {
  const port = await navigator.serial.requestPort();
  session = new Elm327Session(port);
  await session.open(38400);
  for (const [cmd, timeout] of [["ATZ", 3000], ["ATE0", 1000], ["ATL0", 1000], ["ATSP0", 10000]]) {
    await session.command(cmd, timeout);
  }
  timer = setInterval(tick, 1000);
  tick();
});

document.getElementById("disconnect").addEventListener("click", async () => {
  clearInterval(timer);
  timer = null;
  if (session) {
    await session.close();
    session = null;
  }
});
```

- 폴링 중복을 `polling` 플래그로 막는다. `setInterval`은 이전 `tick()`이 끝나지 않아도 다음 호출을 예약한다.
- PID 3개를 순차적으로 읽으므로 한 주기는 1초 안팎이다. 빠르게 읽으려면 7장의 다중 PID 요청을 쓴다.
- 탭이 백그라운드로 가면 브라우저가 타이머를 늦출 수 있다. 장시간 로깅에는 브라우저보다 파이썬이 낫다.
- 페이지를 닫으면 포트가 닫힌다. `beforeunload`에서 `session.close()`를 호출해도 되지만, 비동기 정리가 보장되지는 않는다.

## 15.5 7장 파이썬 대시보드와 비교

| 항목 | 7장 파이썬 대시보드 | 15장 브라우저 |
|---|---|---|
| 실행 | `uv run python` + Flask | 정적 페이지 + HTTPS |
| 포트 접근 | pyserial이 OS 포트를 직접 연다 | 사용자가 브라우저 창에서 포트를 고른다 |
| 권한 | OS 사용자 권한 | HTTPS·사용자 제스처·브라우저 권한 |
| 배포 | 로컬 서버, 의존성 설치 | URL 공유, 설치 없음(지원 브라우저) |
| 장시간 로깅 | 강함(파일·DB·재시작) | 약함(탭 유지, 백그라운드 제한) |
| 다중 사용자 | Flask API로 여러 클라이언트 | 포트는 보통 한 탭이 독점 |
| 자동화 | 스케줄·CLI·서버 통합 | 사용자 조작 중심 |
| 오류 복구 | 프로세스 재시작·로그 | 탭 새로고침·재연결 |
| 최적 용도 | 로거·게이트웨이·장시간 수집 | 현장 빠른 확인·데모·교육 |

- 브라우저는 **설치 없는 데모**에 강하다. 차량 앞에서 노트북을 열고 URL만 열면 된다.
- 파이썬은 **장시간·무인·다중 클라이언트**에 강하다. 17장의 로그 파이프라인은 파이썬 쪽이 자연스럽다.
- 둘을 함께 쓸 수도 있다. 파이썬이 로그를 수집하고, 브라우저는 그 로그를 읽어 시각화한다. 이때 브라우저는 시리얼 포트를 직접 열지 않는다.

## 15.6 Web Bluetooth로 BLE ELM327에 연결하기

ELM327 어댑터에는 USB·블루투스 클래식(SPP)·BLE·Wi-Fi 제품이 있다. **Web Bluetooth는 BLE GATT만 다룬다.**

- BLE 어댑터는 GATT 서비스와 특성(characteristic)으로 데이터를 주고받는다. 보통 쓰기 특성에 `AT`/PID 명령을 쓰고, notify 특성에서 응답을 받는다.
- 서비스·특성 UUID는 제품마다 다르다. `FFF0`/`FFF1`/`FFF2`를 쓰는 제품이 흔하지만 표준이 아니다. **하드코딩하지 말고 GATT를 탐색한다**(확인 필요).
- 블루투스 클래식 SPP 어댑터는 Web Bluetooth의 `requestDevice()` 목록에 나오지 않는다. SPP는 RFCOMM 위의 직렬 프로파일이고, Web Bluetooth는 BLE GATT만 노출한다.
- 다만 OS가 SPP 어댑터를 **직렬 포트(COMx)** 로 페어링하면, Web Serial이 그 포트를 열 수 있다. MDN의 `Serial.requestPort()`는 `bluetoothServiceClassId` 필터와 `allowedBluetoothServiceClassIds`로 RFCOMM 기반 직렬 포트를 고를 수 있게 한다. 즉 "클래식은 Web Bluetooth로 안 되지만, OS가 직렬 포트로 노출하면 Web Serial로 될 수 있다"가 정확하다.
- BLE 어댑터도 브라우저·OS·펌웨어에 따라 MTU와 쓰기 방식이 다르다. 긴 명령을 한 번에 쓰지 말고, 어댑터 문서의 MTU를 확인한다(확인 필요).

### GATT를 탐색하는 예

```javascript
async function connectBle() {
  if (!navigator.bluetooth) {
    throw new Error("이 브라우저는 Web Bluetooth를 지원하지 않습니다.");
  }
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [
      "0000fff0-0000-1000-8000-00805f9b34fb",
      "0000180a-0000-1000-8000-00805f9b34fb",
    ],
  });
  const server = await device.gatt.connect();
  const services = await server.getPrimaryServices();
  for (const service of services) {
    const chars = await service.getCharacteristics();
    for (const ch of chars) {
      console.log(service.uuid, ch.uuid, ch.properties);
    }
  }
  return device;
}
```

- `acceptAllDevices: true`는 모든 BLE 기기를 보여 준다. `optionalServices`에 접근할 서비스를 넣지 않으면 `getPrimaryServices()`에서 보이지 않을 수 있다.
- 콘솔에서 `properties`를 보고 `write`/`writeWithoutResponse` 특성과 `notify` 특성을 고른다.
- `startNotifications()`를 호출해야 `characteristicvaluechanged` 이벤트가 온다. BLE의 CCCD(Client Characteristic Configuration Descriptor)를 켜는 것과 같다.
- 응답은 `TextDecoder`로 디코딩하고, 15.3절의 줄 파서에 넣는다. BLE 패킷은 더 잘게 쪼개질 수 있으므로 버퍼링이 필수다.

```javascript
async function attachBle(chars, parser, onLines) {
  const writeChar = chars.find(
    (ch) => ch.properties.write || ch.properties.writeWithoutResponse,
  );
  const notifyChar = chars.find((ch) => ch.properties.notify);
  if (!writeChar || !notifyChar) {
    throw new Error("쓰기/알림 특성을 찾지 못했습니다. GATT를 확인하세요.");
  }

  await notifyChar.startNotifications();
  notifyChar.addEventListener("characteristicvaluechanged", (event) => {
    const text = new TextDecoder().decode(event.target.value);
    const { lines, prompt } = parser.feed(text);
    onLines(lines, prompt);
  });

  const payload = new TextEncoder().encode("ATZ\r");
  if (writeChar.properties.write) {
    await writeChar.writeValue(payload);
  } else {
    await writeChar.writeValueWithoutResponse(payload);
  }
}
```

- `writeValue()`는 응답 확인(with response)을 요구한다. 어댑터가 `writeWithoutResponse`만 지원하면 `writeValueWithoutResponse()`를 쓴다.
- BLE는 연결 인터벌·MTU·알림 지연 때문에 USB보다 응답이 느리고 불규칙하다. 타임아웃을 넉넉히 둔다.
- Web Bluetooth도 **보안 컨텍스트**와 **사용자 제스처**가 필요하다. `requestDevice()`는 클릭 핸들러 안에서 호출한다.

## 15.7 흔한 실수

| 증상 | 원인 후보 | 확인 |
|---|---|---|
| `navigator.serial`이 없음 | 지원하지 않는 브라우저, 비보안 컨텍스트 | Chrome/Edge/Firefox 151+, HTTPS/localhost |
| 포트 선택 창이 안 뜸 | 사용자 제스처 밖에서 호출 | 클릭 핸들러 안에서 `requestPort()` |
| 포트가 목록에 없음 | OS 드라이버 없음, 다른 앱이 점유 | 장치 관리자, 시리얼 앱 종료 |
| `Failed to open serial port` | 이미 열린 포트, 보율·권한 | 다른 탭/앱 닫기, 보율 확인 |
| 응답이 잘리거나 섞임 | 청크 경계, 프롬프트 전 반환, 동시 명령 | 리더 하나, `>`까지 읽기, 명령 큐 |
| `InvalidStateError`/lock | 리더를 여러 번 만들거나 reader/writer 잠금 충돌 | `getReader()`는 한 번, `releaseLock()` |
| `NO DATA` | PID 미지원, 시동 OFF, 프로토콜 불일치 | 7장 문제 해결 순서 |
| `ATZ`가 깨짐 | 보율 불일치 | 38400/9600 교차 시험 |
| BLE 기기가 안 보임 | 클래식 SPP 어댑터, BLE 아님 | 제품 스펙, GATT 탐색 |
| BLE 응답이 끊김 | notify 미설정, MTU, 쓰기 방식 | `startNotifications()`, `writeWithoutResponse` |
| 탭이 백그라운드에서 느려짐 | 브라우저 타이머 스로틀 | 장시간 로깅은 파이썬으로 |

## 15.8 체크리스트

- [ ] HTTPS 또는 `localhost`에서 실행했는가
- [ ] `requestPort()`를 사용자 클릭 안에서 호출했는가
- [ ] 지원 브라우저인지 확인하고, 아니면 안내를 보여 주는가
- [ ] 보율(38400/9600)을 어댑터 문서로 확인했는가
- [ ] 리더를 하나만 만들고 `>` 프롬프트까지 읽는가
- [ ] 청크 경계를 버퍼로 처리하는가
- [ ] 명령을 한 번에 하나만 보내는가
- [ ] `SEARCHING...`·`NO DATA`·에코를 데이터로 오해하지 않는가
- [ ] BLE는 GATT 특성을 탐색하고, 클래식 SPP와 구분했는가
- [ ] 실제 차량에서는 정차·읽기 전용인가

## 장 요약

- Web Serial은 사용자가 고른 직렬 포트를 페이지에 열어 주는 API다. HTTPS/localhost, 사용자 제스처, 브라우저 권한이 필요하다.
- 2026-10 기준 Chrome/Edge 데스크톱 89+, Firefox 151+가 지원하고 Safari는 지원하지 않는다. 지원 여부는 바뀔 수 있으니 런타임에 확인한다.
- 시리얼은 청크 스트림이다. `\r` 줄 경계와 `>` 프롬프트를 버퍼로 처리해야 한다.
- 리더는 하나만 만들고, 명령은 한 번에 하나씩 보낸다. 타임아웃 뒤에는 포트를 다시 여는 편이 안전하다.
- ELM327 응답은 `41 <PID>`를 확인하고, `SEARCHING...`·`NO DATA`·에코를 걸러 낸다.
- 브라우저는 설치 없는 현장 확인·데모에, 파이썬은 장시간 로깅·자동화에 강하다.
- Web Bluetooth는 BLE GATT만 다룬다. 클래식 SPP 어댑터는 Web Bluetooth로 직접 안 되지만, OS가 직렬 포트로 노출하면 Web Serial로 열 수 있다.
- BLE는 서비스·특성 UUID가 제품마다 다르다. 하드코딩하지 말고 GATT를 탐색한다.

## 연습 문제

### 1. 보안 컨텍스트

Web Serial 예제를 `http://192.168.0.10:8000`에서 열었더니 `navigator.serial`이 없다.

1. 왜 그런가?
2. 두 가지 해결 방법을 쓰라.
3. `file://`로 HTML을 직접 열면 되는가?

### 2. 청크 경계

ELM327이 다음 청크를 보냈다.

```text
"41 0C 1A"
" F8 \r\r>"
```

15.3절의 `ElmLineParser`에 두 청크를 차례로 넣었을 때 각 호출의 `lines`와 `prompt`를 쓰라.

### 3. 프롬프트

`read()`가 돌려준 데이터에 `>`가 아직 없는데 줄바꿈만 보고 반환하면 어떤 문제가 생기는가? 두 가지를 쓰라.

### 4. 어댑터 선택

다음 어댑터를 브라우저에서 쓰려 한다. 어떤 API로 연결할 수 있는가?

1. USB ELM327(CH340)
2. BLE ELM327
3. 블루투스 클래식 SPP ELM327(Windows에서 COM5로 페어링됨)

### 5. 명령 중복

`setInterval(tick, 500)`으로 PID 3개를 읽는데, 한 주기가 1초 걸린다. 어떤 문제가 생기고 어떻게 고치나?

## 정답과 해설

### 1.

1. `http://192.168.0.10`은 보안 컨텍스트가 아니다. Web Serial은 HTTPS 또는 `localhost`에서만 동작한다.
2. HTTPS로 제공하거나, 개발용이면 `http://localhost:8000`으로 연다. 인증서가 없는 HTTPS는 브라우저 경고를 처리해야 한다.
3. `file://`은 보안 컨텍스트로 취급되는 경우가 있지만 브라우저·플랫폼마다 다르고, 모듈·권한 정책도 불안정하다. 로컬 개발 서버(`localhost`)를 쓰는 편이 재현 가능하다.

### 2.

첫 호출은 `lines: []`, `prompt: false`다. 버퍼에 `"41 0C 1A"`가 남는다. 두 번째 호출은 `lines: ["41 0C 1A F8"]`, `prompt: true`다. `\r\r>`가 줄바꿈과 프롬프트를 만든다.

### 3.

1. 응답의 나머지 바이트를 다음 명령의 응답으로 읽어, 줄이 섞이거나 값이 밀린다.
2. 프롬프트를 소비하지 않아 다음 `command()`가 즉시 끝나거나, 반대로 이전 응답을 기다리며 타임아웃이 난다. 명령 큐가 어긋난다.

### 4.

1. Web Serial. `navigator.serial.requestPort()`로 CH340 포트를 고른다. OS에 CH340 드라이버가 있어야 한다.
2. Web Bluetooth. `requestDevice()`로 BLE 기기를 고르고 GATT 서비스를 탐색한다. UUID는 제품마다 다르다.
3. Web Serial. OS가 SPP를 COM5로 노출했으므로 `requestPort()` 목록에 나올 수 있다. Web Bluetooth로는 SPP를 직접 다룰 수 없다. 브라우저가 Bluetooth RFCOMM 직렬 포트를 지원하는지도 확인한다.

### 5.

`tick()`이 끝나기 전에 다음 `tick()`이 시작되어 명령이 겹친다. `Elm327Session.command()`가 `busy`로 막으면 예외가 나고, 막지 않으면 응답이 섞인다. `polling` 플래그로 중복 실행을 막거나, `setTimeout`으로 이전 주기가 끝난 뒤 다음을 예약한다. 명령 큐를 두는 방법도 있다.
