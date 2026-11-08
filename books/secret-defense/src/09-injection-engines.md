# 제9장: 2대 주입 엔진 (환경변수 vs RAM 가상 파일)

### 9.1 문자열 시크릿 주입 엔진 (String Injection)

- **대상**: `GITHUB_TOKEN`, `DEEPSEEK_API_KEY`, `QWEN_API_KEY`, `SLACK_BOT_TOKEN`
- **주입 방식**:
  - `fork()` 직후, `execve()` 호출 전 자식 프로세스의 `environ` 딕셔너리에만 키를 추가.
  - 부모 프로세스나 에이전트의 셸 환경변수에는 전혀 영향을 주지 않음.
- **프로세스 소멸성**: 프로세스가 종료되면 해당 메모리 공간은 OS에 의해 완전히 회수됨.

---

### 9.2 인증서 및 파일 자격증명 엔진 (In-Memory Virtual File)

- **대상**: GCP 서비스 계정 키(`GOOGLE_APPLICATION_CREDENTIALS`), Cloudflare DNS 키(`cloudflare.ini`), mTLS 키.
- **주입 절차**:
  1. `secret-vaultd`가 Keyring에서 복호화된 JSON/Cert 데이터를 취득.
  2. 디스크(SSD/HDD)가 아닌 **RAM 기반 임시 파일시스템(`/dev/shm/secret-vault/<UUID>.tmp`)**에 파일 생성.
  3. `chmod 0600`을 적용하여 파일 생성자(데몬 UID) 외의 다른 계정 및 그룹의 읽기 차단.
  4. 자식 프로세스 환경변수에 경로 주입:
     ```bash
     GOOGLE_APPLICATION_CREDENTIALS=/dev/shm/secret-vault/a7b8c9.json
     ```
  5. `waitpid()`로 자식 프로세스 종료 감지 즉시 `os.unlink()` 및 덮어쓰기 파기.
