# 2026-11-19 Gemini 4 Neon 출시 및 모델별 비교

## 21:47 — Gemini 4 Neon과 Claude 모델 비교 질의

### 사용자 질문
- "neon이 나왔네? 모델별 차이가 어떨게 있을까? 클로드 모델하고 비교해줘"

### 확인한 내용
1. **Antigravity 현재 가용 모델 확인 (`swarm` `models` 조회)**
   - Gemini 4 계열: `Gemini 4 Hydrogen` (Low/Medium/High/XHigh), `Gemini 4 Neon` (Low/Medium/High/XHigh), `Gemini 4 Argon` (Low/Medium/High), `Orchestrator (Neon/Argon)`
   - Claude 계열: `Claude Sonnet 5.5` (Low/Medium/High), `Claude Opus 5.5` (Low/Medium/High)
   - 기타: `Gemini 3.8 Flash`, `GPT-OSS 120B (Medium)`
2. **웹 검색으로 확인한 스펙·벤치마크 요약**
   - **Gemini 4 Neon** (2026-11-18 출시): Hydrogen(빠른 일상 실행)과 Carbon/Argon(무거운 플래그십) 사이의 고성능 미드티어 주력(workhorse) 모델. 1M 컨텍스트, 4단계 사고 깊이(`Low`~`XHigh`), API $3/$15 (1M 입력/출력).
   - Artificial Analysis Index v5.0.1 기준 `XHigh`에서 61점, Coding Agent Index 58.6점, KingBench 4 약 63.2%로 `Claude Opus 5.5`와 동급이거나 코딩·도구 호출 처리량에서 근소 우위.
   - 반면 `Claude Opus 5.5`($4/$20)는 Terminal-Bench, FrontierCode 등 정밀 터미널·계획 수립·대규모 리팩토링·Computer Use 영역에서 강점 유지. `Claude Sonnet 5.5`($2/$10)는 잘 정의된 일상 개발과 절제된 토큰 출력에 강점.

### 책 소재 / 교훈
- **책 소재:** 2026년 11월 18일 Gemini 4 Neon이 출시되자마자 개발 환경(Antigravity)에서 바로 모델 스펙과 Claude 5.5 계열의 장단점을 비교해 작업별 모델 배치 전략을 세우는 장면.
