# 19장 캡스톤: 실시간 차량 대시보드 만들기

## 이 장에서

7장에서는 파이썬으로 대시보드를 만들었고, 18장에서는 TypeScript로 ELM327 클라이언트를 만들었다. 이 장은 그 두 가지를 하나의 프로젝트로 묶는다. **수집기 → 저장 → 서버 → 브라우저**까지 한 줄로 이어지는 실시간 대시보드를 만들고, 차 없이 ELM327-emulator로 끝까지 돌린다.

```text
[ELM327 또는 ELM327-emulator]
        │ 시리얼/TCP
        ▼
[Collector] ── 표본(Sample) ──▶ [SampleStore] ── SQLite
        │                              │
        │ 최신값                        │ /api/history
        ▼                              ▼
[HTTP 서버] ── SSE(/events) ──▶ [브라우저 게이지·차트]
```

이 장에서 다루는 것:

- 수집기·저장소·서버·화면을 나누는 이유
- `setInterval` 대신 완료 후 대기하는 폴링 루프
- SQLite에 배치로 쓰고 보존 기간을 두는 방법
- SSE로 최신값을 밀어 주고, 느린 클라이언트를 드롭하는 백프레셔
- 게이지·꺾은선 차트·단위 변환·데이터 지연 표시
- ELM327-emulator로 실차 없이 끝까지 검증하기
- 재연결·백오프·정상 종료·로컬 바인딩

**안전 원칙**: 실제 차량에서는 정차 상태에서 읽기만 한다. 이 장의 수집기는 Mode 01 PID만 요청한다. 쓰기·삭제·코딩·액추에이터 구동은 넣지 않는다. 송신 실습은 14장의 vcan이나 에뮬레이터에서만 한다.

## 19.1 구조와 선택

### 왜 네 계층인가

한 파일에 다 넣으면 빨리 만들 수 있지만, 문제가 생겼을 때 어디를 봐야 할지 알기 어렵다. 이 장은 웹 애플리케이션과 같은 방식으로 나눈다.

| 계층 | 파일 | 책임 | 웹 비유 |
|---|---|---|---|
| 수집 | `collector.ts` | PID 요청, 주기, 오류 분류 | 크론 잡·워커 |
| 저장 | `store.ts` | 배치 INSERT, 보존, 조회 | 데이터베이스 계층 |
| 전송 | `server.ts` | HTTP, SSE, 백프레셔 | API·WebSocket 서버 |
| 표현 | `public/app.js` | 게이지·차트·단위 | 프런트엔드 |

- 수집기는 화면을 모른다. `Sample`만 콜백한다.
- 저장소는 ELM327을 모른다. `Sample`을 받아 SQL로 쓴다.
- 서버는 수집기와 저장소를 주입받는다. 테스트에서 가짜 구현으로 바꿀 수 있다.
- 브라우저는 `/events`의 JSON만 안다. PID 공식은 서버에서 끝난다.

### SSE를 고른 이유

서버에서 브라우저로 **한 방향**으로 최신값을 보내면 되므로 SSE(Server-Sent Events)로 충분하다. `EventSource`는 기본적으로 재연결을 하고, `retry:`로 대기 시간을 정할 수 있으며, WebSocket처럼 별도 패키지가 필요 없다. MDN도 SSE를 "서버에서 클라이언트로만 데이터를 보내는 단방향" 스트림이라고 설명한다.

- WebSocket이 필요한 경우: 브라우저에서 서버로 명령을 보내야 할 때(예: PID 선택 변경, 수집 일시정지). 이 장은 읽기 전용 대시보드라 SSE로 충분하다.
- HTTP/1.1에서는 브라우저+도메인당 동시 SSE 연결이 6개로 제한될 수 있다. 탭을 여러 개 열어 두는 운영이라면 HTTP/2를 쓰거나 WebSocket으로 바꾼다.
- SSE는 텍스트다. JSON을 `data:` 줄에 넣는다. 바이너리 프레임을 그대로 보내려면 WebSocket이 낫다.

### SQLite를 고른 이유

- 파일 하나로 끝나고, SQL로 조회할 수 있다.
- 이 규모(초당 6행)에서는 충분히 빠르다.
- 17장에서 본 것처럼 초당 수천 프레임의 **원시 CAN 로그**에는 SQLite가 맞지 않는다. 이 장은 PID 표본만 저장한다.

Node 24.15의 `node:sqlite`는 Stability 1.2(Release candidate)다. API가 바뀔 수 있으므로 `SampleStore` 뒤에 숨긴다. 나중에 `better-sqlite3`로 바꿔도 나머지 코드는 그대로다.

## 19.2 프로젝트 준비

18장의 프로젝트를 그대로 확장한다. 이미 `transport.ts`, `elm327.ts`, `obd.ts`가 있다고 가정한다.

```bash
mkdir -p public
npm install serialport
npm install --save-dev typescript @types/node
```

`package.json` 스크립트:

```json
{
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "demo": "node src/main.ts --mode demo --db :memory:",
    "dashboard": "node src/main.ts --mode emulator --db :memory: --http 8787",
    "dashboard:serial": "node src/main.ts --mode serial --port COM5 --baud 38400",
    "test": "node --test"
  }
}
```

디렉터리:

```text
obd-dashboard/
  src/
    transport.ts     # 18장
    elm327.ts        # 18장
    obd.ts           # 18장
    collector.ts
    store.ts
    server.ts
    main.ts
  public/
    index.html
    app.css
    app.js
  test/
    elm327.test.ts
    obd.test.ts
    store.test.ts
```

`node:sqlite`는 별도 패키지가 아니다. Node 24.15에 내장되어 있다. `npm install sqlite3`을 하지 않는다.

## 19.3 수집기: 완료 후 대기하는 폴링 루프

`setInterval(() => poll(), 1000)`은 폴링이 1초보다 오래 걸리면 요청이 겹친다. ELM327은 반이중이라 겹친 요청의 응답이 섞인다. 그래서 **이전 요청이 끝난 뒤 다음 요청을 보내고, 남은 시간만 기다리는** 루프를 쓴다.

`src/collector.ts`:

```typescript
import { performance } from "node:perf_hooks";
import { Elm327Client, Elm327Error } from "./elm327.ts";
import { parseMode01, pidRequest, type PidKey, type PidValues } from "./obd.ts";

export interface Sample {
  ts: number;
  ok: boolean;
  values: PidValues;
  roundTripMs: number;
  error?: string;
}

export interface CollectorOptions {
  intervalMs?: number;
  keys?: readonly PidKey[];
  timeoutMs?: number;
  firstTimeoutMs?: number;
  onFatal?: (error: Error) => void;
}

const DEFAULT_KEYS: readonly PidKey[] = ["rpm", "speed", "coolant", "throttle", "fuel", "voltage"];

/**
 * PID 묶음을 주기적으로 읽는다. 다음 요청은 이전 응답이 끝난 뒤에 보낸다.
 * setInterval을 쓰면 느린 응답에서 요청이 겹치므로, 완료 후 대기하는 루프를 쓴다.
 */
export class Collector {
  private readonly client: Elm327Client | null;
  private readonly onSample: (sample: Sample) => void;
  private readonly options: Required<Omit<CollectorOptions, "onFatal">> & Pick<CollectorOptions, "onFatal">;
  private running = false;
  private first = true;
  private failures = 0;

  constructor(
    client: Elm327Client | null,
    onSample: (sample: Sample) => void,
    options: CollectorOptions = {},
  ) {
    this.client = client;
    this.onSample = onSample;
    this.options = {
      intervalMs: options.intervalMs ?? 1000,
      keys: options.keys ?? DEFAULT_KEYS,
      timeoutMs: options.timeoutMs ?? 1500,
      firstTimeoutMs: options.firstTimeoutMs ?? 12000,
      onFatal: options.onFatal,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const started = performance.now();
      try {
        const values = await this.poll();
        this.onSample({
          ts: Date.now(),
          ok: true,
          values,
          roundTripMs: Math.round(performance.now() - started),
        });
        this.failures = 0;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.onSample({
          ts: Date.now(),
          ok: false,
          values: {},
          roundTripMs: Math.round(performance.now() - started),
          error: message,
        });
        const elmError = error instanceof Elm327Error ? error : null;
        if (elmError?.code === "adapter") this.failures += 1;
        if (
          elmError !== null &&
          (elmError.code === "timeout" || elmError.code === "closed" || this.failures >= 3)
        ) {
          this.running = false;
          this.options.onFatal?.(error as Error);
          return;
        }
      }
      this.first = false;
      const wait = Math.max(0, this.options.intervalMs - (performance.now() - started));
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  private async poll(): Promise<PidValues> {
    if (!this.client) return demoValues();

    const command = pidRequest(this.options.keys);
    const timeout = this.first ? this.options.firstTimeoutMs : this.options.timeoutMs;
    const response = await this.client.command(command, timeout);
    if (response.kind === "no-data") return {};
    if (response.kind === "error") {
      throw new Elm327Error(`어댑터 오류: ${response.code}`, "adapter");
    }
    return parseMode01(response.lines, this.options.keys);
  }
}

/** 차 없이 화면을 만들 때 쓰는 그럴듯한 값. 실제 요청 경로는 타지 않는다. */
export function demoValues(t = Date.now()): PidValues {
  const s = t / 1000;
  return {
    rpm: Math.round(900 + 650 * (1 + Math.sin(s / 4))),
    speed: Math.round(Math.max(0, 60 + 50 * Math.sin(s / 7))),
    coolant: Math.round(82 + 4 * Math.sin(s / 15)),
    throttle: Number((20 + 15 * (1 + Math.sin(s / 3))).toFixed(1)),
    fuel: Number((62 + 2 * Math.sin(s / 20)).toFixed(1)),
    voltage: Number((14.1 + 0.15 * Math.sin(s / 5)).toFixed(2)),
  };
}
```

- `this.first`일 때 타임아웃을 12초로 준다. `ATSP0` 뒤 첫 PID 요청은 `SEARCHING...`으로 오래 걸릴 수 있다. 이후에는 1.5초면 충분하다.
- `wait`는 `intervalMs - 경과 시간`이다. 폴링이 1초를 넘으면 0이 되어 바로 다음 요청을 보낸다. 이때 실제 주기는 1초보다 길어진다. **주기를 보장하는 것이 아니라, 겹치지 않게 하는 것**이 목적이다.
- `NO DATA`는 빈 값으로 표본을 만든다. 통신 오류가 아니므로 재연결하지 않는다. 화면은 `--`를 보여 주고, 상태는 "실시간"으로 둔다.
- 어댑터 오류(`UNABLE TO CONNECT`, `BUFFER FULL` 등)가 3번 연속이면 `onFatal`로 세션을 끝낸다. 한 번의 `?`로 재연결하지 않기 위한 임계값이다.
- 타임아웃·연결 끊김은 즉시 `onFatal`이다. 18장에서 설명한 대로, 늦은 응답이 다음 명령과 섞이는 것을 막기 위해 연결을 다시 연다.
- `ts`는 `Date.now()`(벽시계), `roundTripMs`는 `performance.now()`(단조 시계)다. 둘을 섞지 않는다.

### 처리량과 백프레셔

이 파이프라인에는 백프레셔 지점이 네 곳 있다.

| 지점 | 압력 | 이 책의 정책 |
|---|---|---|
| ELM327 | 한 번에 한 명령 | `Elm327Client` 큐, 수집기는 한 요청만 |
| SQLite | 초당 쓰기 | 120행 또는 2초마다 배치 커밋 |
| SSE | 느린 브라우저 | `write()`가 `false`면 그 클라이언트는 건너뜀 |
| 브라우저 | 그리기 비용 | 최근 180점만 유지, 1초에 한 번 갱신 |

- PID 6개를 1Hz로 읽으면 초당 6행이다. SQLite에는 가벼운 부하다.
- 10Hz로 올리면 초당 60행, 하루 518만 행이다. 인덱스와 보존 기간을 반드시 함께 설계한다.
- ELM327의 `AT ST` 기본 200ms와 응답 후 대기를 생각하면, 단일 PID를 10Hz로 읽는 것은 현실적이지 않다. 다중 PID와 `AT ST` 조정이 필요하다(18.7절).
- 느린 클라이언트에 모든 표본을 큐로 쌓으면 메모리가 무한히 늘어난다. 텔레메트리는 **최신값이 중요하지, 모든 중간값이 중요하지 않다.** 그래서 드롭한다.

## 19.4 저장소: SQLite에 배치로

`src/store.ts`:

```typescript
import { DatabaseSync } from "node:sqlite";
import type { Sample } from "./collector.ts";
import { PIDS, type PidKey } from "./obd.ts";

export interface HistoryRow {
  ts: number;
  value: number;
}

interface PendingRow {
  ts: number;
  key: PidKey;
  value: number;
  unit: string;
}

/**
 * 표본을 SQLite에 모아 둔다. 매 표본마다 커밋하지 않고 배치로 넣는다.
 * Node 24.15의 node:sqlite(DatabaseSync)를 쓰며, 아직 Release candidate다.
 */
export class SampleStore {
  private readonly db: DatabaseSync;
  private readonly insert: ReturnType<DatabaseSync["prepare"]>;
  private readonly pending: PendingRow[] = [];
  private readonly batchSize: number;
  private readonly retentionMs: number;
  private readonly flushIntervalMs: number;
  private lastFlush = Date.now();
  private flushCount = 0;

  constructor(path: string, options: { batchSize?: number; retentionMs?: number; flushIntervalMs?: number } = {}) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS samples (
        ts INTEGER NOT NULL,
        key TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS samples_key_ts ON samples (key, ts);
    `);
    this.insert = this.db.prepare(
      "INSERT INTO samples (ts, key, value, unit) VALUES (?, ?, ?, ?)",
    );
    this.batchSize = options.batchSize ?? 120;
    this.retentionMs = options.retentionMs ?? 7 * 24 * 60 * 60 * 1000;
    this.flushIntervalMs = options.flushIntervalMs ?? 2000;
  }

  add(sample: Sample): void {
    if (!sample.ok) return;
    for (const [key, value] of Object.entries(sample.values)) {
      const spec = PIDS[key as PidKey];
      if (!spec || typeof value !== "number" || !Number.isFinite(value)) continue;
      this.pending.push({ ts: sample.ts, key: key as PidKey, value, unit: spec.unit });
    }
    if (
      this.pending.length >= this.batchSize ||
      Date.now() - this.lastFlush >= this.flushIntervalMs
    ) {
      this.flush();
    }
  }

  flush(): void {
    if (this.pending.length === 0) {
      this.lastFlush = Date.now();
      return;
    }
    const rows = this.pending.splice(0, this.pending.length);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) this.insert.run(row.ts, row.key, row.value, row.unit);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.pending.unshift(...rows);
      throw error;
    }
    this.lastFlush = Date.now();
    this.flushCount += 1;
    if (this.flushCount % 60 === 0) this.trim();
  }

  history(key: PidKey, sinceMs: number, limit = 2000): HistoryRow[] {
    const rows = this.db
      .prepare(
        `SELECT ts, value FROM (
           SELECT ts, value FROM samples
           WHERE key = ? AND ts >= ?
           ORDER BY ts DESC
           LIMIT ?
         ) ORDER BY ts ASC`,
      )
      .all(key, sinceMs, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ ts: Number(row.ts), value: Number(row.value) }));
  }

  close(): void {
    this.flush();
    this.db.close();
  }

  private trim(): void {
    if (this.retentionMs <= 0) return;
    this.db.prepare("DELETE FROM samples WHERE ts < ?").run(Date.now() - this.retentionMs);
  }
}
```

- `STRICT` 테이블은 SQLite 3.37 이상에서 컬럼 타입을 강제한다. Node 24의 내장 SQLite는 그보다 최신이다.
- `journal_mode=WAL`은 읽기와 쓰기를 동시에 하기 좋다. 대신 `-wal`, `-shm` 파일이 생긴다.
- `BEGIN IMMEDIATE`로 쓰기 트랜잭션을 먼저 잡는다. 여러 프로세스가 같은 파일을 쓰는 경우 잠금 충돌을 빨리 드러낸다.
- 배치 크기 120은 6행/초에서 20초분이다. 하지만 `flushIntervalMs=2000`이 먼저 걸려 보통 2초마다 커밋한다. 배치 크기는 "버스트가 왔을 때의 상한"으로 생각한다.
- `flush()` 실패 시 `pending`에 행을 되돌린다. 다음 시도에서 다시 쓰려는 것이다. 디스크가 가득 차면 계속 실패하므로, 운영에서는 오류 카운터와 알람이 필요하다.
- `trim()`은 60번 flush마다(약 2분) 보존 기간을 지난 행을 지운다. 매번 지우면 인덱스 비용이 크다.
- `history()`는 최근 `limit`개를 역순으로 가져온 뒤 다시 오름차순으로 정렬한다. 차트는 시간 오름차순이어야 한다.
- VIN·GPS·주행 경로는 저장하지 않는다. PID 값만으로도 차량 상태를 알 수 있지만, 개인을 특정하는 정보는 아니다. VIN을 붙여야 한다면 해시·솔트를 쓰고 공개 DB와 분리한다.

### 시각과 시계

- 저장하는 `ts`는 epoch 밀리초(벽시계)다. 조회·표시에 쓴다.
- 주기 계산·왕복 시간은 `performance.now()`(단조 시계)다. 벽시계가 NTP로 조정되어도 흔들리지 않는다.
- 벽시계가 뒤로 가면 `history`의 순서가 뒤집힐 수 있다. 차트는 `ts`로 정렬하고, 같은 시각이면 순서를 강제하지 않는다.
- 장시간 운영에서는 NTP 동기화 상태를 확인한다. 차량 PC가 절전에서 깨어나면 시계가 점프할 수 있다.

## 19.5 서버: HTTP와 SSE

`src/server.ts`:

```typescript
import { createServer, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sample } from "./collector.ts";
import { PIDS, type PidKey } from "./obd.ts";
import type { HistoryRow } from "./store.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, "..", "public");

interface SseClient {
  res: ServerResponse;
  slow: boolean;
}

export interface DashboardServer {
  server: Server;
  broadcast(sample: Sample): void;
  listen(port: number, host: string): Promise<void>;
  close(): Promise<void>;
}

export interface DashboardOptions {
  getLatest: () => Sample | null;
  history: (key: PidKey, sinceMs: number, limit: number) => HistoryRow[];
}

/** 정적 파일, 최신값 API, SSE 스트림을 제공하는 작은 HTTP 서버. */
export function createDashboardServer(options: DashboardOptions): DashboardServer {
  const clients = new Set<SseClient>();
  let seq = 0;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/") return sendFile(res, "index.html", "text/html; charset=utf-8");
      if (url.pathname === "/app.js") return sendFile(res, "app.js", "text/javascript; charset=utf-8");
      if (url.pathname === "/app.css") return sendFile(res, "app.css", "text/css; charset=utf-8");
      if (url.pathname === "/api/snapshot") return sendJson(res, options.getLatest());
      if (url.pathname === "/api/history") return sendHistory(res, url, options.history);
      if (url.pathname === "/events") return openEvents(req, res);
      sendJson(res, { error: "not found" }, 404);
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : "server error" }, 500);
    }
  });

  function sendFile(res: ServerResponse, name: string, type: string): void {
    const body = readFileSync(join(PUBLIC_DIR, name));
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": body.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:",
    });
    res.end(body);
  }

  function sendJson(res: ServerResponse, body: unknown, status = 200): void {
    const json = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(json),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(json);
  }

  function sendHistory(
    res: ServerResponse,
    url: URL,
    history: DashboardOptions["history"],
  ): void {
    const key = url.searchParams.get("key") ?? "rpm";
    if (!(key in PIDS)) {
      sendJson(res, { error: "unknown key" }, 400);
      return;
    }
    const requested = Number(url.searchParams.get("minutes") ?? 5);
    const minutes = Number.isFinite(requested) ? Math.max(1, Math.min(1440, requested)) : 5;
    const rows = history(key as PidKey, Date.now() - minutes * 60_000, 5000);
    sendJson(res, { key, minutes, rows });
  }

  function openEvents(req: import("node:http").IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write("retry: 3000\n\n");
    const client: SseClient = { res, slow: false };
    clients.add(client);
    const latest = options.getLatest();
    if (latest) {
      res.write(`id: 0\ndata: ${JSON.stringify(latest)}\n\n`);
    }
    res.on("drain", () => {
      client.slow = false;
    });
    req.on("close", () => {
      clients.delete(client);
    });
  }

  function broadcast(sample: Sample): void {
    seq += 1;
    const frame = `id: ${seq}\ndata: ${JSON.stringify(sample)}\n\n`;
    for (const client of clients) {
      // 느린 클라이언트에는 최신값을 건너뛴다. 다음 표본이 어차피 최신값이다.
      if (client.slow) continue;
      if (!client.res.write(frame)) client.slow = true;
    }
  }

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.res.write(": ping\n\n")) client.slow = true;
    }
  }, 15_000);
  heartbeat.unref();

  return {
    server,
    broadcast,
    listen(port, host) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
    },
    close() {
      clearInterval(heartbeat);
      for (const client of clients) client.res.end();
      clients.clear();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
```

### SSE의 형식

```text
retry: 3000

id: 42
data: {"ts":1793226074899,"ok":true,"values":{"rpm":3443}}

: ping
```

- `Content-Type: text/event-stream`이어야 한다. `charset=utf-8`을 붙인다.
- `retry: 3000`은 재연결 대기 시간이다. 브라우저는 연결이 끊기면 이 시간 뒤에 다시 붙는다.
- `id:`는 마지막 이벤트 ID다. 브라우저는 재연결할 때 `Last-Event-ID` 헤더로 보낸다. 이 구현은 ID를 보내기만 하고, 재전송을 위해 저장하지 않는다. **끊긴 동안의 값을 복구하려면** `/api/history`로 다시 채우거나, 서버가 `Last-Event-ID`를 읽어 그 이후 행을 보내야 한다.
- 콜론으로 시작하는 줄은 주석이다. 15초마다 `: ping`을 보내 프록시가 유휴 연결을 끊지 않게 한다.
- `Cache-Control: no-cache, no-transform`과 `X-Accel-Buffering: no`는 중간 프록시의 버퍼링을 막는다. nginx 뒤에 둘 때 특히 중요하다.
- `res.flushHeaders()`로 헤더를 먼저 보낸다. 헤더가 버퍼에 남아 있으면 브라우저가 연결을 열지 못한다.

### 백프레셔: 느린 클라이언트를 드롭한다

`res.write()`는 버퍼가 차면 `false`를 돌려준다. 이때 `drain` 이벤트를 기다리지 않고 계속 쓰면 메모리가 늘어난다. 이 구현은 `slow` 플래그를 세우고, `drain`이 올 때까지 그 클라이언트에 **표본을 보내지 않는다.**

- 다음 표본이 어차피 최신값이므로, 중간 표본을 버려도 화면은 최신 상태로 돌아온다.
- `drain`이 오면 `slow=false`가 되고 다음 표본부터 다시 보낸다.
- 하트비트는 `slow`와 무관하게 보낸다. 단, 하트비트도 `write()`가 `false`면 `slow`를 세운다.
- 모든 표본을 큐에 쌓는 방식은 "정확히 한 번"이 필요할 때만 쓴다. 이 대시보드는 "가장 최근"이 필요하다.

### API와 보안

- `/api/snapshot`: 최신 표본. 초기 로딩·디버깅용.
- `/api/history?key=rpm&minutes=5`: 최근 시계열. `key`는 `PIDS`에 있는 것만 허용하고, `minutes`는 1~1440으로 제한한다.
- `/`: 정적 HTML. `/app.js`, `/app.css`만 허용한다. 경로를 그대로 파일 시스템에 붙이지 않는다(경로 탈출 방지).
- CSP는 `default-src 'self'`다. 외부 CDN·인라인 스크립트를 쓰지 않는다. 그래서 차트 라이브러리 없이 Canvas로 그린다.
- 기본 바인딩은 `127.0.0.1`이다. 인증이 없으므로 `0.0.0.0`에 열지 않는다. 원격 접속이 필요하면 리버스 프록시에서 TLS·인증·IP 제한을 건다.
- CORS 헤더를 주지 않는다. 같은 출처에서만 쓰는 대시보드다.
- `readFileSync`로 매 요청마다 파일을 읽는다. 파일이 3개뿐이라 문제없지만, 운영에서는 시작할 때 읽어 두는 편이 낫다.

## 19.6 브라우저: 게이지와 차트

### HTML

`public/index.html`:

```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OBD-II 실시간 대시보드</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body>
  <header class="top">
    <div>
      <h1>쏘렌토 OBD-II</h1>
      <p class="sub">정차 상태에서 읽기 전용으로 수집한 값입니다.</p>
    </div>
    <div class="controls">
      <button id="unit-toggle" type="button" aria-pressed="false">단위: km/h · °C</button>
      <p id="status" class="status" role="status" aria-live="polite">
        <span class="dot" aria-hidden="true"></span><span id="status-text">연결 중</span>
      </p>
    </div>
  </header>

  <main>
    <section class="gauges" aria-label="주요 계기">
      <article class="card gauge-card"><canvas id="gauge-rpm" aria-label="엔진 회전수 게이지"></canvas></article>
      <article class="card gauge-card"><canvas id="gauge-speed" aria-label="차속 게이지"></canvas></article>
      <article class="card gauge-card"><canvas id="gauge-coolant" aria-label="냉각수 온도 게이지"></canvas></article>
    </section>

    <section class="digits" id="digits" aria-label="보조 값"></section>

    <section class="card chart-card">
      <div class="chart-head">
        <h2>엔진 회전수 추이</h2>
        <span class="muted">최근 3분 · 1초 간격</span>
      </div>
      <div class="chart-wrap">
        <canvas id="chart" aria-label="엔진 회전수 꺾은선 그래프"></canvas>
        <div id="tooltip" class="tooltip" hidden></div>
      </div>
    </section>

    <details class="card table-view">
      <summary>표로 보기</summary>
      <table>
        <thead><tr><th scope="col">항목</th><th scope="col">값</th><th scope="col">단위</th><th scope="col">갱신</th></tr></thead>
        <tbody id="table-body"></tbody>
      </table>
    </details>
  </main>

  <script type="module" src="/app.js"></script>
</body>
</html>
```

### CSS 핵심

전체 CSS는 길어서 레이아웃·색·카드·차트 영역만 보인다. 다크 테마의 색 토큰은 7장과 같은 계열이다.

```css
:root {
  color-scheme: dark;
  --surface: #0f1419;
  --panel: #161b22;
  --border: #30363d;
  --ink: #e6edf3;
  --muted: #8b949e;
  --accent: #2f81f7;
  --good: #3fb950;
  --warn: #d29922;
  --bad: #f85149;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--surface); color: var(--ink);
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
.top { display: flex; flex-wrap: wrap; gap: 16px; justify-content: space-between;
  max-width: 1100px; margin: 0 auto; padding: 28px 20px 8px; }
h1 { margin: 0; font-size: 24px; }
h2 { margin: 0; font-size: 16px; }
.sub, .muted { color: var(--muted); }
.sub { margin: 4px 0 0; font-size: 14px; }
.controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
button { border: 1px solid var(--border); background: var(--panel); color: var(--ink);
  border-radius: 8px; padding: 8px 12px; font: inherit; font-size: 13px; cursor: pointer; }
button:hover { border-color: var(--accent); }
.status { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 13px; color: var(--muted); }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); }
.status.live .dot { background: var(--good); }
.status.warn .dot { background: var(--warn); }
.status.error .dot { background: var(--bad); }
.status.live { color: var(--ink); }
.status.warn, .status.error { color: var(--ink); }
main { max-width: 1100px; margin: 0 auto; padding: 12px 20px 40px; display: grid; gap: 16px; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; }
.gauges { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
.gauge-card { padding: 8px; }
.gauge-card canvas { display: block; width: 100%; height: 170px; }
.digits { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; }
.digit { padding: 14px 16px; }
.digit .label { color: var(--muted); font-size: 13px; }
.digit .value { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; }
.digit .unit { color: var(--muted); font-size: 13px; margin-left: 4px; }
.chart-card { padding: 16px; }
.chart-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; justify-content: space-between; }
.chart-head .muted { font-size: 12px; }
.chart-wrap { position: relative; margin-top: 12px; }
.chart-wrap canvas { display: block; width: 100%; height: 200px; }
.tooltip { position: absolute; pointer-events: none; background: #0b0f14;
  border: 1px solid var(--border); border-radius: 8px; padding: 6px 8px;
  font-size: 12px; color: var(--ink); white-space: nowrap; transform: translate(-50%, -110%); }
.table-view { padding: 14px 16px; }
.table-view summary { cursor: pointer; color: var(--muted); font-size: 14px; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); }
th { color: var(--muted); font-weight: 500; }
td.num { font-variant-numeric: tabular-nums; }
```

### JavaScript

`public/app.js`의 핵심은 다음과 같다. 게이지 3개, 보조 값 3개, 회전수 차트, 단위 토글, 지연 표시를 모두 포함한다.

```javascript
const SPECS = {
  rpm: { label: "엔진 회전수", unit: "rpm", min: 0, max: 7000, digits: 0, gauge: true },
  speed: {
    label: "차속", unit: "km/h", min: 0, max: 200, digits: 0, gauge: true,
    imperialUnit: "mph", imperialMin: 0, imperialMax: 124, convert: (v) => v * 0.621371,
  },
  coolant: {
    label: "냉각수 온도", unit: "°C", min: -40, max: 120, digits: 0, gauge: true,
    imperialUnit: "°F", imperialMin: -40, imperialMax: 248, convert: (v) => (v * 9) / 5 + 32,
  },
  throttle: { label: "스로틀", unit: "%", min: 0, max: 100, digits: 1 },
  fuel: { label: "연료량", unit: "%", min: 0, max: 100, digits: 1 },
  voltage: { label: "모듈 전압", unit: "V", min: 10, max: 16, digits: 2 },
};

const GAUGES = ["rpm", "speed", "coolant"];
const DIGITS = ["throttle", "fuel", "voltage"];
const MAX_POINTS = 180;
const state = { imperial: false, latest: null, history: [], lastTs: 0, hoverIndex: -1 };

const statusEl = document.getElementById("status");
const statusText = document.getElementById("status-text");
const unitButton = document.getElementById("unit-toggle");
const tooltip = document.getElementById("tooltip");
const chart = document.getElementById("chart");

function setStatus(kind, text) {
  statusEl.className = `status ${kind}`.trim();
  statusText.textContent = text;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function shownValue(key, value) {
  if (value == null || !Number.isFinite(value)) return null;
  if (state.imperial && SPECS[key].convert) return SPECS[key].convert(value);
  return value;
}

function shownUnit(key) {
  return state.imperial && SPECS[key].imperialUnit ? SPECS[key].imperialUnit : SPECS[key].unit;
}

function shownMin(key) {
  return state.imperial && SPECS[key].imperialMin != null ? SPECS[key].imperialMin : SPECS[key].min;
}

function shownMax(key) {
  return state.imperial && SPECS[key].imperialMax != null ? SPECS[key].imperialMax : SPECS[key].max;
}

function format(key, value) {
  const shown = shownValue(key, value);
  if (shown == null) return "--";
  return shown.toFixed(SPECS[key].digits);
}

function timeLabel(ts) {
  return new Date(ts).toLocaleTimeString("ko-KR", { hour12: false });
}

function setupDigits() {
  const host = document.getElementById("digits");
  for (const key of DIGITS) {
    const article = document.createElement("article");
    article.className = "card digit";
    article.innerHTML = `<div class="label">${SPECS[key].label}</div>
      <div><span class="value" id="d-${key}">--</span><span class="unit" id="u-${key}">${SPECS[key].unit}</span></div>`;
    host.appendChild(article);
  }
}

function updateText() {
  const values = state.latest?.values ?? {};
  for (const key of DIGITS) {
    document.getElementById(`d-${key}`).textContent = format(key, values[key]);
    document.getElementById(`u-${key}`).textContent = shownUnit(key);
  }
  const rows = Object.keys(SPECS).map((key) => {
    const value = format(key, values[key]);
    return `<tr><th scope="row">${SPECS[key].label}</th><td class="num">${value}</td>
      <td>${shownUnit(key)}</td><td>${state.lastTs ? timeLabel(state.lastTs) : "--"}</td></tr>`;
  });
  document.getElementById("table-body").innerHTML = rows.join("");
}

function drawGauge(key) {
  const canvas = document.getElementById(`gauge-${key}`);
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h * 0.62;
  const r = Math.min(w * 0.34, h * 0.4);
  const start = Math.PI * 0.75;
  const end = Math.PI * 2.25;

  ctx.lineCap = "round";
  ctx.strokeStyle = "#21262d";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, end);
  ctx.stroke();

  const value = state.latest?.values?.[key];
  const shown = shownValue(key, value);
  const min = shownMin(key);
  const max = shownMax(key);
  if (shown != null) {
    const pct = clamp((shown - min) / (max - min), 0, 1);
    ctx.strokeStyle = "#2f81f7";
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, start + (end - start) * pct);
    ctx.stroke();
  }

  ctx.strokeStyle = "#30363d";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const angle = start + ((end - start) * i) / 4;
    const inner = r + 6;
    const outer = r + 11;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    ctx.stroke();
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "#e6edf3";
  ctx.font = "700 24px system-ui, sans-serif";
  ctx.fillText(shown == null ? "--" : shown.toFixed(SPECS[key].digits), cx, cy - 2);
  ctx.fillStyle = "#8b949e";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText(shownUnit(key), cx, cy + 18);
  ctx.fillText(SPECS[key].label, cx, cy + 38);
}

function drawChart() {
  const rect = chart.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  chart.width = Math.round(rect.width * dpr);
  chart.height = Math.round(rect.height * dpr);
  const ctx = chart.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);

  const pad = { left: 44, right: 12, top: 10, bottom: 22 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const points = state.history;

  ctx.font = "11px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  for (let value = 0; value <= 7000; value += 2000) {
    const y = pad.top + plotH - (value / 7000) * plotH;
    ctx.strokeStyle = "#21262d";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = "#8b949e";
    ctx.textAlign = "right";
    ctx.fillText(value.toLocaleString(), pad.left - 8, y);
  }

  if (points.length === 0) {
    ctx.fillStyle = "#8b949e";
    ctx.textAlign = "center";
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText("데이터를 기다리는 중입니다", pad.left + plotW / 2, pad.top + plotH / 2);
    return;
  }

  const t0 = points[0].ts;
  const t1 = points[points.length - 1].ts;
  const span = Math.max(1, t1 - t0);
  const xOf = (ts) => pad.left + ((ts - t0) / span) * plotW;
  const yOf = (rpm) => pad.top + plotH - (clamp(rpm, 0, 7000) / 7000) * plotH;

  ctx.strokeStyle = "#2f81f7";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = xOf(point.ts);
    const y = yOf(point.rpm);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  const last = points[points.length - 1];
  ctx.fillStyle = "#2f81f7";
  ctx.strokeStyle = "#161b22";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(xOf(last.ts), yOf(last.rpm), 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#8b949e";
  ctx.textAlign = "left";
  ctx.fillText(timeLabel(t0), pad.left, h - 8);
  ctx.textAlign = "right";
  ctx.fillText(timeLabel(t1), w - pad.right, h - 8);

  if (state.hoverIndex >= 0 && points[state.hoverIndex]) {
    const point = points[state.hoverIndex];
    const x = xOf(point.ts);
    const y = yOf(point.rpm);
    ctx.strokeStyle = "#8b949e";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#e6edf3";
    ctx.strokeStyle = "#161b22";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function render() {
  updateText();
  for (const key of GAUGES) drawGauge(key);
  drawChart();
}

function applySample(sample) {
  if (!sample.ok) {
    setStatus("error", `오류: ${sample.error ?? "읽기 실패"}`);
    return;
  }
  state.latest = sample;
  state.lastTs = sample.ts;
  const rpm = sample.values.rpm;
  if (Number.isFinite(rpm)) {
    state.history.push({ ts: sample.ts, rpm });
    if (state.history.length > MAX_POINTS) state.history.shift();
  }
  setStatus("live", `실시간 · ${sample.roundTripMs ?? 0}ms`);
  render();
}

async function loadHistory() {
  try {
    const response = await fetch("/api/history?key=rpm&minutes=3", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    const merged = new Map();
    for (const row of data.rows) merged.set(row.ts, { ts: row.ts, rpm: row.value });
    for (const point of state.history) merged.set(point.ts, point);
    state.history = [...merged.values()].sort((a, b) => a.ts - b.ts).slice(-MAX_POINTS);
    drawChart();
  } catch {
    // 기록 API가 없어도 실시간 화면은 동작한다.
  }
}

unitButton.addEventListener("click", () => {
  state.imperial = !state.imperial;
  unitButton.textContent = state.imperial ? "단위: mph · °F" : "단위: km/h · °C";
  unitButton.setAttribute("aria-pressed", String(state.imperial));
  render();
});

chart.addEventListener("pointermove", (event) => {
  if (state.history.length === 0) return;
  const rect = chart.getBoundingClientRect();
  const pad = { left: 44, right: 12, top: 10, bottom: 22 };
  const plotW = rect.width - pad.left - pad.right;
  const plotH = rect.height - pad.top - pad.bottom;
  const t0 = state.history[0].ts;
  const t1 = state.history[state.history.length - 1].ts;
  const span = Math.max(1, t1 - t0);
  const target = t0 + (clamp(event.clientX - rect.left - pad.left, 0, plotW) / plotW) * span;
  let best = 0;
  let bestDelta = Infinity;
  state.history.forEach((point, index) => {
    const delta = Math.abs(point.ts - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = index;
    }
  });
  state.hoverIndex = best;
  const point = state.history[best];
  drawChart();
  tooltip.hidden = false;
  tooltip.textContent = `${timeLabel(point.ts)} · ${Math.round(point.rpm).toLocaleString()} rpm`;
  tooltip.style.left = `${pad.left + ((point.ts - t0) / span) * plotW}px`;
  tooltip.style.top = `${pad.top + plotH - (clamp(point.rpm, 0, 7000) / 7000) * plotH}px`;
});

chart.addEventListener("pointerleave", () => {
  state.hoverIndex = -1;
  tooltip.hidden = true;
  drawChart();
});

setInterval(() => {
  if (state.lastTs && Date.now() - state.lastTs > 3500) {
    setStatus("warn", "데이터 지연 · 재연결을 기다리는 중");
  }
}, 1000);

const events = new EventSource("/events");
events.onopen = () => setStatus("live", "연결됨");
events.onerror = () => setStatus("warn", "재연결 중…");
events.onmessage = (event) => {
  try {
    applySample(JSON.parse(event.data));
  } catch {
    setStatus("error", "이벤트 형식 오류");
  }
};

setupDigits();
render();
await loadHistory();
```

- `state.latest`는 서버가 보낸 마지막 `Sample`이다. 값이 없으면 `--`를 표시하고, 게이지는 배경 호만 그린다.
- 단위 변환은 **표시 계층에서만** 한다. 서버·DB는 항상 km/h와 °C로 저장한다. 그래야 나중에 단위를 바꿔도 저장값이 섞이지 않는다.
- `Number.isFinite`로 숫자가 아닌 값을 걸러 낸다. `0`은 유효한 값이므로 `value == null`로만 없는 값을 판정한다.
- 게이지는 `devicePixelRatio`를 곱해 캔버스 크기를 잡는다. 고해상도 화면에서 선이 흐려지지 않는다.
- 차트는 **회전수 한 계열**만 그린다. 축이 두 개인 차트(회전수+차속)는 피한다. 두 값을 함께 보려면 게이지나 작은 차트를 따로 둔다.
- `EventSource`는 연결이 끊기면 자동으로 재연결한다. `onerror`에서는 "재연결 중"만 표시하고, 직접 `new EventSource`를 만들지 않는다.
- 3.5초 동안 새 표본이 없으면 "데이터 지연"으로 표시한다. 서버가 살아 있어도 수집기가 멈췄을 수 있다.
- 표로 보기는 접근성 대체 수단이다. 색이나 게이지 각도만으로 값을 읽지 않아도 된다.
- `innerHTML`은 고정된 라벨과 숫자만 넣는다. 나중에 차량 이름·VIN 같은 외부 문자열을 넣는다면 `textContent`로 바꾸거나 이스케이프한다.

## 19.7 실차 없이 끝까지 돌리기

### 실행

```bash
# 터미널 1: ELM327-emulator (TCP, Toyota Auris Hybrid 시나리오)
python -m elm -n 35000 -s car

# 터미널 2: 대시보드
npm run typecheck
node src/main.ts --mode emulator --db :memory: --http 8787
```

브라우저에서 <http://127.0.0.1:8787>을 연다. `scenario car`는 쏘렌토가 아니라 Toyota Auris Hybrid의 응답을 흉내 낸다. PID 값과 지원 목록은 실제 차량과 다르다. **프로토콜·파싱·화면·저장 경로를 시험하는 용도**이지, 쏘렌토 값을 재현하는 도구가 아니다.

실행 결과(2026-10-29, Windows, Node 24.15, ELM327-emulator 4.0.0):

```text
대시보드: http://127.0.0.1:8787 (mode=emulator)
[obd] 연결됨 protocol=A6 battery=13.1V
```

```bash
curl -s http://127.0.0.1:8787/api/snapshot
```

```json
{"ts":1793226074899,"ok":true,"values":{"rpm":3788,"speed":68,"coolant":51,"throttle":44.7,"fuel":66.7,"voltage":14.67},"roundTripMs":3}
```

```bash
curl -s "http://127.0.0.1:8787/api/history?key=rpm&minutes=1"
```

```json
{"key":"rpm","minutes":1,"rows":[{"ts":1793226070891,"value":4209},{"ts":1793226071892,"value":3443}]}
```

SSE 스트림은 `curl -N`으로 확인한다.

```bash
curl -N http://127.0.0.1:8787/events
```

```text
retry: 3000

id: 0
data: {"ts":1793226074899,"ok":true,"values":{...},"roundTripMs":3}

id: 10
data: {"ts":1793226079944,"ok":true,"values":{...},"roundTripMs":3}

: ping
```

- `roundTripMs`가 3ms인 것은 emulator가 즉시 응답하기 때문이다. 실제 차량에서는 18.7절의 타임아웃·응답 시간이 더해져 수십~수백 ms가 된다.
- emulator의 PID 값은 요청마다 달라진다. 차트가 들쭉날쭉한 것은 정상이다.
- `scenario car`에서 `015C`(오일 온도)는 `NO DATA`다. 수집기는 빈 값으로 표본을 만들고 화면은 `--`를 보여 준다.

### 실제 차량

```bash
node src/main.ts --mode serial --port COM5 --baud 38400 --db obd.sqlite
```

- 정차·P·주차 브레이크를 확인한다. 주행 중에는 노트북을 조작하지 않는다.
- 포트 이름은 7장처럼 `SerialPort.list()`나 `python -m serial.tools.list_ports -v`로 찾는다. 재연결 후 COM 번호가 바뀔 수 있다.
- `--db :memory:`는 종료하면 데이터가 사라진다. 실제 기록은 파일 경로를 준다.
- 읽기 요청만 보낸다. 이 코드에는 DTC 삭제·쓰기·코딩이 없다.

### demo 모드

```bash
node src/main.ts --mode demo --db :memory: --http 8787
```

demo 모드는 ELM327을 열지 않고 `demoValues()`로 값을 만든다. 화면·SSE·SQLite·단위 변환을 차 없이 시험할 때 쓴다. **실제 요청 경로는 타지 않으므로**, 파서를 시험하려면 emulator 모드를 써야 한다.

## 19.8 재연결과 정상 종료

`src/main.ts`:

```typescript
import { parseArgs } from "node:util";
import { Collector, type Sample } from "./collector.ts";
import { Elm327Client, initializeElm } from "./elm327.ts";
import { createDashboardServer } from "./server.ts";
import { SampleStore } from "./store.ts";
import { SerialTransport, TcpTransport, type Transport } from "./transport.ts";

const { values: args } = parseArgs({
  options: {
    mode: { type: "string", default: "demo" }, // demo | emulator | serial
    port: { type: "string" },
    baud: { type: "string", default: "38400" },
    tcp: { type: "string", default: "127.0.0.1:35000" },
    db: { type: "string", default: "obd.sqlite" },
    http: { type: "string", default: "8787" },
    host: { type: "string", default: "127.0.0.1" },
    interval: { type: "string", default: "1000" },
  },
});

const mode = args.mode ?? "demo";
const intervalMs = Number(args.interval);
const store = new SampleStore(args.db ?? "obd.sqlite");

let latest: Sample | null = null;
let lastError = "";

const dashboard = createDashboardServer({
  getLatest: () => latest,
  history: (key, since, limit) => store.history(key, since, limit),
});

function onSample(sample: Sample): void {
  latest = sample;
  store.add(sample);
  dashboard.broadcast(sample);
  if (!sample.ok && sample.error && sample.error !== lastError) {
    lastError = sample.error;
    console.error(`[obd] ${sample.error}`);
  }
  if (sample.ok) lastError = "";
}

await dashboard.listen(Number(args.http), args.host ?? "127.0.0.1");
console.log(`대시보드: http://${args.host}:${args.http} (mode=${mode})`);

const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

if (mode === "demo") {
  const collector = new Collector(null, onSample, { intervalMs });
  collector.start();
  await new Promise<void>((resolve) => {
    controller.signal.addEventListener("abort", () => resolve(), { once: true });
  });
  collector.stop();
} else {
  await runDevice(mode, controller.signal);
}

await dashboard.close();
store.close();
console.log("[obd] 종료");

async function runDevice(deviceMode: string, signal: AbortSignal): Promise<void> {
  let backoff = 1000;
  while (!signal.aborted) {
    let transport: Transport | undefined;
    let client: Elm327Client | undefined;
    try {
      transport = await openTransport(deviceMode);
      client = new Elm327Client(transport);
      const info = await initializeElm(client);
      console.log(`[obd] 연결됨 protocol=${info.protocol} battery=${info.battery}`);
      backoff = 1000;
      await new Promise<void>((resolve) => {
        const collector = new Collector(client ?? null, onSample, {
          intervalMs,
          onFatal: (error) => {
            console.error(`[obd] 수집 중단: ${error.message}`);
            resolve();
          },
        });
        const onAbort = () => {
          collector.stop();
          resolve();
        };
        signal.addEventListener("abort", onAbort, { once: true });
        transport?.onClose(() => {
          collector.stop();
          resolve();
        });
        collector.start();
      });
    } catch (error) {
      console.error(`[obd] 세션 실패: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await client?.close().catch(() => {});
      await transport?.close().catch(() => {});
    }
    if (signal.aborted) return;
    const wait = Math.round(backoff * (0.8 + Math.random() * 0.4));
    console.log(`[obd] ${wait}ms 뒤 재연결`);
    await new Promise((resolve) => setTimeout(resolve, wait));
    backoff = Math.min(backoff * 2, 30_000);
  }
}

async function openTransport(deviceMode: string): Promise<Transport> {
  if (deviceMode === "emulator") {
    const [host, portText] = (args.tcp ?? "127.0.0.1:35000").split(":");
    const port = Number(portText);
    if (!host || !Number.isInteger(port)) throw new Error("--tcp는 host:port 형식입니다");
    return TcpTransport.open(host, port);
  }
  if (deviceMode === "serial") {
    if (!args.port) throw new Error("시리얼 모드에는 --port COM5 형식이 필요합니다");
    return SerialTransport.open(args.port, Number(args.baud));
  }
  throw new Error(`알 수 없는 mode: ${deviceMode}`);
}
```

### 세션 상태 기계

```text
idle → connecting → initializing → streaming
                    │                 │
                    └─ error ─────────┴─ timeout/close/3회 오류
                              │
                              ▼
                           backoff → connecting
```

- **connecting**: `SerialTransport.open` 또는 `TcpTransport.open`.
- **initializing**: `ATZ`·`ATE0`·`ATL0`·`ATSP0`·`ATDPN`·`ATRV`. 실패하면 세션을 버리고 백오프한다.
- **streaming**: `Collector`가 PID를 읽는다. `onFatal`이나 전송 계층 `close`가 오면 streaming을 끝낸다.
- **backoff**: 1초에서 시작해 2배씩, 최대 30초. 0.8~1.2배 지터를 준다. 여러 대시보드가 동시에 재연결해도 같은 순간에 몰리지 않게 한다.
- **정상 종료**: `SIGINT`/`SIGTERM` → `AbortController` → 수집기 중지 → 세션 루프 종료 → HTTP 서버 닫기 → `store.close()`(남은 배치 flush) → 전송 계층 닫기.

### 재연결에서 구분할 것

| 상황 | 재연결? | 이유 |
|---|---|---|
| `NO DATA` | 아니오 | 미지원 PID·시동 상태. 통신은 살아 있다 |
| `SEARCHING...` 뒤 정상 응답 | 아니오 | 프로토콜 검색 중 |
| 호스트 타임아웃 | 예 | 늦은 응답이 다음 명령과 섞일 수 있다 |
| 전송 계층 `close`/`error` | 예 | USB 끊김, 어댑터 전원, TCP 종료 |
| `UNABLE TO CONNECT` 3회 | 예 | 차량 프로토콜·점화 상태·어댑터 문제 |
| `BUFFER FULL` 3회 | 예 | 어댑터가 따라가지 못함. `AT MA`를 쓰지 않는지 확인 |

- USB가 뽑혔다 다시 꽂히면 COM 번호가 바뀔 수 있다(7장 실차 사례). 경로를 하드코딩했다면 재연결이 실패한다. 운영에서는 VID/PID·설명으로 포트를 찾는 로직을 추가한다.
- 재연결 직후에는 `ATZ`로 어댑터를 초기화한다. 이전 세션의 프로토콜·필터·타이밍 설정이 남아 있을 수 있다.
- 백오프 중에도 HTTP 서버와 SSE는 살아 있다. 브라우저는 "재연결 중"을 표시하고, 마지막 값을 유지한다.
- `store.add`는 `ok=false` 표본을 저장하지 않는다. 오류 구간은 데이터 구멍으로 남는다. 필요하면 별도 `events` 테이블에 오류를 기록한다.

## 19.9 테스트

16장의 전략을 그대로 적용한다. 하드웨어 없이 파서·저장소를 시험하고, 마지막에 emulator로 통합 시험한다.

### 가짜 전송 계층

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { Elm327Client } from "../src/elm327.ts";
import type { DataHandler, Transport } from "../src/transport.ts";

class ScriptedTransport implements Transport {
  readonly kind = "test" as const;
  readonly sent: string[] = [];
  private dataHandler: DataHandler | undefined;

  write(text: string): Promise<void> {
    this.sent.push(text);
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  onData(handler: DataHandler): void {
    this.dataHandler = handler;
  }
  onClose(): void {}
  emit(text: string): void {
    this.dataHandler?.(Buffer.from(text, "latin1"));
  }
}

test("청크가 쪼개져도 프롬프트에서 한 번만 완료한다", async () => {
  const transport = new ScriptedTransport();
  const client = new Elm327Client(transport, { defaultTimeoutMs: 1000 });
  const pending = client.command("010C");
  while (transport.sent.length === 0) await new Promise((resolve) => setImmediate(resolve));
  transport.emit("41 0C 1A");
  transport.emit(" F8\r\r>");
  assert.deepEqual(await pending, { kind: "ok", lines: ["41 0C 1A F8"] });
  await client.close();
});
```

- 실제 시간을 기다리지 않고 `setImmediate`로 명령이 나간 뒤 데이터를 넣는다.
- `NO DATA`, `SEARCHING...`, 명령 직렬화, 타임아웃도 같은 방식으로 시험한다.
- `SerialPortMock`을 쓰면 `serialport` 경로도 시험할 수 있다. 18장의 `SerialTransport.open(path, baud, createPort)` 세 번째 인자에 mock 생성기를 넣는다.

### 저장소 테스트

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { SampleStore } from "../src/store.ts";

test("표본을 배치로 저장하고 시계열로 조회한다", () => {
  const store = new SampleStore(":memory:", { batchSize: 2, retentionMs: 0 });
  const base = Date.now() - 1000;
  for (let i = 0; i < 3; i += 1) {
    store.add({
      ts: base + i * 100,
      ok: true,
      values: { rpm: 1000 + i, coolant: 80 },
      roundTripMs: 20,
    });
  }
  store.flush();
  assert.deepEqual(store.history("rpm", base - 1).map((row) => row.value), [1000, 1001, 1002]);
  store.close();
});
```

### 통합 테스트

```bash
python -m elm -n 35000 -s car
node src/cli.ts --mode emulator   # 18장 CLI
node src/main.ts --mode emulator --db :memory: --http 8787
curl -s http://127.0.0.1:8787/api/snapshot
```

- CI에는 emulator 의존 테스트를 넣지 않는다. 대신 `ScriptedTransport`·`:memory:` SQLite 테스트를 돌린다.
- emulator 통합 테스트는 릴리스 전 수동 체크리스트에 둔다.
- 브라우저는 Playwright 같은 도구로 "값이 3초 안에 갱신되는가", "단위 토글이 되는가", "SSE가 끊겼다 다시 붙는가"를 확인할 수 있다. 이 책의 예제는 Playwright로 게이지·차트·툴팁·단위 토글까지 확인했다.

## 19.10 운영 체크리스트

- [ ] `--host 127.0.0.1`로 로컬에만 바인딩했는가
- [ ] 원격 접속이 필요하면 TLS·인증·IP 제한을 둔 리버스 프록시 뒤에 두었는가
- [ ] CORS를 열지 않았는가
- [ ] `/api/history`의 `key`·`minutes`를 검증했는가
- [ ] VIN·GPS·주행 경로를 저장·로그·화면에 남기지 않았는가
- [ ] DB 보존 기간과 디스크 여유를 확인했는가
- [ ] `SIGINT`/`SIGTERM`에서 배치를 flush하고 포트를 닫는가
- [ ] 재연결 백오프에 상한과 지터가 있는가
- [ ] `roundTripMs`·마지막 표본 시각·재연결 횟수를 관측하는가
- [ ] 차량 배터리를 오래 소모하지 않도록 실습 후 어댑터를 뽑는가
- [ ] 실제 차량에서는 읽기만 하는가

### 관측

대시보드 자체가 관측 대상이다. 다음을 `/api/health`로 노출하면 장애를 빨리 찾는다.

```json
{
  "ok": true,
  "lastSampleAgeMs": 820,
  "roundTripMs": 210,
  "reconnects": 2,
  "lastError": null,
  "dbRows": 18342
}
```

- `lastSampleAgeMs`가 3초를 넘으면 수집기·어댑터·차량 점화 상태를 본다.
- `roundTripMs`가 갑자기 커지면 버스 부하·ECU 응답·`AT ST`를 본다.
- `reconnects`가 계속 늘면 USB 전원·케이블·포트 이름을 본다.
- `dbRows`가 보존 기간보다 빠르게 늘면 폴링 주기·행 수를 계산한다.

## 19.11 흔한 실수

| 증상 | 원인 | 해결 |
|---|---|---|
| 요청이 겹쳐 응답이 섞인다 | `setInterval`로 폴링 | 완료 후 대기 루프 |
| SSE 연결이 끊긴다 | 프록시 버퍼링, 긴 유휴 | `no-transform`, `X-Accel-Buffering: no`, 하트비트 |
| 브라우저 메모리가 는다 | 느린 클라이언트에 모두 큐잉 | `write()===false`면 드롭, `drain`까지 대기 |
| SQLite 파일이 커진다 | 보존 정책 없음 | `trim()`, 보존 기간, 인덱스 확인 |
| 재연결 폭풍 | 백오프 없음 | 지수 백오프 + 지터 + 상한 |
| `NO DATA`에서 재연결 | 오류 분류 실패 | `no-data`와 `error` 분리 |
| 값이 0으로 보인다 | 없는 값을 0으로 채움 | `undefined`는 `--`, 0은 유효값 |
| 단위가 섞인다 | 저장 단위와 표시 단위 혼용 | 저장은 km/h·°C, 표시에서 변환 |
| 화면이 멈췄는데 "실시간" | 마지막 표본 시각을 안 봄 | 3.5초 지연 표시 |
| 원격에서 인증 없이 열린다 | `0.0.0.0` 바인딩 | 로컬 바인딩, 리버스 프록시 인증 |
| 종료 시 데이터가 사라진다 | 배치 flush 누락 | `SIGINT`에서 `store.close()` |
| VIN이 로그에 남는다 | 원시 응답을 그대로 저장 | PID 값만 저장, VIN 제외 |

## 장 요약

- 수집기·저장소·서버·표현을 분리하면 하드웨어 없이 각 계층을 시험할 수 있다.
- `setInterval` 대신 완료 후 대기하는 루프를 써서 ELM327 요청이 겹치지 않게 한다.
- 첫 PID 요청은 `SEARCHING...` 때문에 12초, 이후에는 1.5초 타임아웃을 준다.
- SQLite에는 PID 표본만 배치로 저장하고, 2초 또는 120행마다 커밋한다. 보존 기간을 둔다.
- SSE는 단방향 텔레메트리에 충분하다. `retry`, `id`, 하트비트, `no-transform`을 설정한다.
- `res.write()`가 `false`면 느린 클라이언트에 보내지 않고 `drain`까지 기다린다. 최신값만 남긴다.
- 브라우저는 최신 표본을 게이지·차트로 그리고, 3.5초 지연을 표시한다.
- 단위 변환은 표시 계층에서만 한다. 저장은 항상 km/h·°C다.
- 재연결은 지수 백오프+지터로 하고, `NO DATA`는 재연결 사유가 아니다.
- ELM327-emulator TCP로 차 없이 수집·저장·SSE·화면까지 검증할 수 있다.
- 기본 바인딩은 `127.0.0.1`이다. 인증 없는 대시보드를 네트워크에 열지 않는다.
- 실제 차량에서는 정차 상태에서 읽기만 한다.

여기까지 하면 "웹 개발자의 스택으로 차량 데이터를 읽어 화면까지 만드는" 한 바퀴가 끝난다. 다음 장은 지금까지의 장을 어떤 순서로 다시 읽고, 무엇을 더 만들어 볼지 정리한다.

## 연습 문제

### 1. 백프레셔

SSE 클라이언트 하나가 느려서 `res.write()`가 `false`를 돌려주었다.

1. 이 클라이언트에 다음 표본을 계속 보내면 어떤 일이 생기는가?
2. 이 구현은 왜 표본을 큐에 쌓지 않고 건너뛰는가?
3. `drain` 이벤트가 오면 무엇을 해야 하는가?
4. "모든 표본을 정확히 한 번씩" 보내야 하는 요구가 생기면 설계를 어떻게 바꿔야 하는가?

### 2. 폴링 주기

PID 6개를 1Hz로 읽는다. ELM327의 `AT ST`는 기본값(약 200ms)이고, 응답 후 대기 시간도 200ms다. ECU 응답은 50ms다.

1. 한 번의 다중 PID 요청에 걸리는 최악 시간을 대략 계산하라.
2. 1Hz 수집에서 어댑터가 노는 시간 비율은 얼마인가?
3. 10Hz로 올리면 어떤 문제가 생기는가?
4. 10Hz를 유지하려면 어떤 방법을 검토해야 하는가?

### 3. SQLite 쿼리

`samples(ts, key, value, unit)` 테이블에서 최근 5분간 `rpm` 값을 시간 오름차순으로 1000개까지 읽는 SQL을 쓰라. 인덱스도 제안하라.

### 4. 재연결 판단

다음 상황에서 재연결해야 하는가?

1. `015C`에 `NO DATA`가 왔다.
2. `0100` 요청이 1.5초 안에 응답하지 않았다.
3. `UNABLE TO CONNECT`가 세 번 연속 왔다.
4. 브라우저 탭을 닫아 SSE 연결이 끊겼다.
5. USB 어댑터가 뽑혔다.

### 5. 보안

대시보드를 `--host 0.0.0.0 --http 8787`로 실행했다. 같은 공유기에 연결된 누구나 접속할 수 있다.

1. 어떤 정보가 노출되는가?
2. 인증을 넣지 않으면 어떤 공격이 가능한가?
3. 최소한의 수정으로 위험을 줄이려면 무엇을 해야 하는가?
4. 원격 모니터링이 정말 필요하다면 어떤 구조를 써야 하는가?

## 정답과 해설

### 1.

1. `res.write()`가 돌려준 데이터가 Node의 응답 버퍼에 쌓인다. 클라이언트가 읽지 않으면 버퍼가 커지고 메모리 사용량이 늘어난다. 결국 프로세스가 느려지거나 죽는다.
2. 이 대시보드는 "가장 최근 값"이 중요하다. 중간 표본을 모두 보내도 화면은 마지막 값만 의미 있다. 큐에 쌓으면 지연과 메모리만 늘어난다.
3. `slow=false`로 되돌려 다음 표본부터 다시 보낸다. 필요하면 마지막 최신값을 한 번 보내 클라이언트를 따라잡게 한다.
4. 클라이언트별 큐와 ACK, 또는 `Last-Event-ID` 기반 재전송이 필요하다. SSE보다 WebSocket이나 메시지 큐가 적합할 수 있다. 이때도 큐 상한·드롭 정책을 정해야 한다.

### 2.

1. 요청 전송 + ECU 50ms + 응답 후 대기 200ms ≈ 250ms. 여기에 직렬 전송·처리 시간이 더해진다.
2. 250ms/1000ms = 25%. 어댑터는 75% 논다.
3. 10Hz는 100ms 주기인데 한 요청이 250ms 걸리므로, 완료 후 대기 루프에서는 실제 주기가 250ms(4Hz)로 떨어진다. `setInterval`로 억지로 10Hz를 만들면 요청이 겹쳐 응답이 섞인다.
4. 다중 PID(이미 6개), 응답 수 digit, `AT ST` 조정, 적응형 타이밍 확인, 필요하면 ECU 물리 주소로 응답 수를 1개로 고정. 그래도 차량 응답 시간이 하한이다.

### 3.

```sql
SELECT ts, value FROM (
  SELECT ts, value FROM samples
  WHERE key = 'rpm' AND ts >= ?
  ORDER BY ts DESC
  LIMIT 1000
) ORDER BY ts ASC;
```

```sql
CREATE INDEX IF NOT EXISTS samples_key_ts ON samples (key, ts);
```

`key`와 `ts`를 함께 인덱싱해야 `WHERE key=? AND ts>=?`가 인덱스를 탄다. `value`까지 인덱스에 넣으면 covering index가 되지만, 쓰기 비용이 늘어난다.

### 4.

1. 아니오. 미지원 PID 또는 시동 상태 문제다. 통신은 살아 있다.
2. 예. 호스트 타임아웃은 늦은 응답이 다음 명령과 섞일 수 있다. 연결을 닫고 재연결한다.
3. 예. 차량 프로토콜·점화 상태·어댑터 문제다. 백오프 후 재시도한다.
4. 아니오. 수집기·어댑터와 무관하다. SSE 클라이언트만 정리된다.
5. 예. 전송 계층 `close`/`error`가 오고, 재연결 루프가 포트를 다시 연다. COM 번호가 바뀌면 포트 탐색이 필요하다.

### 5.

1. 실시간 PID 값, 최근 시계열, 차량이 움직이는지(=집에 있는지), 오류 메시지, 서버 구조가 노출된다. VIN을 저장하지 않아도 주행 패턴으로 개인을 추정할 수 있다.
2. 인증이 없으면 누구나 `/api/history`로 과거 데이터를 읽고, SSE 연결을 많이 열어 자원을 고갈시킬 수 있다. 쓰기 API는 없지만, 서비스 거부·정보 수집은 가능하다.
3. `--host 127.0.0.1`로 되돌리고, 원격 접속이 필요하면 SSH 터널·VPN을 쓴다. 최소한 리버스 프록시에서 인증·TLS·IP 제한을 건다.
4. 리버스 프록시(TLS·인증) + 사설망/VPN, 대시보드는 `127.0.0.1`에 두고 프록시만 노출한다. 공개 인터넷에 직접 열지 않는다.
