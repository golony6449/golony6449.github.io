# 제14장: 단계별 구현 및 롤아웃 로드맵

```mermaid
gantt
    title 시크릿 볼트 데몬 롤아웃 로드맵
    dateFormat  YYYY-MM-DD
    section Phase 1: 설계
    설계서 작성 및 반론 검증       :done, p1, 2026-11-08, 1d
    section Phase 2: 코어 구현
    secret-vaultd 데몬 프로토타입 :active, p2_1, 2026-11-09, 3d
    secret-run CLI 및 정책 엔진   :p2_2, 2026-11-12, 2d
    secret-vault 관리자 CLI 구현  :p2_3, 2026-11-14, 2d
    section Phase 3: 연동 검증
    claude_secrets 모듈 연동      :p3_1, 2026-11-16, 2d
    ds-* / qwen-* / gh 종합 테스트:p3_2, 2026-11-18, 2d
    section Phase 4: 배포 및 전환
    홈서버 systemd 등록           :p4_1, 2026-11-20, 1d
    평문 파일 파기 및 훅 은퇴     :p4_2, 2026-11-21, 1d
```

---

| 단계 | 작업 내용 | 검증 기준 |
| :--- | :--- | :--- |
| **Phase 1** | 설계서 확정 및 출판 | `the-art-of-secret-defense.md` 완료 (현재 단계) |
| **Phase 2** | 홈서버 데몬 및 러너 구현 | UDS 통신, Keyring 연동, `/dev/shm` RAMFS 생성/파기 단위 테스트 |
| **Phase 3** | 관리자 CLI 및 메타데이터 구축 | `secret-vault set`으로 키 등록 확인, 누락 키 안내 카드 출력 검증 |
| **Phase 4** | 홈서버 배포 및 훅 은퇴 | `systemd --user` 등록, 평문 파일 삭제, `secrets-guard.py` 오탐 해소 |
