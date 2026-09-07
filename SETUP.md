# 설정 안내

블로그는 아무 설정 없이도 잘 돌아갑니다.
아래 두 가지를 채우면 **댓글**과 **실시간 기능**이 진짜로 켜집니다.

---

## 1. GitHub Pages 켜기 (필수, 1분)

1. 저장소 → **Settings** → 왼쪽 **Pages**
2. **Source** 를 `Deploy from a branch` 가 아니라 **`GitHub Actions`** 로 바꿉니다
3. 저장하면 끝. 이후 `main` 에 푸시할 때마다 자동 빌드·배포됩니다

> 이 블로그는 Jekyll 이 아니라 직접 만든 빌더(`build.js`)로 만들어지기 때문에
> 반드시 **GitHub Actions** 를 소스로 골라야 합니다.

배포 상태는 저장소의 **Actions** 탭에서 볼 수 있습니다.
첫 배포는 1~2분쯤 걸리고, 완료되면 https://warumnicht1915.github.io 에서 열립니다.

---

## 2. 댓글 · 방명록 켜기 (giscus, 3분)

댓글은 GitHub Discussions 에 저장됩니다. 스팸 관리와 백업을 GitHub 가 대신해 줍니다.

1. 저장소 → **Settings** → **General** → 아래로 내려 **Features** →
   **Discussions** 체크
2. 저장소 → **Discussions** 탭 → 카테고리 편집에서 **`Comments`** 라는 카테고리를 만듭니다
   (형식은 `Announcement` 가 아닌 **Open-ended discussion** 으로)
3. https://github.com/apps/giscus 에서 **giscus** 앱을 이 저장소에 설치합니다
4. https://giscus.app 에 들어가
   - 저장소에 `warumnicht1915/warumnicht1915.github.io` 입력
   - Discussion 카테고리로 `Comments` 선택
   - 페이지 아래쪽 "giscus 활성화" 코드에서 **`data-repo-id`** 와 **`data-category-id`** 값을 복사
5. `site.config.json` 을 열어 붙여 넣습니다

```json
"comments": {
  "provider": "giscus",
  "giscus": {
    "repo": "warumnicht1915/warumnicht1915.github.io",
    "repoId": "R_kgDO...",          ← 여기
    "category": "Comments",
    "categoryId": "DIC_kwDO...",    ← 여기
    "mapping": "pathname",
    "lang": "ko"
  }
}
```

6. 커밋 · 푸시하면 모든 글 아래와 방명록에 댓글창이 나타납니다.

값이 비어 있으면 댓글 자리에 설정 안내 상자가 대신 나옵니다.

---

## 3. 실시간 채팅 · 접속자 · 조회수 · 인기 검색어 켜기 (5분)

이 네 가지는 **모든 방문자가 같은 값을 봐야** 하므로 저장소가 필요합니다.
무료 등급의 Firebase Realtime Database 를 씁니다.

### 3-1. 데이터베이스 만들기

1. https://console.firebase.google.com 에서 프로젝트를 만듭니다
2. 왼쪽 **빌드 → Realtime Database → 데이터베이스 만들기**
3. 위치는 아무거나, 보안 규칙은 일단 **잠금 모드**로 시작합니다
4. 만들어진 데이터베이스 주소를 복사합니다
   (`https://프로젝트이름-default-rtdb.firebaseio.com` 형태)

### 3-2. 보안 규칙 설정 (중요)

**규칙** 탭에 아래를 그대로 붙여 넣고 게시합니다.
전체를 열어두면 누구나 데이터를 지울 수 있으니, 반드시 경로별로 제한하세요.

```json
{
  "rules": {
    ".read": false,
    ".write": false,

    "views":    { ".read": true, ".write": true, "$post": { ".validate": "newData.isNumber()" } },
    "trends":   { ".read": true, ".write": true, "$kw":   { ".validate": "newData.isNumber()" } },
    "visits":   { ".read": true, ".write": true },
    "presence": {
      ".read": true,
      "$room": { "$client": { ".write": true, ".validate": "newData.hasChild('at')" } }
    },
    "rooms": {
      "$room": {
        "messages": {
          ".read": true,
          ".indexOn": ".key",
          "$msg": {
            ".write": "!data.exists()",
            ".validate": "newData.hasChildren(['n','t','at'])",
            "n":  { ".validate": "newData.isString() && newData.val().length <= 12"  },
            "t":  { ".validate": "newData.isString() && newData.val().length <= 300" },
            "at": { ".validate": "newData.isNumber()" },
            "by": { ".validate": "newData.isString() && newData.val().length <= 40"  }
          }
        }
      }
    }
  }
}
```

이 규칙은 이렇게 동작합니다.

- 채팅 메시지는 **새로 쓰기만** 가능합니다 (`!data.exists()`) — 남의 글을 고치거나 지울 수 없습니다
- 닉네임 12자, 메시지 300자를 넘으면 서버가 거부합니다
- 명시한 경로 밖은 읽기도 쓰기도 전부 막힙니다

### 3-3. 설정에 넣기

`site.config.json` 의 `realtime.firebase.databaseURL` 에 주소를 넣습니다.

```json
"realtime": {
  "firebase": {
    "databaseURL": "https://프로젝트이름-default-rtdb.firebaseio.com"
  },
  "room": "main",
  "maxMessages": 100
}
```

푸시하면 바로 켜집니다. `apiKey` 와 `projectId` 는 REST 방식이라 없어도 됩니다.

> 값이 비어 있으면 이 기능들은 **로컬 모드**로 동작합니다.
> 채팅은 같은 브라우저의 다른 탭끼리만 오가고, 방문자 수는 내 브라우저 기준으로만 셉니다.
> 위젯에도 그렇게 표시되니 숫자를 오해할 일은 없습니다.

---

## 6. 글쓰기 · 수정 · 삭제 (두 가지 방법)

### 방법 A — 블로그 화면에서 바로

`/admin/` 에서 토큰을 한 번 넣어두면, 그때부터 **블로그 화면 어디에서나** 관리 버튼이 보입니다.

- 왼쪽 아래 초록색 **새 글** 버튼 — 바로 글쓰기
- 글 목록에서 카드에 마우스를 올리면 **수정 / 삭제**
- 글을 열면 제목 아래에 **수정 / 삭제**

이 버튼들은 **토큰이 저장된 내 브라우저에만** 나타납니다. 방문자 화면에는 존재하지 않고,
방문자 쪽에서는 GitHub 로 아무 요청도 가지 않습니다.

옆의 **관리** 버튼을 누르면 전체 관리자 페이지(`/admin/`)로 갑니다.
검색엔진에는 노출되지 않고, 메뉴에도 없습니다.

여기서 할 수 있는 것:

- 글쓰기 · 수정 · 삭제 (본문 옆에 **실시간 마크다운 미리보기** — 실제 사이트와 같은 파서를 씁니다)
- 프로필, 블로그 제목·소개, 한 페이지 글 수 변경
- giscus / Firebase 설정값 입력
- 상단 메뉴와 공지사항 편집

저장하면 GitHub 에 커밋되고, Actions 가 1~2분 안에 배포합니다.

**필요한 토큰 만들기**

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token
2. Repository access → **Only select repositories** → 이 블로그 저장소 **하나만** 선택
3. Permissions → Repository permissions → **Contents: Read and write** (이것 하나면 충분합니다)
4. 만료일은 짧게. 만료되면 `/admin/` 에서 새 토큰으로 바꾸면 됩니다.

> [!WARNING]
> 토큰은 브라우저(localStorage)에만 저장되고 `api.github.com` 외에는 어디로도 가지 않습니다.
> 그래도 **공용 PC에서는 쓰지 마세요.** 자리를 뜰 때는 관리자 페이지의 **로그아웃**을 눌러 지우세요.
> 이 저장소 하나에만 권한을 준 토큰을 쓰면 최악의 경우에도 피해가 이 블로그로 한정됩니다.

### 방법 B — GitHub 이슈로 쓰기 (토큰 불필요)

휴대폰 GitHub 앱에서도 글을 쓸 수 있는 방법입니다.

1. 저장소 → Issues → New issue → **새 글 쓰기** 템플릿 선택
2. 제목이 글 제목이 되고, 본문이 그대로 마크다운 본문이 됩니다
3. 저장하면 워크플로가 글로 바꿔서 발행합니다

본문 맨 위 설정 줄로 항목을 지정합니다.

```text
::: 게시판: 개발
::: 태그: 자바스크립트, 파서
::: 요약: 한 줄 요약
::: 고정: 예
::: 초안: 아니오
::: 주소: my-slug
```

- **이슈를 수정하면** 글도 같이 바뀝니다
- **이슈를 닫으면** 글이 내려갑니다 (다시 열면 복구)
- 저장소 주인이 쓴 `post` 라벨 이슈만 처리합니다 — 남이 쓴 이슈로는 글이 발행되지 않습니다

### 댓글

댓글은 위 2번(giscus)에서 이미 켭니다. 방문자는 GitHub 로그인만 하면 바로 남길 수 있고,
로그인 없이 대화하려면 화면 오른쪽 아래 실시간 채팅을 쓰면 됩니다.

---

## 7. 내 정보로 바꾸기

`site.config.json` 위쪽을 고칩니다.

```json
"title": "블로그 이름",
"subtitle": "한 줄 소개",
"description": "검색 결과에 뜰 설명",
"url": "https://warumnicht1915.github.io",
"author": {
  "name": "표시할 이름",
  "bio": "프로필 위젯에 뜰 소개",
  "github": "warumnicht1915",
  "email": "warumnicht1915@gmail.com"
}
```

- 메뉴는 `data/nav.json`
- 사이드바 공지는 `data/notice.json`
- 인기 검색어 초기 목록은 `data/trends.json`
- 푸터 링크는 `data/links.json`

> 연락처 이메일을 공개하고 싶다면 `author` 에 `"email": "..."` 을 추가하세요.
> 값이 없으면 프로필·푸터의 메일 아이콘이 아예 표시되지 않습니다.
> GitHub 계정 설정에서 **Keep my email addresses private** 를 켜두는 것도 함께 권합니다.

프로필 사진은 `static/img/avatar.svg` 를 원하는 이미지로 바꾸고
`author.avatar` 경로만 맞춰주면 됩니다.

---

## 8. 개인 도메인 붙이기 (선택)

1. `site.config.json` 에 `"cname": "example.com"` 을 추가합니다
   (빌드할 때 `CNAME` 파일이 자동으로 생성됩니다)
2. `url` 값도 새 도메인으로 바꿉니다
3. 도메인 DNS 에 GitHub Pages 용 레코드를 추가합니다
4. 저장소 Settings → Pages 에서 도메인을 입력하고 **Enforce HTTPS** 를 켭니다

---

## 자주 겪는 문제

**배포는 성공했는데 404가 뜹니다**
Settings → Pages 의 Source 가 `GitHub Actions` 인지 확인하세요.

**CSS가 깨져 보입니다**
저장소 이름이 `사용자이름.github.io` 가 아니라면
`site.config.json` 의 `baseurl` 에 `/저장소이름` 을 넣어야 합니다.

**채팅에 내 메시지만 보입니다**
`realtime.firebase.databaseURL` 이 비어 있어 로컬 모드로 돌고 있는 상태입니다. 3번 항목을 보세요.

**Actions 가 실패합니다**
Actions 탭에서 로그를 열어보세요. `node tools/check.js` 단계에서 멈췄다면
깨진 내부 링크가 있다는 뜻이고, 어떤 파일의 어떤 링크인지 로그에 찍혀 있습니다.
