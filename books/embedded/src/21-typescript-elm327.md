# 21장 TypeScript로 CAN과 ELM327 다루기

## 이 장에서

7장에서는 파이썬으로 ELM327을 열고 PID를 읽었다. 이 책의 독자는 대부분 TypeScript와 Node.js가 주력이다. 같은 일을 **익숙한 언어와 도구**로 다시 해 보면, 프로토콜 이해가 언어 지식에 가려지지 않고 드러난다. 파이썬의 스레드·`pyserial` 대신 Node의 이벤트 루프·`serialport`를 쓰고, `dataclass` 대신 `interface`와 판별 유니온으로 응답을 모델링한다.

이 장에서 만드는 것은 라이브러리가 아니라 **계층이 분명한 작은 클라이언트**다.

```text
[SerialTransport / TcpTransport]  ← 바이트 통로
            │ data 이벤트
            ▼
[Elm327Client]                    ← 명령 큐, CR/프롬프트 파싱, 응답 분류
            │ ElmResponse
            ▼
[obd.ts]                          ← PID 표, 바이트 길이, 공식, 다중 PID 파싱
            │ PidValues
            ▼
[cli.ts]                          ← 한 번 읽고 출력
```

이 장에서 다루는 것:

- Node 24에서 TypeScript를 직접 실행하고 타입 검사하는 방법
- `serialport`로 시리얼 포트를 열고, TCP로 ELM327-emulator에 붙는 방법
- ELM327의 CR·에코·`>` 프롬프트를 처리하는 클라이언트
- `NO DATA`, `SEARCHING...`, `7F xx 78`을 구분하는 응답 분류
- 여러 PID를 한 요청에 묶고, 응답 순서와 무관하게 파싱하기
- 7장 파이썬 코드와의 줄 단위 비교
- ELM327의 응답 시간·처리량과 `ATST`·`ATAT` 설정
- Linux SocketCAN을 Node에서 쓰는 `socketcan` 패키지

**안전 원칙은 7장과 같다.** 실제 차량에서는 정차 상태에서 읽기만 한다. 이 장의 코드는 `AT` 명령과 Mode 01 PID 읽기만 보낸다. 프레임 송신은 17장의 vcan이나 가상 ECU에서만 한다.

## 21.1 왜 TypeScript인가

파이썬과 TypeScript는 같은 프로토콜을 다루지만, 코드의 모양이 다르다.

| 7장 파이썬 | 이 장 TypeScript | 차이 |
|---|---|---|
| `pyserial`의 `Serial` | `serialport`의 `SerialPort` | 둘 다 OS 시리얼 포트를 연다 |
| `serial.Serial(...).read(1)` | `port.on("data", ...)` | 파이썬은 읽기 루프, Node는 이벤트 |
| `threading.Thread` | `async`/`await` + 이벤트 루프 | Node는 단일 스레드다 |
| `@dataclass` | `interface`, `type` | 타입은 런타임에 지워진다 |
| `python-can` SocketCAN | `socketcan` npm 패키지 | Linux 전용이라는 점은 같다 |
| `uv add` | `npm install` | 잠금 파일·스크립트가 다르다 |
| Flask | `node:http`(22장) | 둘 다 HTTP 서버를 만든다 |

TypeScript의 장점은 **경계에서 타입을 강제할 수 있다**는 것이다. 시리얼에서 오는 것은 `Buffer`이고, 그 안의 의미는 우리가 해석한다. `string`이라고 단정하지 않고 `Buffer` → 줄 → `ElmResponse` → `PidValues`로 한 단계씩 좁히면, "응답이 이상하다"는 문제를 어느 계층에서 찾을지가 분명해진다.

주의할 점도 있다. TypeScript의 타입은 컴파일할 때 지워진다. `as PidValues`라고 써도 런타임 검증은 없다. **외부에서 온 데이터는 `unknown`으로 두고 검사한 뒤 좁힌다.** 이 장의 `ElmResponse`는 판별 유니온으로, `kind`를 확인한 뒤에만 `lines`에 접근하게 한다.

### Node 24에서 TypeScript 실행하기

Node 24.12부터 TypeScript의 **타입 제거(type stripping)** 가 안정 상태다. `node src/cli.ts`처럼 `.ts` 파일을 바로 실행할 수 있다. 타입 검사는 하지 않으므로 `tsc --noEmit`을 따로 돌린다.

- Node는 `tsconfig.json`을 읽지 않는다. `paths` 별칭, 구버전 JavaScript로의 변환은 지원하지 않는다.
- `enum`, `namespace`, 생성자 매개변수 프로퍼티처럼 **런타임 코드를 만들어 내는 문법**은 기본 모드에서 실행되지 않는다.
- 그래서 `tsconfig.json`에 `erasableSyntaxOnly`를 켜 두면 "Node가 실행할 수 없는 문법"을 컴파일 단계에서 걸러 준다.
- Node 22는 22.18.0부터 타입 제거가 기본으로 켜져 있어 `.ts`를 바로 실행할 수 있다(실험 기능 경고가 뜬다). 그보다 낮은 22나 Node 20이라면 `tsx` 같은 로더를 쓰거나 `tsc`로 JavaScript를 만들어 실행한다. `serialport` 13은 Node 20 이상을 요구한다.

## 21.2 프로젝트 준비

```bash
mkdir obd-ts
cd obd-ts
npm init -y
npm pkg set type=module
npm install serialport
npm install --save-dev typescript @types/node
```

`package.json`에 스크립트를 추가한다.

```json
{
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "start": "node src/cli.ts --mode emulator",
    "start:serial": "node src/cli.ts --mode serial --port COM5"
  }
}
```

`tsconfig.json`은 다음과 같다.

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- `allowImportingTsExtensions`는 `import "./transport.ts"`처럼 확장자를 붙여 쓰기 위한 설정이다. Node의 타입 제거 모드에서는 확장자가 필수다.
- `verbatimModuleSyntax`는 타입만 가져오는 `import type`을 명시하게 한다. 런타임 import와 타입 import를 섞지 않는다.
- `strict`를 끄면 `Buffer`와 `undefined`가 뒤섞여 디버깅이 어려워진다. 시리얼 코드일수록 켜 두는 편이 낫다.

디렉터리는 다음과 같이 나눈다.

```text
obd-ts/
  package.json
  tsconfig.json
  src/
    transport.ts
    elm327.ts
    obd.ts
    cli.ts
```

## 21.3 전송 계층: 시리얼과 TCP를 같은 인터페이스로

ELM327과 대화하는 방법은 하나가 아니다. 실제 차량에서는 USB 시리얼, 차 없이 연습할 때는 ELM327-emulator의 TCP 서버를 쓴다. 둘을 갈아 끼울 수 있게 **바이트 통로**를 인터페이스로 분리한다.

`src/transport.ts`:

```typescript
import net from "node:net";
import { SerialPort } from "serialport";

export type DataHandler = (chunk: Buffer) => void;
export type CloseHandler = (error?: Error) => void;

/** ELM327과 대화하는 바이트 통로. 시리얼, TCP, 테스트 구현을 바꿔 끼운다. */
export interface Transport {
  readonly kind: "serial" | "tcp" | "test";
  write(text: string): Promise<void>;
  close(): Promise<void>;
  onData(handler: DataHandler): void;
  onClose(handler: CloseHandler): void;
}

/** Linux/macOS/Windows의 실제 시리얼 포트. serialport 패키지를 쓴다. */
export class SerialTransport implements Transport {
  readonly kind = "serial" as const;
  private readonly port: SerialPort;

  private constructor(port: SerialPort) {
    this.port = port;
  }

  static open(
    path: string,
    baudRate: number,
    createPort: (options: { path: string; baudRate: number; autoOpen: boolean }) => SerialPort =
      (options) => new SerialPort(options),
  ): Promise<SerialTransport> {
    const port = createPort({ path, baudRate, autoOpen: false });
    return new Promise((resolve, reject) => {
      port.open((error) => {
        if (error) reject(error);
        else resolve(new SerialTransport(port));
      });
    });
  }

  write(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.port.write(text, (error) => {
        if (error) {
          reject(error);
          return;
        }
        this.port.drain((drainError) => (drainError ? reject(drainError) : resolve()));
      });
    });
  }

  onData(handler: DataHandler): void {
    this.port.on("data", handler);
  }

  onClose(handler: CloseHandler): void {
    this.port.on("close", (error?: Error) => handler(error));
    this.port.on("error", handler);
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.port.isOpen) {
        resolve();
        return;
      }
      this.port.close(() => resolve());
    });
  }
}

/** ELM327-emulator의 TCP 서버(-n)에 붙는 통로. Windows에서도 드라이버가 필요 없다. */
export class TcpTransport implements Transport {
  readonly kind = "tcp" as const;
  private readonly socket: net.Socket;

  private constructor(socket: net.Socket) {
    this.socket = socket;
  }

  static open(host: string, port: number): Promise<TcpTransport> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      socket.setNoDelay(true);
      socket.once("connect", () => resolve(new TcpTransport(socket)));
      socket.once("error", reject);
    });
  }

  write(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.write(text, (error) => (error ? reject(error) : resolve()));
    });
  }

  onData(handler: DataHandler): void {
    this.socket.on("data", handler);
  }

  onClose(handler: CloseHandler): void {
    this.socket.on("close", () => handler());
    this.socket.on("error", handler);
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket.destroyed) {
        resolve();
        return;
      }
      this.socket.once("close", () => resolve());
      this.socket.destroy();
    });
  }
}
```

- `autoOpen: false`로 만들고 직접 `open()`한다. 생성자가 자동으로 열면 열기 실패가 `error` 이벤트로 흩어져 잡기 어렵다.
- `write()` 콜백은 "OS 버퍼에 썼다"는 뜻이고, `drain()`은 "전송이 끝났다"는 뜻이다. ELM327은 명령 사이 간격에 민감하지 않지만, `drain()`까지 기다리면 다음 명령을 보내는 시점이 명확해진다.
- `data` 이벤트의 `Buffer`는 **원하는 크기로 오지 않는다.** 한 줄이 여러 청크로 쪼개지거나 여러 줄이 한 청크에 붙어 온다. 이벤트 핸들러에서 바로 파싱하지 않고 버퍼에 쌓아야 한다.
- `TcpTransport`는 ELM327-emulator를 위한 것이다. 실제 차량에 TCP로 붙는 것이 아니다. Windows에서 ELM327-emulator의 TCP 모드(`-n`)는 com0com 같은 가상 시리얼 드라이버가 필요 없다.
- 세 번째 `createPort` 인자는 테스트용이다. `SerialPortMock`을 넣어 실제 포트 없이 같은 코드 경로를 시험할 수 있다.

## 21.4 ELM327 클라이언트: CR, 에코, 프롬프트

ELM327의 대화 규칙은 단순하다.

```text
PC → ELM327:  "010C\r"
ELM327 → PC:  "010C\r"        ← ATE1이면 에코
              "41 0C 1A F8\r"
              "\r"
              ">"              ← 프롬프트: 이번 응답 끝
```

- 명령은 `\r`로 끝난다. `\n`이 아니다.
- 응답 줄도 `\r`로 끝난다. 마지막에 빈 줄이 하나 더 올 수 있다.
- 프롬프트 `>`가 오면 다음 명령을 받을 준비가 된 것이다.
- `ATE0`으로 에코를 끄면 첫 줄이 사라진다. 하지만 클론은 `ATE0`을 무시하거나 에코를 늦게 끄는 경우가 있어, 파서는 에코가 있어도 동작해야 한다.

`src/elm327.ts`:

```typescript
import type { Transport } from "./transport.ts";

export type ElmErrorCode = "timeout" | "adapter" | "closed" | "write";

export class Elm327Error extends Error {
  readonly code: ElmErrorCode;

  constructor(message: string, code: ElmErrorCode) {
    super(message);
    this.name = "Elm327Error";
    this.code = code;
  }
}

export type ElmResponse =
  | { kind: "ok"; lines: string[] }
  | { kind: "no-data"; lines: string[] }
  | { kind: "error"; code: string; lines: string[] };

interface Pending {
  command: string;
  lines: string[];
  resolve: (response: ElmResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const ADAPTER_ERRORS = [
  "?",
  "UNABLE TO CONNECT",
  "BUS INIT",
  "CAN ERROR",
  "BUFFER FULL",
  "STOPPED",
  "ERROR",
];

/**
 * ELM327 한 대와의 대화를 직렬화한다.
 * ELM327은 반이중이라 요청을 겹쳐 보내면 응답이 섞인다. 그래서 큐를 둔다.
 */
export class Elm327Client {
  private readonly transport: Transport;
  private readonly defaultTimeoutMs: number;
  private buffer = "";
  private pending: Pending | null = null;
  private tail: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(transport: Transport, options: { defaultTimeoutMs?: number } = {}) {
    this.transport = transport;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 3000;
    transport.onData((chunk) => this.onData(chunk));
    transport.onClose((error) => {
      this.closed = true;
      this.fail(new Elm327Error(error?.message ?? "전송 계층이 닫혔습니다", "closed"));
    });
  }

  command(command: string, timeoutMs = this.defaultTimeoutMs): Promise<ElmResponse> {
    const run = this.tail.then(() => this.execute(command, timeoutMs));
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.fail(new Elm327Error("클라이언트를 닫았습니다", "closed"));
    await this.transport.close();
  }

  private execute(command: string, timeoutMs: number): Promise<ElmResponse> {
    if (this.closed) {
      return Promise.reject(new Elm327Error("클라이언트가 닫혔습니다", "closed"));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        this.closed = true;
        reject(new Elm327Error(`${command} 응답 시간 초과 (${timeoutMs}ms)`, "timeout"));
        // 늦게 도착한 응답을 다음 명령의 응답으로 오해하지 않도록 연결을 끊는다.
        void this.transport.close();
      }, timeoutMs);
      this.pending = { command, lines: [], resolve, reject, timer };
      this.transport.write(`${command}\r`).catch((error: Error) => {
        this.fail(new Elm327Error(`쓰기 실패: ${error.message}`, "write"));
      });
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString("latin1");
    let index = this.buffer.indexOf("\r");
    while (index >= 0) {
      this.consumeLine(this.buffer.slice(0, index));
      this.buffer = this.buffer.slice(index + 1);
      index = this.buffer.indexOf("\r");
    }
    // 프롬프트는 보통 CR 뒤에 홀로 오지만, 마지막 줄에 붙어 오는 클론도 있다.
    const prompt = this.buffer.indexOf(">");
    if (prompt >= 0) {
      const before = this.buffer.slice(0, prompt);
      this.buffer = this.buffer.slice(prompt + 1);
      if (before.trim()) this.consumeLine(before);
      this.finishResponse();
    }
  }

  private consumeLine(raw: string): void {
    const line = raw.replaceAll("\0", "").trimEnd();
    if (!line.trim()) return;
    if (line.trim() === ">") {
      this.finishResponse();
      return;
    }
    if (!this.pending) return;
    if (line.trim() === this.pending.command) return; // ATE1일 때의 에코
    if (/^7F ?[0-9A-Fa-f]{2} ?78$/.test(line.trim())) {
      this.rearmTimeout(6000);
    }
    this.pending.lines.push(line.trim());
  }

  private rearmTimeout(ms: number): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      this.pending = null;
      this.closed = true;
      pending.reject(new Elm327Error(`${pending.command} 응답 시간 초과 (${ms}ms)`, "timeout"));
      void this.transport.close();
    }, ms);
  }

  private finishResponse(): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = null;
    pending.resolve(classify(pending.lines));
  }

  private fail(error: Elm327Error): void {
    if (this.pending) {
      const pending = this.pending;
      clearTimeout(pending.timer);
      this.pending = null;
      pending.reject(error);
    }
  }
}

function classify(lines: string[]): ElmResponse {
  const clean = lines.map((line) => line.trim()).filter(Boolean);
  if (clean.length === 0) return { kind: "ok", lines: [] };
  if (clean.some((line) => line.startsWith("NO DATA"))) {
    return { kind: "no-data", lines: clean };
  }
  const error = clean.find((line) => ADAPTER_ERRORS.some((code) => line.startsWith(code)));
  if (error) return { kind: "error", code: error, lines: clean };
  return { kind: "ok", lines: clean };
}

export function firstLine(response: ElmResponse): string {
  return response.lines.find((line) => !line.startsWith("SEARCHING")) ?? "";
}

/** AT 명령으로 어댑터를 초기화하고 프로토콜·배터리 전압을 읽는다. */
export async function initializeElm(client: Elm327Client): Promise<{ protocol: string; battery: string }> {
  const expectOk = async (command: string, timeoutMs: number): Promise<ElmResponse> => {
    const response = await client.command(command, timeoutMs);
    if (response.kind === "error") {
      throw new Elm327Error(`${command}: ${response.code}`, "adapter");
    }
    return response;
  };

  await expectOk("ATZ", 5000);
  await expectOk("ATE0", 1000);
  await expectOk("ATL0", 1000);
  await expectOk("ATSP0", 15000);
  const protocol = firstLine(await expectOk("ATDPN", 3000));
  const battery = firstLine(await expectOk("ATRV", 3000));
  return { protocol, battery };
}
```

### 명령을 겹쳐 보내지 않는 이유

ELM327은 요청과 응답이 한 줄로 오가는 반이중 장치다. `ATSP0`가 프로토콜을 찾는 동안 `010C`를 보내면, 나중에 도착한 `41 00 ...`이 `010C`의 응답으로 오해된다. 실제로 ELM327-emulator에서도 첫 `0100`이 `SEARCHING...`으로 늦게 끝나는 동안 다음 명령을 보내면 응답이 섞인다.

`command()`는 `tail` 체인으로 명령을 직렬화한다. 호출자는 `await`로 기다리면 되고, 내부에서는 **앞 명령의 프롬프트가 온 뒤에만** 다음 명령을 쓴다. 큐가 무한정 길어지지 않게, 수집기는 한 번에 한 요청만 보낸다(22장).

### 응답 분류

| 응답 | 의미 | 처리 |
|---|---|---|
| `OK` | AT 명령 성공 | `ok` |
| `ELM327 v1.5` | `ATI`/`ATZ`의 버전 문자열 | `ok` |
| `NO DATA` | 요청에 대한 응답 없음(미지원 PID, 시동 상태, 필터) | `no-data` |
| `SEARCHING...` | 프로토콜 검색 중. 뒤에 실제 응답이 온다 | `ok`로 두고 파서가 건너뜀 |
| `UNABLE TO CONNECT` | 차량과 연결 실패 | `error` |
| `BUS INIT: ...ERROR` | 초기화 실패 | `error` |
| `CAN ERROR` | CAN 오류 | `error` |
| `BUFFER FULL` | 어댑터 버퍼 넘침 | `error` |
| `STOPPED` | `ATZ` 등이 중단됨 | `error` |
| `?` | 명령 오타·미지원 명령 | `error` |
| `7F xx 78` | ECU가 "잠시 기다려 달라"는 응답(Response Pending) | 오류 아님. 최종 응답을 기다림 |

`7F xx 78`은 UDS/OBD의 부정 응답처럼 보이지만, "응답 대기"다. ELM327 v2.1 이상은 이 줄을 받으면, PP 2A bit 2가 설정된 경우(기본값) 타임아웃을 5초까지 늘린다(데이터시트 p.45). 이 책의 클라이언트는 `7F xx 78`을 보면 호스트 타이머를 6초로 다시 무장한다. 그렇지 않고 호스트 타임아웃을 1.5초로 고정해 두면, 응답 대기 중인 ECU에서 시간 초과가 날 수 있다. 그래서 이 책의 수집기는 첫 요청에 12초(프로토콜 검색), 이후 1.5초를 주되 `7F xx 78`에서 6초로 늘린다.

### 타임아웃이 나면 연결을 끊는 이유

호스트 타임아웃이 나면 응답이 늦게 도착할 수 있다. 그 상태로 다음 명령을 보내면 **늦은 응답이 다음 명령의 응답으로 섞인다.** ELM327에는 "이 명령의 응답만 달라"는 요청 ID가 없으므로, 호스트가 스스로 구분할 방법이 없다. 가장 안전한 복구는 연결을 닫고 다시 여는 것이다. 이 책의 `execute()`는 타임아웃 시 `transport.close()`를 호출하고, 22장의 세션 루프가 백오프 후 재연결한다.

`ReadlineParser`를 쓰지 않는 이유도 같다. `ReadlineParser`는 `\n` 기준으로 줄을 나누지만, ELM327은 `\r`을 쓰고 프롬프트 `>`는 줄바꿈 없이 올 수도 있다. `DelimiterParser`에 `\r`을 넣어도 `>`를 별도로 처리해야 한다. 이 장은 버퍼와 프롬프트를 직접 다룬다.

## 21.5 PID 파싱: 표와 판별 유니온

PID 응답은 `41 <PID> <데이터...>`다. PID마다 데이터 길이와 공식이 다르므로, **PID 번호로 길이와 디코더를 찾는 표**가 필요하다.

`src/obd.ts`:

```typescript
export interface PidSpec {
  pid: number;
  label: string;
  unit: string;
  min: number;
  max: number;
  digits: number;
  bytes: number;
  decode(data: Uint8Array): number;
}

export const PIDS = {
  rpm: {
    pid: 0x0c,
    label: "엔진 회전수",
    unit: "rpm",
    min: 0,
    max: 7000,
    digits: 0,
    bytes: 2,
    decode: (data) => (data[0] * 256 + data[1]) / 4,
  },
  speed: {
    pid: 0x0d,
    label: "차속",
    unit: "km/h",
    min: 0,
    max: 200,
    digits: 0,
    bytes: 1,
    decode: (data) => data[0],
  },
  coolant: {
    pid: 0x05,
    label: "냉각수 온도",
    unit: "°C",
    min: -40,
    max: 120,
    digits: 0,
    bytes: 1,
    decode: (data) => data[0] - 40,
  },
  load: {
    pid: 0x04,
    label: "계산된 엔진 부하",
    unit: "%",
    min: 0,
    max: 100,
    digits: 1,
    bytes: 1,
    decode: (data) => (data[0] * 100) / 255,
  },
  map: {
    pid: 0x0b,
    label: "흡기 매니폴드 절대압",
    unit: "kPa",
    min: 0,
    max: 255,
    digits: 0,
    bytes: 1,
    decode: (data) => data[0],
  },
  throttle: {
    pid: 0x11,
    label: "스로틀",
    unit: "%",
    min: 0,
    max: 100,
    digits: 1,
    bytes: 1,
    decode: (data) => (data[0] * 100) / 255,
  },
  fuel: {
    pid: 0x2f,
    label: "연료량",
    unit: "%",
    min: 0,
    max: 100,
    digits: 1,
    bytes: 1,
    decode: (data) => (data[0] * 100) / 255,
  },
  voltage: {
    pid: 0x42,
    label: "모듈 전압",
    unit: "V",
    min: 10,
    max: 16,
    digits: 2,
    bytes: 2,
    decode: (data) => (data[0] * 256 + data[1]) / 1000,
  },
} as const satisfies Record<string, PidSpec>;

export type PidKey = keyof typeof PIDS;
export type PidValues = Partial<Record<PidKey, number>>;

const BY_NUMBER = new Map<number, { key: PidKey; spec: PidSpec }>(
  Object.entries(PIDS).map(([key, spec]) => [spec.pid, { key: key as PidKey, spec }]),
);

/** 1~6개 PID를 한 요청으로 묶는다. 마지막 hex digit은 기다릴 응답 줄 수다. */
export function pidRequest(keys: readonly PidKey[], responses?: number): string {
  if (keys.length < 1 || keys.length > 6) {
    throw new Error("한 요청에 PID는 1~6개까지 넣을 수 있습니다");
  }
  const body = keys.map((key) => PIDS[key].pid.toString(16).padStart(2, "0")).join("");
  const suffix =
    responses === undefined
      ? ""
      : Math.max(0, Math.min(15, responses)).toString(16).toUpperCase();
  return `01${body}${suffix}`.toUpperCase();
}

/** ELM327의 0:, 1: 조립 줄과 길이 헤더(00F)를 걷어 내고 hex 바이트로 만든다. */
export function responseBytes(lines: readonly string[]): Uint8Array {
  const chunks: string[] = [];
  for (const line of lines) {
    const text = line.includes(":") ? line.slice(line.indexOf(":") + 1) : line;
    const trimmed = text.trim();
    if (!trimmed || trimmed === "OK" || trimmed === "SEARCHING..." || trimmed.startsWith("NO DATA")) {
      continue;
    }
    if (/^[0-9A-Fa-f]{3}$/.test(trimmed)) continue; // ISO-TP 길이 헤더
    if (!/^[0-9A-Fa-f ]+$/.test(trimmed)) continue;
    chunks.push(trimmed.replaceAll(" ", ""));
  }
  const hex = chunks.join("");
  const pairs = hex.match(/../g) ?? [];
  return Uint8Array.from(pairs.map((pair) => Number.parseInt(pair, 16)));
}

/**
 * Mode 01 응답을 PID 번호로 찾아 디코딩한다.
 * 응답 순서는 요청 순서와 달라도 되고, 지원하지 않는 PID는 건너뛴다.
 */
export function parseMode01(lines: readonly string[], requested: readonly PidKey[]): PidValues {
  const bytes = responseBytes(lines);
  const header = lines.map((line) => line.trim()).find((line) => /^[0-9A-Fa-f]{3}$/.test(line));
  const limit = header ? Math.min(bytes.length, Number.parseInt(header, 16)) : bytes.length;
  const wanted = new Set<PidKey>(requested);
  const values: PidValues = {};
  let index = 0;
  while (index < limit) {
    if (bytes[index] !== 0x41) {
      index += 1;
      continue;
    }
    index += 1;
    while (index < limit) {
      const found = BY_NUMBER.get(bytes[index]);
      if (!found) break;
      const end = index + 1 + found.spec.bytes;
      if (end > limit) break;
      if (wanted.has(found.key)) {
        const raw = found.spec.decode(bytes.subarray(index + 1, end));
        values[found.key] = Number(raw.toFixed(found.spec.digits));
      }
      index = end;
    }
  }
  return values;
}

/** PID 00/20/40의 4바이트 마스크를 PID 번호 목록으로 푼다. */
export function parseSupportedPids(mask: Uint8Array, base = 0): number[] {
  if (mask.length < 4) throw new Error("PID 지원 마스크는 4바이트입니다");
  const value = ((mask[0] << 24) | (mask[1] << 16) | (mask[2] << 8) | mask[3]) >>> 0;
  const pids: number[] = [];
  for (let bit = 0; bit < 32; bit += 1) {
    if ((value & (1 << (31 - bit))) !== 0) pids.push(base + bit + 1);
  }
  return pids;
}

export function decodeDtc(a: number, b: number): string {
  const category = ["P", "C", "B", "U"][(a >> 6) & 0x03];
  return `${category}${(((a & 0x3f) << 8) | b).toString(16).toUpperCase().padStart(4, "0")}`;
}
```

### 다중 PID 응답을 읽는 순서

ELM327이 여러 PID를 한 줄로 조립해 주면 다음과 같은 응답이 온다.

```text
00F
0: 41 0C 14 60 0D 0A
1: 05 5F 11 2B 2F AA
2: 42 39 4B
```

1. `00F`는 ISO-TP 메시지 길이(15바이트)다. PID 데이터가 아니다. `parseMode01`은 이 값을 `limit`로 써서 15바이트까지만 읽는다.
2. `0:`, `1:`, `2:`는 ELM327이 붙인 줄 번호다. 콜론 뒤만 이어 붙인다.
3. `41`은 Mode 01 긍정 응답이다. 그 뒤부터 `PID + 데이터`가 반복된다.
4. PID 번호로 `PidSpec`을 찾아 `bytes`만큼 읽고, 다음 PID로 이동한다.
5. 응답에 없는 PID는 `values`에 들어가지 않는다. `undefined`를 0으로 바꾸지 않는다.

`parseMode01`은 `requested`에 없는 PID도 표에 있으면 파싱한다. 호출자가 요청한 것만 쓰려면 `wanted` 검사를 그대로 두면 된다. 표에 없는 PID를 만나면 그 지점에서 멈춘다. **응답 순서를 요청 순서로 가정하지 않는 것**이 핵심이다. ELM327 데이터시트도 "응답 순서는 요청 순서와 같을 필요가 없다"고 적는다(p.45).

### 실행 예제

`src/cli.ts`:

```typescript
import { parseArgs } from "node:util";
import { Elm327Client, initializeElm } from "./elm327.ts";
import { PIDS, parseMode01, parseSupportedPids, pidRequest, responseBytes, type PidKey } from "./obd.ts";
import { SerialTransport, TcpTransport, type Transport } from "./transport.ts";

const { values: args } = parseArgs({
  options: {
    mode: { type: "string", default: "emulator" },
    port: { type: "string" },
    baud: { type: "string", default: "38400" },
    tcp: { type: "string", default: "127.0.0.1:35000" },
    watch: { type: "boolean", default: false },
  },
});

const keys: PidKey[] = ["rpm", "speed", "coolant", "throttle", "fuel", "voltage"];
const transport = await openTransport();
const client = new Elm327Client(transport, { defaultTimeoutMs: 1500 });
try {
  const info = await initializeElm(client);
  console.log(`protocol=${info.protocol} battery=${info.battery}`);

  const supported = await client.command("0100", 12000);
  if (supported.kind === "ok") {
    const mask = responseBytes(supported.lines).subarray(2, 6);
    console.log("supported:", parseSupportedPids(mask).map((pid) => pid.toString(16).toUpperCase().padStart(2, "0")).join(" "));
  }

  do {
    const response = await client.command(pidRequest(keys), 1500);
    if (response.kind === "no-data") {
      console.log("NO DATA");
    } else if (response.kind === "error") {
      console.log("adapter error:", response.code);
    } else {
      const values = parseMode01(response.lines, keys);
      console.log(
        Object.entries(values)
          .map(([key, value]) => `${key}=${value}${PIDS[key as PidKey].unit}`)
          .join("  "),
      );
    }
    if (args.watch) await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (args.watch);
} finally {
  await client.close();
}

async function openTransport(): Promise<Transport> {
  if (args.mode === "serial") {
    if (!args.port) throw new Error("--port COM5 형식이 필요합니다");
    return SerialTransport.open(args.port, Number(args.baud));
  }
  const [host, portText] = (args.tcp ?? "127.0.0.1:35000").split(":");
  return TcpTransport.open(host ?? "127.0.0.1", Number(portText));
}
```

차 없이 실행하려면 ELM327-emulator를 TCP 모드로 띄운다(17장).

```bash
# 터미널 1
python -m elm -n 35000 -s car

# 터미널 2
npm run typecheck
node src/cli.ts --mode emulator
```

실행 결과(2026-10-29, ELM327-emulator 4.0.0):

```text
protocol=A6 battery=13.1V
supported: 01 03 04 05 06 07 0B 0C 0D 0E 0F 10 11 13 15 1C 1F 20
rpm=1304rpm  speed=10km/h  coolant=55°C  throttle=16.9%  fuel=66.7%  voltage=14.67V
```

- `protocol=A6`는 `ATDPN`의 응답이다. ISO 15765-4 CAN 11비트 500k를 뜻한다(7장).
- 지원 PID 목록은 emulator의 `scenario car` 값이다. 실제 차량과 다르다.
- `rpm=1304rpm`처럼 단위가 붙어 읽기 어렵다면 출력 형식만 고치면 된다. 값 자체는 `parseMode01`이 숫자로 돌려준다.
- 실제 차량에서는 `--mode serial --port COM5`로 실행한다. 보율이 9600이면 `--baud 9600`을 준다.

## 21.6 7장 파이썬 코드와 나란히

7장의 파이썬 `Elm327.command()`는 바이트를 1개씩 읽어 `>`를 찾는다.

```python
buf = bytearray()
deadline = time.monotonic() + timeout
while time.monotonic() < deadline:
    chunk = self.ser.read(1)
    if not chunk:
        continue
    buf.extend(chunk)
    if chunk == b">":
        break
```

TypeScript는 `data` 이벤트로 청크를 받아 버퍼에 쌓고, `\r`과 `>`를 찾는다. **같은 상태 기계**를 이벤트 기반으로 옮긴 것이다.

| 관심사 | 7장 파이썬 | 21장 TypeScript |
|---|---|---|
| 포트 열기 | `serial.Serial(port, baud, timeout=0.1)` | `new SerialPort({ path, baudRate, autoOpen: false })` + `open()` |
| 읽기 | `read(1)` 루프 | `data` 이벤트 + 문자열 버퍼 |
| 줄 경계 | `read(1)`로 `>`까지 | `\r` 분할 + `>` 프롬프트 |
| 명령 직렬화 | 호출자가 순서 보장 | `tail` 프라미스 체인 |
| 응답 타입 | `list[str]` | `ElmResponse` 판별 유니온 |
| PID 공식 | `if pid == ...` 연쇄 | `PIDS` 표 + `bytes` 길이 |
| 다중 PID | `query_pid`가 한 PID씩 | `parseMode01`이 연속 파싱 |
| 동시성 | `threading.Thread` | `async` 루프 + 이벤트 루프 |
| 대시보드 | Flask + `jsonify` | `node:http` + SSE(22장) |

파이썬 쪽이 더 읽기 쉬운 부분도 있다. `read(1)` 루프는 "프롬프트까지 읽는다"는 의도가 코드에 그대로 보인다. TypeScript 쪽은 이벤트와 버퍼 상태가 나뉘어 있어, 처음에는 `pending`과 `buffer`의 역할을 이해해야 한다. 대신 Node에서는 느린 시리얼 읽기가 다른 요청을 막지 않는다. Flask + 스레드와 Node + 이벤트 루프의 차이는 22장에서 다시 본다.

## 21.7 응답 시간과 처리량

ELM327의 속도는 차량 ECU의 응답 시간과 어댑터의 타임아웃에 의해 결정된다. 데이터시트의 숫자를 먼저 보자.

### ATST와 ATAT

| 설정 | 뜻 | 기본값 |
|---|---|---|
| `AT ST hh` | 응답 타임아웃. 4ms 단위의 **16진수** `hh` | `32`(16진수 50) ≈ 200ms |
| `AT ST 00` | 0이 아니라 기본값으로 복원 | — |
| `AT AT0` | 적응형 타이밍 끔. 항상 `AT ST` 값 | — |
| `AT AT1` | 적응형 타이밍 1. 권장 | 기본 |
| `AT AT2` | 적응형 타이밍 2. 더 공격적 | — |

- `AT ST 32`의 `32`는 10진수 32가 아니라 16진수 0x32=50이다. 50×4ms=200ms다.
- `AT ST 19`는 0x19=25, 25×4ms=100ms다.
- `AT ST`는 적응형 타이밍이 켜져 있어도 **최대값**이다. 적응형 타이밍이 더 길게 잡으려 해도 `AT ST`를 넘지 않는다.
- `AT AT1`은 차량의 실제 응답 시간을 학습해 타임아웃을 조정한다. 대부분의 차량에서는 기본값을 그대로 두는 것이 좋다.
- `AT AT0`은 테스트에 유용하다. 타임아웃이 고정되어 결과가 재현된다. 시험 후 `AT AT1`로 되돌린다.
- J1939는 적응형 타이밍을 지원하지 않는다(데이터시트 p.52).

### 응답 뒤에도 기다린다

ELM327은 요청을 보낸 뒤 최대 `AT ST`만큼 기다리고, **응답을 받은 뒤에도 같은 타이머로 추가 응답이 오는지 기다린다.** 여러 ECU가 응답하는 기능 주소 `7DF` 요청에서는 이 꼬리 시간이 붙는다. 데이터시트는 기본 200ms 타임아웃에서 50ms 응답이면 초당 약 4회, `AT ST`를 100ms로 줄이면 약 7회, 적응형 타이밍이 90ms를 고르면 약 6회라고 예를 든다(p.52).

응답이 하나뿐인 것을 알면 요청 끝에 hex digit을 붙여 **기다릴 최대 응답 줄 수**를 지정할 수 있다.

```text
>01 00 2
```

이렇게 하면 2줄을 받은 즉시 돌아온다. 데이터시트 예에서는 6회/초가 10~12회/초로 올라간다(p.52). 대신 실제 응답 수보다 작게 지정하면 ACK/재전송 문제가 생길 수 있다. **응답 수를 확실히 알 때만** 쓴다. 기능 주소로 여러 ECU에 물을 때는 응답 수가 차량마다 다르므로 쓰지 않는 편이 안전하다.

### 여러 PID를 한 요청에

CAN(ISO 15765-4)에서는 한 요청에 **최대 6개 PID**를 넣을 수 있다. 응답은 한 메시지에 모여 오고, 순서는 요청과 다를 수 있다(데이터시트 p.45). 7장의 쏘렌토 실차 기록에서도 6개 PID, 7개 항목을 한 요청으로 묶어 0.09~0.11초 주기로 읽었다.

```text
>01 0C 0D 05 11 2F 42
00F
0: 41 0C 1A F8 0D 50
1: 05 7B 11 40 2F 80
2: 42 3A 98
```

- 6개 PID를 한 요청에 넣으면 요청 6번의 왕복이 1번으로 줄어든다.
- 응답 파싱은 PID 번호로 해야 한다. 순서를 가정하면 엉뚱한 값이 들어간다.
- 6개를 넘기면 ELM327이 `?`를 돌려주거나 요청을 거부한다. 이 책의 `pidRequest`는 6개를 넘으면 예외를 던진다.

### 직렬 전송 시간

데이터시트의 예(11비트 ID, 8바이트, `ATH1`·`ATS0`·`ATL0`)에서 ELM327이 결과를 RS-232로 내보내는 평균 시간은 다음과 같다(p.74).

| 보율 | 11비트 ID | 29비트 ID |
|---|---|---|
| 38400 | 5.18ms | 6.48ms |
| 115200 | 1.74ms | 2.18ms |
| 500000 | 0.40ms | 0.50ms |

200ms 타임아웃에 비하면 직렬 전송은 병목이 아니다. 병목은 **차량의 응답 시간과 응답 후 대기 시간**이다. `BUFFER FULL`은 PID 몇 개를 읽는 상황이 아니라, `AT MA`로 버스 전체를 모니터링할 때 주로 나온다. ELM327의 전송 버퍼는 512바이트다(p.74).

### 우리 코드에서 측정하기

```typescript
import { performance } from "node:perf_hooks";

const started = performance.now();
const response = await client.command(pidRequest(keys), 1500);
const elapsed = performance.now() - started;
console.log(`${elapsed.toFixed(1)}ms`, response.kind);
```

- 측정값에는 명령 전송, 차량 응답, ELM327의 응답 후 대기, 직렬 전송이 모두 들어간다.
- 같은 코드라도 시동 상태, ECU, 버스 부하에 따라 달라진다. 한 번의 측정으로 단정하지 않는다.
- 100ms 이하를 목표로 `AT ST`를 낮추면, 느린 ECU나 응답 대기(`7F xx 78`)에서 실패가 늘어난다. 먼저 기본값으로 안정성을 확인하고, 필요할 때만 줄인다.
- 수집 주기를 1초로 두면 200ms 꼬리가 있어도 충분하다. 10Hz가 필요하면 다중 PID, 응답 수 digit, `AT ST` 조정을 함께 검토한다.

## 21.8 Node.js에서 SocketCAN

Linux에서는 ELM327 없이 CAN 프레임을 직접 다룰 수 있다. 17장에서 만든 `vcan0`을 Node에서 쓰려면 `socketcan` 패키지를 쓴다.

```bash
sudo modprobe vcan
sudo ip link add dev vcan0 type vcan
sudo ip link set dev vcan0 up
sudo apt install can-utils
npm install socketcan
```

```typescript
import * as can from "socketcan";

interface CanFrame {
  id: number;
  ext: boolean;
  rtr: boolean;
  data: Buffer;
}

const channel = can.createRawChannel("vcan0", true);
channel.addListener("onMessage", (frame: CanFrame) => {
  console.log(frame.id.toString(16), frame.ext, frame.data.toString("hex"));
});
channel.start();

// vcan/벤치에서만 송신한다. 실제 차량에서는 보내지 않는다.
channel.send({
  id: 0x7df,
  ext: false,
  rtr: false,
  data: Buffer.from([0x02, 0x01, 0x0c, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc]),
});

// 종료 시
channel.stop();
```

- `createRawChannel("vcan0", true)`의 두 번째 인자는 타임스탬프 생성 여부다.
- `onMessage`의 `frame.data`는 `Buffer`다. `id`는 숫자, `ext`는 29비트 여부다.
- `channel.send()`는 CAN 프레임을 실제로 보낸다. **vcan이나 책상 위 시험 버스에서만** 호출한다. 실제 차량 버스에 임의 프레임을 보내면 ECU 동작에 영향을 줄 수 있다.
- vcan은 ECU를 흉내 내지 않는다. `7DF` 요청을 보내도 응답이 없다. 응답이 필요하면 17장의 가짜 ECU를 같은 vcan에 붙인다.
- `socketcan`은 Linux 전용이다. Windows에는 SocketCAN이 없으므로 ELM327 시리얼/TCP, 제조사 USB-CAN SDK, WSL2 중 하나를 고른다. WSL2의 vcan 지원은 커널에 따라 다르다(17장).

### 유지보수 상태

이 책을 쓴 시점(2026-10-29)에 `socketcan` 최신 버전은 4.3.2(2026-10-03)다. 4.1.0(2026-05-17)에서 네이티브 애드온을 N-API로 옮겨 Node 메이저 버전을 올려도 다시 컴파일하지 않아도 된다. 4.3.1에서는 `ENETDOWN`/`ENOBUFS` 같은 일시적 소켓 오류에서 수신이 영구히 멈추지 않도록 고쳤다. 패키지가 오래 방치된 것이 아니라 **최근까지 유지되고 있다**고 판단할 근거는 있지만, 의존성을 추가하기 전에는 항상 저장소의 최근 커밋과 이슈를 다시 확인한다.

### python-can과 비교

| python-can | socketcan (Node) |
|---|---|
| `can.Bus(interface="socketcan", channel="vcan0")` | `can.createRawChannel("vcan0", true)` |
| `bus.recv()` | `channel.addListener("onMessage", ...)` |
| `bus.send(can.Message(...))` | `channel.send({ id, ext, rtr, data })` |
| `bus.shutdown()` | `channel.stop()` |
| `can.Message`의 `arbitration_id`, `is_extended_id` | `frame.id`, `frame.ext` |

## 21.9 흔한 실수

| 증상 | 원인 | 해결 |
|---|---|---|
| 응답이 잘린다 | 청크 경계를 줄 경계로 착각 | `\r` 버퍼 + 프롬프트까지 대기 |
| 다음 명령의 응답이 앞 명령에 섞인다 | 명령을 겹쳐 보냄 | `command()` 큐, 한 번에 하나 |
| `NO DATA`를 오류로 처리해 재연결한다 | 미지원 PID와 통신 오류를 구분하지 않음 | `no-data`와 `error` 분리 |
| `SEARCHING...`에서 타임아웃 | 프로토콜 검색 시간을 고려하지 않음 | 첫 요청 12초, `ATSP0` 15초 |
| `7F xx 78`에서 타임아웃 | Response Pending을 오류로 봄 | 호스트 타임아웃 여유, 최종 응답 대기 |
| PID 값이 뒤바뀐다 | 응답 순서를 요청 순서로 가정 | PID 번호로 찾기 |
| 값이 이상하다 | PID 데이터 길이를 고정 | `PidSpec.bytes` 사용 |
| `ATZ`가 `STOPPED` | 프롬프트 전에 입력 | 다시 보내거나 연결 재시작 |
| `?`가 온다 | 명령 오타, 클론 미지원 | 명령 문자열 확인, `ATI`로 버전 확인 |
| 포트가 안 보인다 | CH340 드라이버, 데이터 케이블 | 장치 관리자, 케이블 교체 |
| Node가 `.ts`를 실행하지 못한다 | Node 22.18.0 미만 | Node 업그레이드 또는 `tsx` |
| socketcan이 로드되지 않는다 | Windows, vcan 미생성 | Linux/WSL2, `ip link` 확인 |

## 21.10 체크리스트

- [ ] Node 24.12 이상(또는 `tsx`)과 `serialport` 13을 설치했는가
- [ ] `npm run typecheck`가 통과하는가
- [ ] `ATZ`→`ATE0`→`ATL0`→`ATSP0` 순서로 초기화했는가
- [ ] `ATDPN`으로 프로토콜을 확인했는가
- [ ] 명령을 한 번에 하나만 보내는가
- [ ] `\r`과 `>` 프롬프트를 모두 처리하는가
- [ ] `NO DATA`와 어댑터 오류를 구분하는가
- [ ] 다중 PID 응답을 PID 번호로 찾는가
- [ ] PID 데이터 길이를 표에서 가져오는가
- [ ] 타임아웃 후 연결을 재동기화하는가
- [ ] 실제 차량에는 읽기 요청만 보냈는가
- [ ] socketcan 송신은 vcan/벤치에서만 했는가

## 장 요약

- Node 24.12부터 `.ts`를 직접 실행할 수 있다. 타입 검사는 `tsc --noEmit`으로 따로 한다.
- `serialport`는 `autoOpen: false`로 열고 `data`·`close`·`error` 이벤트를 다룬다. `write()` 뒤 `drain()`으로 전송 완료를 기다린다.
- ELM327은 `\r`로 명령을 끝내고 `>` 프롬프트로 응답을 마친다. 청크는 원하는 크기로 오지 않는다.
- 명령을 겹쳐 보내면 응답이 섞인다. `Elm327Client`는 프라미스 큐로 직렬화한다.
- `NO DATA`는 정상적인 빈 응답, `SEARCHING...`은 진행 표시, `7F xx 78`은 응답 대기다.
- 호스트 타임아웃 뒤에는 늦은 응답이 다음 명령과 섞이므로 연결을 닫고 재연결한다.
- PID는 `PIDS` 표의 `pid`·`bytes`·`decode`로 파싱한다. 응답 순서를 가정하지 않는다.
- 한 요청에 PID 6개까지 넣을 수 있다. 7장의 쏘렌토 기록에서 7항목 0.09~0.11초 주기를 확인했다.
- `AT ST`는 4ms 단위의 16진수다. 기본 `32`(0x32=50)는 약 200ms다. `AT AT1` 적응형 타이밍이 기본·권장이다.
- 응답 뒤에도 같은 타임아웃만큼 추가 응답을 기다린다. 응답 수 digit은 그 꼬리를 없앨 수 있지만, 응답 수를 확실히 알 때만 쓴다.
- `socketcan`은 Linux 전용이며 vcan에서 시험한다. 실제 차량 버스에는 임의 프레임을 보내지 않는다.

다음 장에서는 이 클라이언트를 수집기로 감싸고, SQLite 저장·SSE 서버·브라우저 게이지를 붙여 **차 없이 끝까지 도는 실시간 대시보드**를 만든다.

## 연습 문제

### 1. (중급) 청크 경계

`Elm327Client`에 다음 두 청크가 순서대로 도착했다.

```text
"41 0C 1A"
" F8\r\r>"
```

1. `data` 이벤트가 두 번 발생했을 때 `buffer`는 각각 어떻게 변하는가?
2. 최종 `ElmResponse`의 `kind`와 `lines`는 무엇인가?
3. `ReadlineParser`로는 이 응답을 왜 처리하기 어려운가?

### 2. (중급) 다중 PID 파싱

다음 응답이 왔다.

```text
00A
0: 41 04 3F 05 44 0B
1: 21 0C 17 B8 00 00 00
```

1. 계산된 엔진 부하(PID 04)를 구하라.
2. 냉각수 온도(PID 05)를 구하라.
3. 흡기 매니폴드 절대압(PID 0B)을 구하라.
4. 엔진 회전수(PID 0C)를 구하라.
5. `00A`와 마지막 `00 00 00`은 각각 무엇인가?

### 3. (중급) 타임아웃 계산

1. `AT ST 32`의 실제 타임아웃은 몇 ms인가?
2. `AT ST 19`는 몇 ms인가?
3. `AT AT0`과 `AT AT1`의 차이를 설명하라.
4. `AT ST`를 100ms로 줄였을 때, 응답 후 대기까지 포함한 한 요청의 최악 시간은 얼마인가? (응답 자체는 50ms라고 가정)

### 4. (기초) 응답 분류

다음 응답을 `ok`, `no-data`, `error`, `대기`로 분류하라.

```text
1. NO DATA
2. SEARCHING...\r41 00 BE 1F A8 13
3. STOPPED
4. 7F 01 78
5. ?
```

### 5. (중급) 플랫폼 선택

Windows 노트북에서 다음을 하려 한다. 각각 어떤 도구를 쓰는가?

1. 실제 차량에서 OBD-II PID 읽기
2. 차 없이 ELM327 AT 명령과 PID 파싱 연습
3. Linux vcan에 붙은 가짜 ECU와 CAN 프레임 주고받기
4. 실제 차량 버스에 임의 프레임을 보내는 실험

## 정답과 해설

### 1.

1. 첫 청크 뒤 `buffer`는 `"41 0C 1A"`다. `\r`이 없으므로 `consumeLine`은 호출되지 않는다. 둘째 청크 뒤에는 `"41 0C 1A F8\r\r>"`가 되고, `\r` 분할로 `"41 0C 1A F8"`과 `""`를 처리한 뒤 `>`를 찾아 응답을 완료한다.
2. `{ kind: "ok", lines: ["41 0C 1A F8"] }`다. 선행 공백은 `trim()`으로 제거된다.
3. `ReadlineParser`는 `\n` 기준이고, ELM327은 `\r`을 쓴다. `DelimiterParser`에 `\r`을 줘도 프롬프트 `>`가 별도 줄이 아니거나 줄에 붙어 오는 경우를 처리해야 한다. 프롬프트를 응답 종료 조건으로 직접 다루는 편이 안전하다.

### 2.

1. `0x3F=63`, `63×100/255≈24.7%`.
2. `0x44=68`, `68−40=28°C`.
3. `0x21=33 kPa`.
4. `0x17B8=6072`, `6072/4=1518 rpm`.
5. `00A`는 ISO-TP 메시지 길이 10바이트다. `parseMode01`은 이 값을 `limit`로 써서 10바이트까지만 읽는다. 마지막 `00 00 00`은 8바이트 프레임을 채우는 패딩이며 해석하지 않는다. 이 응답은 `parseMode01(lines, ["load", "coolant", "map", "rpm"])`로 확인할 수 있다.

### 3.

1. `32`는 16진수 0x32=50이다. 50×4ms=200ms.
2. 0x19=25, 25×4ms=100ms.
3. `AT AT0`은 적응형 타이밍을 끄고 항상 `AT ST` 값을 쓴다. `AT AT1`은 차량 응답 시간을 학습해 타임아웃을 조정하되 `AT ST`를 최대값으로 지킨다. 기본값은 `AT AT1`이다.
4. 응답 50ms + 응답 후 대기 100ms = 150ms. 여기에 명령 전송·직렬 전송 시간이 더해진다. 실제로는 여유를 두어 호스트 타임아웃을 300ms 이상으로 잡는다.

### 4.

1. `no-data`
2. `ok` (`SEARCHING...`은 진행 표시, `41 00 ...`이 실제 응답)
3. `error`
4. `대기` (Response Pending. 최종 응답이 올 때까지 기다린다)
5. `error`

### 5.

1. ELM327 USB(또는 Bluetooth) 어댑터 + `serialport`/`pyserial`. 정차·읽기 전용.
2. ELM327-emulator TCP(`-n 35000`) + `TcpTransport`. Windows에서 com0com이 필요 없다.
3. Linux/WSL2의 vcan + `socketcan`(또는 python-can virtual). WSL2 커널에 vcan 모듈이 있는지 먼저 확인한다.
4. 하지 않는다. 실제 차량 버스에 임의 프레임을 보내는 것은 이 책의 범위 밖이며, ECU·안전 장치에 영향을 줄 수 있다. 송신 실험은 vcan이나 책상 위 시험 버스에서만 한다.
