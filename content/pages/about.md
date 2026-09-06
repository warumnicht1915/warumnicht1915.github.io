---
title: 소개
subtitle: 이 블로그에 대하여
permalink: /about/
layout: page
---

## 이 블로그

읽고 만든 것을 기록하는 공간입니다.
소개 글은 나중에 채워 넣겠습니다.

## 어떻게 만들어졌나

기성 테마나 프레임워크를 쓰지 않고 처음부터 직접 만들었습니다.
저장소에 설치되는 외부 패키지가 하나도 없습니다.

| 부분 | 구현 |
|---|---|
| 정적 사이트 생성기 | 자체 제작 (Node.js, 의존성 0) |
| 마크다운 → HTML | `engine/markdown.js` — 블록·인라인 2단 파서 |
| 템플릿 언어 | `engine/template.js` — 토크나이저 → AST → 재귀 평가 |
| 코드 하이라이팅 | `engine/highlight.js` — 언어별 규칙 스캐너 |
| 디자인 | 손으로 쓴 CSS (프레임워크 없음) |
| 호스팅 | GitHub Pages + GitHub Actions |

`content/posts/` 에 마크다운 파일을 하나 넣고 푸시하면 글이 발행됩니다.

## 연락

- GitHub — [@warumnicht1915](https://github.com/warumnicht1915)
- Email — [warumnicht1915@gmail.com](mailto:warumnicht1915@gmail.com)

의견이나 질문은 각 글의 댓글, [방명록](/guestbook/),
또는 화면 오른쪽 아래의 실시간 채팅으로 남겨주세요.
