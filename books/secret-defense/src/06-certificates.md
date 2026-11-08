# 제6장: 다섯 번째 반론과 결정타 — "cert도 주입해서 쓸 텐데?"

> **인간**: "cert도 주입해서 쓸 텐데?"

순간 숨이 턱 막혔다.  
단순한 문자열 토큰만 생각하던 AI의 좁은 시야를 완전히 뒤흔든 한마디였다.

- GCP 서비스 계정 키 파일: `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`
- Let's Encrypt 와일드카드 인증서 갱신: `cloudflare.ini`
- mTLS 클라이언트 인증서: `cert.pem`, `key.pem`

인증서는 문자열 하나가 아니라 **"디스크 상의 파일 경로"**를 요구한다.  
만약 이 인증서들을 디스크 어딘가에 저장해 둔다면? 에이전트는 또다시 그 경로를 찾아내 `cat /path/to/key.json`으로 읽어버릴 것이다. 프록시도, 환경변수 주입도 파일 기반 인증서 앞에서는 무용지물이었다.
