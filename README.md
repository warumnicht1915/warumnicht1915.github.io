# warumnicht1915.github.io

> 티스토리 · 네이버 스타일의 개인 블로그.
> 정적 사이트 생성기부터 마크다운 파서, 템플릿 엔진, 문법 하이라이터까지
> **전부 직접 작성한 코드**로 만들었습니다. 외부 의존성 0개.

🔗 https://warumnicht1915.github.io

---

## 무엇이 들어 있나

### 자체 제작 정적 사이트 생성기 — Gaon

| 모듈 | 역할 | 줄 수 |
|---|---|---|
| `engine/frontmatter.js` | 글 머리말을 읽는 YAML 서브셋 파서 (중첩 매핑·시퀀스·인라인 배열) | ~200 |
| `engine/markdown.js` | 마크다운 → HTML. 블록 파서 + 인라인 파서 2단 구조 | ~300 |
| `engine/template.js` | 자체 템플릿 언어. 토크나이저 → AST → 재귀 평가 | ~380 |
| `engine/highlight.js` | 언어별 규칙 기반 문법 하이라이터 (13개 언어) | ~200 |
| `engine/site.js` | 글·페이지·카테고리·태그·아카이브·페이지네이션 모델 | ~200 |
| `engine/renderer.js` | 템플릿 캐시와 레이아웃 상속 | ~60 |
| `engine/util.js` | 날짜 포맷, 슬러그, 파일 IO | ~130 |
| `build.js` | 전체 빌드 오케스트레이션 + 개발 서버 + 파일 감시 | ~300 |

`npm install` 이 필요 없습니다. Node.js 18 이상이면 클론하고 바로 실행됩니다.

### 블로그 기능

**콘텐츠**
- 글 목록(카드형 · 목록형 전환), 페이지네이션, 고정 글
- 카테고리(게시판) · 태그별 자동 페이지
- 연도별 아카이브 + 즉석 필터
- 이전 글 / 다음 글, 같은 카테고리 관련 글
- 본문 목차 자동 생성 + 스크롤 위치 추적
- 코드 블록 줄 번호 · 언어 표시 · 복사 버튼
- GitHub 스타일 콜아웃(참고 / 팁 / 주의 / 경고 / 중요), 표, 체크박스 리스트

**사이드바 위젯 9종**
- 프로필 (글·게시판·태그 수)
- 검색 + **실시간 인기 검색어** (순위 변동 화살표 포함)
- 공지사항
- 게시판(카테고리별 글 수)
- 최근 업로드된 글
- 인기 글 (실제 조회수 기준 자동 정렬)
- 태그 클라우드
- **접속자** (지금 접속 / 오늘 / 어제 / 전체)
- **실시간 채팅** 미리보기

**글 관리 (관리자용)**
- ✍️ **`/write/` 전용 글쓰기 페이지** — 마크다운 도구 모음, 단축키, 나란히 미리보기,
  집중 모드, 이미지 끌어놓기 · 붙여넣기 업로드, 자동 임시저장, 글자 수 · 읽기 시간.
- 🛠 **`/admin/` 관리자 페이지** — 글 목록 관리, 프로필 · 로고 · 배너 이미지 업로드,
  사이트 설정, 태그 일괄 이름변경 · 삭제, 인기 검색어 · 채팅 관리, 메뉴 · 공지 편집.
  본문 옆에 **실시간 마크다운 미리보기**(빌드에 쓰는 것과 동일한 파서를 브라우저로 묶어서 사용).
  저장하면 GitHub 에 커밋되고 Actions 가 배포합니다.
- 📝 **이슈로 글쓰기** — GitHub 이슈에 `post` 라벨을 붙이면 워크플로가 글로 발행.
  이슈를 수정하면 글도 바뀌고, 닫으면 내려갑니다. 토큰이 필요 없어 휴대폰에서도 씁니다.

**상호작용**
- 💬 **댓글 · 방명록** — GitHub Discussions 기반 (giscus)
- ⚡ **실시간 채팅** — 우측 하단 플로팅 패널, 접속자 수 · 새 메시지 알림,
  **이미지 전송**(브라우저에서 축소 후 전송, 1인/전체 용량 한도), 직접 그린 마스코트 로딩 애니메이션,
  관리자 삭제 → “삭제된 메시지입니다”
- 👀 **조회수 · 방문자** — 글별 조회수(30분 중복 방지), 방문자를 **UV(순 방문자)** 와
  **PV(페이지 조회)** 로 나눠 오늘 · 어제 · 전체 집계
- 🔍 **전문 검색** — 빌드 시 생성한 JSON 인덱스, 제목/태그/본문 가중치 + 검색어 하이라이트

**그 외**
- 라이트 / 다크 / 시스템 따름 (첫 페인트 깜빡임 없음)
- 반응형 (데스크톱 2단 → 모바일 1단), 인쇄 스타일
- RSS, sitemap.xml, robots.txt, Open Graph, JSON-LD
- 읽기 진행바, 맨 위로, 링크 복사, 이미지 확대
- 키보드 접근성 (본문 바로가기, 포커스 링, ARIA)

---

## 폴더 구조

```
.
├── build.js                  빌드 진입점
├── site.config.json          블로그 전체 설정 (여기만 고치면 됩니다)
├── engine/                   자체 제작 엔진
├── templates/
│   ├── layouts/              base · home · post · page · list
│   ├── pages/                글목록 · 게시판 · 태그 · 검색 · 관리자 · 404
│   └── partials/             헤더 · 푸터 · 사이드바 · 위젯 · 채팅
├── content/
│   ├── posts/                글 (마크다운)
│   └── pages/                소개 · 방명록
├── static/                   CSS · JS · 이미지 (그대로 /assets 로 복사됨)
├── data/                     메뉴 · 공지 · 인기검색어 시드 (JSON)
├── tools/                    새 글 생성기, 빌드 점검기, 이슈→글 변환기
└── _site/                    빌드 결과 (git 에 올라가지 않음)
```

---

## 쓰는 법

```bash
# 미리보기 (저장하면 자동 재빌드)
npm run dev            # → http://localhost:4000

# 새 글 만들기
npm run new "글 제목" 개발 "태그1,태그2"

# 초안까지 포함해서 보기
npm run draft

# 빌드 + 결과 점검 (깨진 링크, 남은 템플릿 태그 검사)
npm run build && npm run check
```

글 하나는 이렇게 생겼습니다.

```markdown
---
title: 글 제목
subtitle: 부제 (선택)
date: 2026-09-06 10:00
categories: [개발]
tags: [자바스크립트, 파서]
image: /assets/img/cover.png   # 선택
pinned: true                   # 선택 — 홈 상단 고정
draft: true                    # 선택 — 빌드에서 제외
description: 검색·미리보기에 쓸 한 줄 요약
---

도입부.

<!--more-->

## 본문 시작
```

`content/posts/` 에 파일을 넣고 푸시하면 GitHub Actions 가 빌드해서 배포합니다.

---

## 템플릿 문법

직접 만든 언어라 규칙이 다섯 개뿐입니다.

```
{{ 값 | 필터: 인자 }}                      출력 (기본 HTML 이스케이프)
{% if 조건 %} {% elif %} {% else %} {% end %}
{% for x in 목록 %} {% empty %} {% end %}    loop.index / first / last / length
{% include "widgets/recent.html" %}
{% set 이름 = 값 %}
```

기본 필터: `default` `upper` `lower` `capitalize` `trim` `size` `first` `last`
`join` `split` `limit` `offset` `reverse` `sort` `sort_by` `where` `reject` `map`
`json` `date` `number` `plus` `minus` `times` `divided` `replace`
`strip_html` `truncate` `slugify` `urlencode` `keys` `values` `raw` `escape`
사이트 전용 필터: `url` `abs` `catUrl` `tagUrl`

---

## 설정

`site.config.json` 하나에 전부 모여 있습니다.
댓글 · 실시간 기능을 켜는 방법은 **[SETUP.md](SETUP.md)** 를 보세요.
설정이 비어 있어도 사이트는 정상 동작하며, 실시간 위젯이 "이 브라우저 기준"으로
동작한다는 사실을 화면에 정직하게 표시합니다.

---

## 라이선스

[MIT](LICENSE) © warumnicht1915
