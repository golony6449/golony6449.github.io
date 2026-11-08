# 제11장: 공용 모듈(`claude_secrets.py`) 하위 호환성 명세

기존의 모든 프로젝트 코드(`ds-*`, `qwen-*`, `office.py`)는 코드를 단 1줄도 바꿀 필요가 없다. 공용 모듈이 중간에서 환경에 맞춰 지능적으로 동작한다.

```python
# ~/.claude/bin/claude_secrets.py
import os
import sys

def get(key: str) -> str:
    """시크릿 단건 조회 진입점 함수."""
    
    # 1. secret-run 러너에 의해 자식 프로세스 환경변수로 주입된 경우 (최우선)
    env_val = os.environ.get(key.upper()) or os.environ.get(key)
    if env_val:
        return env_val

    # 2. Windows 메인 PC: 기존 로컬 JSON + 훅 방식 유지 (점진적 호환)
    if sys.platform == "win32":
        return _get_from_windows_json(key)

    # 3. 홈서버 환경인데 환경변수가 없다면 -> 에이전트의 직접 호출이거나 러너 미사용
    raise PermissionError(
        f"[Security Violation] '{key}' 시크릿에 직접 접근할 수 없습니다. "
        f"secret-run 러너를 통해 승인된 도구로 실행하십시오."
    )
```
