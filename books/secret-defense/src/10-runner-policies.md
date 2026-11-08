# 제10장: 러너(`secret-run`) 방어 정책 및 커널 신원 검증

### 10.1 커널 레벨 신원 검증 (`SO_PEERCRED`)

일반 TCP 포트는 IP와 포트만 보이지만, Unix Domain Socket(UDS)은 커널이 통신 상대의 구조체(`struct ucred`)를 직접 보증한다:

```c
struct ucred {
    pid_t pid; /* 요청 프로세스의 PID */
    uid_t uid; /* 요청 프로세스의 실제 UID */
    gid_t gid; /* 요청 프로세스의 실제 GID */
};
```

클라이언트는 어떤 방식으로도 자신의 PID를 위조할 수 없다.

---

### 10.2 러너 화이트리스트 정책 (RCE 방어)

에이전트가 환경변수나 RAM 가상 파일을 빼돌리기 위해 러너를 호출하려 할 때 적용되는 엄격한 룰셋:

| 요청 형태 | 데몬의 판정 | 이유 |
| :--- | :---: | :--- |
| `secret-run gh pr create` | ✅ **허용** | 시스템 바이너리(`/usr/bin/gh`)는 기계어라 변조 불가 |
| `secret-run litestream replicate` | ✅ **허용** | 시스템 바이너리(`/usr/local/bin/litestream`) |
| `secret-run python ~/.claude/bin/ds-loop.py` | ✅ **허용** | 등록된 공식 스크립트 경로 |
| `secret-run python -c "print(os.environ)"` | ❌ **차단** | 임의 인라인 코드 실행 시도 (RCE) |
| `secret-run bash -c "env > /tmp/leak.txt"` | ❌ **차단** | 셸 인터프리터 직접 실행 시도 |
| `secret-run python /tmp/evil.py` | ❌ **차단** | 승인되지 않은 임의 경로 스크립트 |
