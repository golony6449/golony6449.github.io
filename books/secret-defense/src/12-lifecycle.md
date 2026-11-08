# 제12장: 미래를 위한 확장: 키 라이프사이클 관리 (`secret-vault`)

앞으로 CLI 도구, LLM API, 서드파티 서비스가 계속 늘어날 때, 에이전트가 시크릿 값을 보지 않으면서도 시스템에 안전하게 키를 등록·갱신·관리하는 **사용자 전용 관리자 인터페이스**를 정의한다.

---

### 12.1 관리자 대화형 CLI

인간 개발자가 터미널에서 직접 키를 다루는 전용 CLI (`secret-vault`):

```bash
# 1. 등록된 키 목록 확인 (키 이름만 출력, 실제 비밀값은 마스킹)
$ secret-vault list
  - DEEPSEEK_API_KEY (string, registered)
  - QWEN_API_KEY (string, registered)
  - GCP_SERVICE_ACCOUNT (file:json, registered)

# 2. 문자열 시크릿 대화형 등록 (입력값 화면 마스킹)
$ secret-vault set LINEAR_API_KEY
  Input Key Value: ********************************
  [SUCCESS] 'LINEAR_API_KEY' encrypted and saved to OS Keyring.

# 3. 인증서/JSON 파일 등록 (파일 내용을 Keyring에 암호화 적재)
$ secret-vault set-file GCP_SERVICE_ACCOUNT ~/Downloads/service-account.json
  [SUCCESS] 'GCP_SERVICE_ACCOUNT' registered to Keyring. 
  [TIP] Original file in Downloads can be safely deleted.

# 4. 키 삭제 및 회전(Rotation)
$ secret-vault delete OLD_KEY
```

---

### 12.2 시크릿 메타데이터 매니페스트 (`secrets-manifest.yaml`)

에이전트가 어떤 키가 필요한지, 발급 링크가 어디인지 스스로 학습할 수 있도록 제공하는 공개 선언서 (비밀값 없음):

```yaml
# ~/.claude/config/secrets-manifest.yaml
secrets:
  DEEPSEEK_API_KEY:
    type: string
    env_name: DEEPSEEK_API_KEY
    description: "DeepSeek Coder / Chat API 인증 키"
    provider_url: "https://platform.deepseek.com/api_keys"
    used_by: ["ds-run.py", "ds-loop.py", "claude-ds.py"]

  QWEN_API_KEY:
    type: string
    env_name: DASHSCOPE_API_KEY
    description: "Qwen DashScope API 키 (코드 리뷰용)"
    provider_url: "https://dashscope.console.aliyun.com/apiKey"
    used_by: ["qwen-review.py", "qwen-balance.py"]

  GCP_SERVICE_ACCOUNT:
    type: file
    env_name: GOOGLE_APPLICATION_CREDENTIALS
    target_format: json
    description: "GCP 서비스 계정 키 (GCS 백업 및 캘린더 연동)"
    provider_url: "https://console.cloud.google.com/iam-admin/serviceaccounts"
    used_by: ["litestream", "google-calendar.py"]

  GH_TOKEN:
    type: string
    env_name: GH_TOKEN
    description: "GitHub CLI PR 생성 및 저장소 연동용 PAT"
    provider_url: "https://github.com/settings/tokens"
    used_by: ["/usr/bin/gh"]
```
