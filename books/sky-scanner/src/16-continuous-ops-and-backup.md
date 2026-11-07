# 16장 상시 가동의 기술: 사라진 워크스페이스와 클라우드로 띄운 DB

## 16.1 사라진 작업실의 유령

서버로 이사하고 얼마 지나지 않아 사용자가 물었다.

> **"스카이 스캐너 서버 실행중이야?"**

터미널을 열어 확인했다. 프로세스(PID 4860)는 살아 있었고 포트 8090도 열려 있었다. 하지만 웹 화면(`http://127.0.0.1:8090`)을 부르자 500 Internal Server Error가 떨어졌다. CPU 사용률은 117%까지 치솟아 팬이 돌고 있었다.

로그를 열어보고 나서야 상황이 드러났다.

```
FileNotFoundError: [Errno 2] No such file or directory: 'data/recordings'
FileNotFoundError: [Errno 2] No such file or directory: 'data'
ERROR skyscanner.aircraft.tracker: 비행기 목록 조회 중 예상하지 못한 오류
FileNotFoundError: [Errno 2] No such file or directory
```

녹음 파일을 저장하려 해도 폴더가 없고, 웹 UI 템플릿을 읽으려 해도 파일이 없고, 비행기 추적기가 SSL 인증서를 읽으려 해도 경로가 없었다. 모든 파일 접근이 `FileNotFoundError`를 내며 1초에 수십 번씩 예외 루프를 돌고 있었다.

프로세스의 현재 작업 디렉토리(`/proc/4860/cwd`)를 확인했다.

```
/proc/4860/cwd -> '/home/golony/orca/workspaces/sky-scanner/hydra (deleted)'
```

경로 끝에 붙은 `(deleted)` 한 단어가 범인이었다.

오르카(Orca)의 서브에이전트가 새 기능(GOL-153)을 구현하고 시험하기 위해 임시 워크트리(`hydra`)에서 서버를 띄웠었다. 작업이 끝나고 PR이 머지되자 워크트리 폴더는 깔끔하게 삭제되었다. 하지만 그 안에서 띄워 둔 프로세스는 죽지 않고 살아남았다. 발밑의 땅이 통째로 꺼졌는데도 허공에 붕 뜬 채 "녹음 파일을 디스크에 써라", "웹 템플릿을 읽어라"라는 명령을 계속 수행하려다 에러 루프에 빠진 것이다.

사용자는 즉시 원칙을 세웠다.

> **"응. 그리고 항상 워크트리 말고 메인에서 프로세스를 띄우도록 해줘"**

서브에이전트나 워크트리는 언제든 생겼다 사라지는 "임시 작업실"이다. 반면 SDR 동글 하드웨어를 독점하고 포트 8090을 여는 서버 데몬은 영구적인 상시 프로세스여야 한다. 워크트리 안에서 서버를 띄우면 작업실이 정리될 때마다 프로세스가 고아가 된다.

프로세스를 종료하고, 프로젝트 지침 문서(`CLAUDE.md`, `GEMINI.md`)에 프로세스 실행 원칙을 못 박았다. 하드웨어와 포트를 쓰는 서비스는 오직 영구적인 메인 저장소 디렉토리에서만 띄운다.

> **알게 된 점** — 워크트리의 수명과 프로세스의 수명을 일치시키면 안 된다. 작업실을 청소할 때 그 안에서 돌던 장비까지 함께 버려지지 않으려면, 상시 데몬은 반드시 메인 디렉토리의 자리를 지켜야 한다.

---

## 16.2 동글이 빠져도 서버는 멈추지 않는다

고아 프로세스를 정리하고 메인 저장소에서 서버를 다시 띄우려던 참에 사용자가 한마디를 덧붙였다.

> **"아 서비스는 다시 켜줘. 대신 동글은 빼놨어."**

하드웨어 수신기에 동글이 꽂혀 있지 않은 상태. 보통의 프로그램이라면 시작하자마자 "동글 없음" 오류를 뿜고 비정상 종료(exit 1)했을 것이다.

하지만 sky-scanner의 수신 엔진은 그렇게 설계되지 않았다.

동글 열기를 시도하다 `SourceUnavailable` 예외를 만나면, 프로세스를 죽이는 대신 수신기 상태를 `no_dongle`로 바꾸고 조용히 대기한다. 동글이 없어도 FastAPI 웹 서버(8090)는 정상 가동되고, `adsb.lol`을 통한 실시간 항공기 추적 궤적도 웹 화면에 그대로 흐른다. 이전에 녹음해 둔 WAV 파일의 재생과 백그라운드 STT 처리도 멈추지 않는다.

터미널에서 상태를 조회하자 설계대로 응답했다.

```json
{"mode":"airband","state":"no_dongle","channels":[...]}
```

동글을 빼놓아도 웹과 비행기 지도는 살아 있고, 나중에 사용자가 동글을 USB 포트에 다시 꽂으면 수신기 스레드가 하드웨어를 스스로 감지해 교신 수신을 재개한다.

> **알게 된 점** — 단단한 시스템은 주변 장비 하나가 없다고 시스템 전체를 포기하지 않는다. "할 수 없는 일(무전 수신)"은 대기 상태로 두고 "할 수 있는 일(웹 서빙, 비행기 추적)"을 계속하는 것이 결함 내성(Fault Tolerance)의 기본이다.

---

## 16.3 하늘로 쏘아 올린 SQLite: Litestream

수신기가 돌면서 쌓이는 데이터는 크게 두 가지다. 음성 WAV 파일(`data/recordings/`)과 모든 교신 메타데이터·자막·항공기 스냅샷이 기록되는 SQLite DB(`data/skyscanner.db`)다.

SQLite는 서버리스(Serverless) 파일 기반 데이터베이스라 설정도 필요 없고 가볍다. 하지만 단점이 명확하다. 단 하나의 파일에 모든 데이터가 들어있기 때문에, 디스크가 깨지거나 실수로 파일이 지워지면 복구할 길이 없다. 앞서 워크트리가 지워졌을 때도 메모리 상의 파일 디스크립터가 간신히 잡고 있지 않았다면 지금까지 모은 교신 데이터가 영영 사라질 뻔했다.

상시 서버로 가려면 실시간 백업이 필수였다. 사용자가 백업 스토리지를 정했다.

> **"구글 클라우드 스토리지 쓸꺼야. cli 설치해놨고, golony-database에 sky-scanner 만들고 거기에 저장하는거로 하자"**

선택한 도구는 **Litestream**이었다.

보통 DB 백업이라고 하면 cron을 돌려 몇 시간마다 통째로 파일을 복사하거나 dump를 뜬다. 하지만 그 방식은 덤프와 덤프 사이의 데이터 유실을 막지 못하고, DB 파일이 커질수록 I/O 부하를 준다.

Litestream은 전혀 다른 방식으로 일한다. SQLite의 WAL(Write-Ahead Logging) 파일에 트랜잭션이 기록되는 순간을 실시간으로 지켜보다가, 새로 쓰인 바이트(LTX 프레임)만 오브젝트 스토리지로 1초마다 스트리밍 복제한다. CPU와 네트워크를 거의 쓰지 않으면서도, 언제 어떤 사고가 나더라도 1초 전 상태까지 정확하게 복원할 수 있다.

---

## 16.4 비밀번호 없이 잇는 신뢰: ADC

Litestream을 설치(`~/.local/bin/litestream`)하고 구글 클라우드 스토리지(GCS) 버킷 `gs://golony-database/sky-scanner`로 복제하도록 설정을 잡았다.

```yaml
# ~/.config/litestream/config.yml
dbs:
  - path: /home/golony/dev/repo/sky-scanner/sky-scanner/data/skyscanner.db
    replicas:
      - url: gs://golony-database/sky-scanner
        sync-interval: 1s
```

여기서 가장 중요한 문제는 **인증(Authentication)**이었다.

클라우드 스토리지에 접속하려면 보통 서비스 계정 키(JSON)를 발급받아 환경변수나 파일 경로로 넘긴다. 하지만 서버에 정적 비밀 키 파일을 남겨두는 것은 관리 부담이자 보안 위험이다.

다행히 서버에는 이미 Google Cloud SDK(`gcloud`)가 설치되어 있었고, 사용자가 `gcloud auth application-default`로 로그인을 마쳐 둔 상태였다. Go 언어로 작성된 Litestream은 구글의 공식 클라우드 라이브러리를 사용하기 때문에, 설정 파일에 비밀번호나 키 경로를 일절 적지 않아도 시스템의 **ADC(Application Default Credentials)** 체인을 자동으로 타고 올라가 인증을 해결한다.

설정 파일에 비밀번호가 없으니 설정이 유출될 걱정도 없고, 키를 갱신하느라 서비스를 멈출 필요도 없다.

`systemctl --user enable --now litestream.service`로 서비스를 올리자마자 저널 로그에 첫 기록이 찍혔다.

```
level=INFO msg="syncing database" path=.../data/skyscanner.db
level=INFO msg="compaction complete" system=store db=skyscanner.db level=1
level=INFO msg="snapshot complete" system=store db=skyscanner.db txid=0000000000000001
```

GCS 버킷을 조회하자 `gs://golony-database/sky-scanner/ltx/` 아래에 압축된 트랜잭션 파일들이 실시간으로 올라가고 있었다.

SQLite의 가벼움과 클라우드의 무한한 영속성. 수신기가 땅에서 무전을 받아 DB에 적는 족족, Litestream이 1초 만에 그 기록을 구글 클라우드의 안전한 하늘 위로 쏘아 올린다.

> **알게 된 점** — 백업은 하루에 한 번 큰 짐을 나르는 게 아니라, 변경이 생길 때마다 깃털처럼 가볍게 흘려보내는 것이다. 도구의 특성(SQLite WAL)과 인프라(오브젝트 스토리지)가 맞아떨어질 때 가장 단순하면서도 견고한 운영 환경이 완성된다.
