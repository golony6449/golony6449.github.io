# golony6449.github.io

개인 블로그와 책 시리즈를 GitHub Pages로 배포하는 저장소입니다.

## 책

- [웹 개발자를 위한 임베디드 입문](https://golony6449.github.io/embedded/) — 원본: `books/embedded/`

## 저장소 구조

```text
index.html                  사이트 루트(책 목록)
books/embedded/book.toml    mdBook 설정
books/embedded/src/         책 원고
.github/workflows/pages.yml GitHub Pages 배포 워크플로
.ds-tmp/                    작업용 임시 폴더(커밋하지 않음)
```

## 로컬 미리보기

[mdBook](https://rust-lang.github.io/mdBook/) 0.5.4를 설치한 뒤 저장소 루트에서 실행합니다.

```bash
mdbook serve books/embedded
```

<http://localhost:3000>에서 볼 수 있습니다. 원고를 고치면 브라우저가 자동으로 갱신됩니다.

빌드만 하려면 다음과 같이 실행합니다. 결과는 `books/embedded/book/`에 생기며, 이 폴더는 `.gitignore`에 들어 있습니다.

```bash
mdbook build books/embedded
```

mdBook을 설치하지 않았다면 릴리스 바이너리를 받아 쓰거나 `cargo install mdbook --version 0.5.4`로 설치합니다.

## 배포 방식

`main` 브랜치에 푸시하면 `.github/workflows/pages.yml`이 실행됩니다.

1. mdBook 0.5.4를 내려받아 `books/embedded`를 빌드합니다.
2. 루트의 `index.html`과 빌드 결과(`book/`)를 `_site/`로 합칩니다. 책은 `_site/embedded/`로 들어갑니다.
3. `actions/upload-pages-artifact`와 `actions/deploy-pages`로 GitHub Pages에 배포합니다.

사이트 주소는 <https://golony6449.github.io>이고, 책은 <https://golony6449.github.io/embedded/>에 놓입니다.

> 저장소의 **Settings → Pages → Build and deployment → Source**가 **GitHub Actions**로 설정되어 있어야 합니다. 이 설정은 저장소 관리자가 한 번만 바꾸면 됩니다.

## 글쓰기 규칙

- 한국어로 씁니다. 줄바꿈은 LF입니다(`.gitattributes`).
- 원고에 없는 사실을 지어내지 않습니다. 데이터시트·실측으로 확정하지 않은 값은 원문의 `확인 필요` 표시를 그대로 남깁니다.
- 웹 개발자의 관점(HTTP·JSON·클라우드)에서 무엇이 다르고 무엇이 그대로 통하는지를 먼저 설명합니다.
- 파이썬 예시는 `uv`를 기준으로 씁니다(`uv init`, `uv add pyserial python-can`, `uv run`).
- 차량 예시는 기아 쏘렌토 UM 2019년식 2.2 디젤에서 읽은 기록을 1차 근거로 씁니다. VIN 등 개인 정보는 쓰지 않습니다.
- 차량 실습은 **정차 상태의 읽기 전용**입니다. 쓰기·코딩·고장코드 삭제·액추에이터 구동·플래싱은 다루지 않습니다.
- 제조사 고유 PID/DID 공식은 공개 데이터베이스(OBDb)와 실차 응답을 대조하고, 확정하지 못한 값은 `문헌 기반`·`확인 필요`로 표시합니다.
