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

## 2. 댓글 · 채팅 · 통계 켜기 (공유 DB, 10분)

댓글·채팅·조회수·방문자·인기 검색어는 **전부 자체 구현**이고, 저장할 곳만 있으면 됩니다.
Firebase Realtime Database 무료 등급을 씁니다. (외부 댓글 서비스는 쓰지 않습니다.)

### 2-1. 데이터베이스와 익명 로그인 만들기

1. https://console.firebase.google.com 에서 프로젝트를 만듭니다 (Analytics 는 꺼도 됩니다)
2. 왼쪽 **빌드 → Realtime Database → 데이터베이스 만들기**
   위치는 아무거나, 보안 규칙은 **잠금 모드**로 시작합니다
3. 왼쪽 **빌드 → Authentication → 시작하기 → 익명(Anonymous) 사용 설정**
   → 로그인 없이 댓글을 쓰더라도 서버는 "누가 썼는지"를 알게 됩니다. 보안의 핵심입니다.
4. 프로젝트 설정(톱니바퀴) → **내 앱 → 웹 앱 추가** → 나오는 값에서 두 개를 복사합니다
   - `databaseURL` (`https://...-default-rtdb.firebaseio.com`)
   - `apiKey` (`AIza...`)

> [!NOTE]
> `apiKey` 는 비밀번호가 아닙니다. 공개되어도 괜찮은 값이고, 실제 접근 통제는 아래 규칙이 합니다.

### 2-2. 보안 규칙 (가장 중요)

**규칙** 탭에 아래를 그대로 붙여 넣고 게시합니다.
(저장소의 `database.rules.json` 과 같은 내용입니다.)
전체를 열어두면 누구나 데이터를 지울 수 있으니, 반드시 경로별로 제한하세요.

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "admins": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": false
      }
    },
    "views": {
      ".read": true,
      "$post": {
        ".write": "auth != null",
        ".validate": "newData.isNumber() && (!data.exists() ? newData.val() === 1 : newData.val() === data.val() + 1)"
      }
    },
    "visits": {
      ".read": true,
      "days": {
        "$day": {
          "$kind": {
            ".write": "auth != null",
            ".validate": "newData.isNumber() && (!data.exists() ? newData.val() === 1 : newData.val() === data.val() + 1)"
          }
        }
      },
      "total": {
        "$kind": {
          ".write": "auth != null",
          ".validate": "newData.isNumber() && (!data.exists() ? newData.val() === 1 : newData.val() === data.val() + 1)"
        }
      }
    },
    "trends": {
      ".read": true,
      "$kw": {
        ".write": "auth != null",
        "kw": {
          ".validate": "newData.isString() && newData.val().length <= 24"
        },
        "n": {
          ".validate": "newData.isNumber() && (!data.exists() ? newData.val() === 1 : newData.val() === data.val() + 1)"
        },
        "$other": {
          ".validate": false
        }
      }
    },
    "presence": {
      ".read": true,
      "$room": {
        "$uid": {
          ".write": "auth != null && auth.uid === $uid",
          ".validate": "newData.hasChild('at') && newData.child('at').isNumber()"
        }
      }
    },
    "comments": {
      ".read": true,
      "$page": {
        "$id": {
          ".write": "auth != null && (!data.exists() || data.child('uid').val() === auth.uid || root.child('admins').child(auth.uid).val() === true)",
          ".validate": "newData.hasChildren(['n','t','at','uid']) || newData.hasChild('del')",
          "n": {
            ".validate": "newData.isString() && newData.val().length <= 16"
          },
          "t": {
            ".validate": "newData.isString() && newData.val().length <= 1500"
          },
          "at": {
            ".validate": "newData.isNumber()"
          },
          "uid": {
            ".validate": "newData.val() === auth.uid || newData.val() === data.val()"
          },
          "p": {
            ".validate": "newData.isString()"
          },
          "del": {
            ".validate": "newData.isNumber()"
          },
          "$other": {
            ".validate": false
          }
        }
      }
    },
    "rooms": {
      "$room": {
        "usage": {
          ".read": true,
          ".write": "auth != null"
        },
        "messages": {
          ".read": true,
          "$msg": {
            ".write": "auth != null && (!data.exists() || data.child('uid').val() === auth.uid || root.child('admins').child(auth.uid).val() === true)",
            ".validate": "newData.hasChildren(['n','at','uid']) || newData.hasChild('del')",
            "n": {
              ".validate": "newData.isString() && newData.val().length <= 12"
            },
            "t": {
              ".validate": "newData.isString() && newData.val().length <= 300"
            },
            "at": {
              ".validate": "newData.isNumber()"
            },
            "uid": {
              ".validate": "newData.val() === auth.uid || newData.val() === data.val()"
            },
            "img": {
              ".validate": "newData.isString() && newData.val().length <= 220000"
            },
            "iw": {
              ".validate": "newData.isNumber()"
            },
            "ih": {
              ".validate": "newData.isNumber()"
            },
            "ib": {
              ".validate": "newData.isNumber()"
            },
            "del": {
              ".validate": "newData.isNumber()"
            },
            "$other": {
              ".validate": false
            }
          }
        }
      }
    }
  }
}
```

이 규칙이 실제로 막아주는 것들입니다.

| 공격 | 막는 방법 |
|---|---|
| 로그인 없이 아무거나 쓰기 | 모든 쓰기에 `auth != null`. 익명 로그인이라도 서버가 uid 를 발급합니다 |
| **남의 댓글·메시지 수정/삭제** | `data.child('uid').val() === auth.uid` — 글쓴이 본인 또는 관리자만 |
| 조회수·방문자 수 부풀리기 | 카운터는 **정확히 +1** 만 허용. `999999` 로 덮어쓰기가 거부됩니다 |
| 초대형 데이터로 용량 채우기 | 이름 16자, 댓글 1500자, 메시지 300자, 이미지 215KB 로 서버가 자릅니다 |
| 이상한 필드 끼워넣기 | `$other: { ".validate": false }` — 정의한 필드 외에는 저장 자체가 안 됩니다 |
| 남의 접속 상태 위조 | `auth.uid === $uid` — 자기 자리만 씁니다 |
| 관리자 권한 탈취 | `admins` 는 **쓰기 불가**. Firebase 콘솔에서만 등록됩니다 |
| 전체 데이터 훔쳐보기 | 최상위 `.read: false`. 공개된 경로만 읽힙니다 |

여전히 남는 위험은 하나입니다. **익명 로그인은 누구나 새로 받을 수 있으므로,
작정하고 uid 를 계속 새로 만들며 도배하는 것은 막지 못합니다.** 그때는 관리 화면에서
**대화 전부 지우기 / 검색어 비우기** 로 정리하거나, Firebase 콘솔에서
`rooms`·`comments` 의 `.write` 를 잠시 `false` 로 바꾸면 즉시 멎습니다.

### 2-3. 설정에 넣기

`site.config.json` 의 `realtime.firebase` 에 값 세 개를 넣습니다.

```json
"realtime": {
  "provider": "firebase",
  "firebase": {
    "apiKey": "AIza...",
    "databaseURL": "https://프로젝트이름-default-rtdb.firebaseio.com",
    "projectId": "프로젝트이름"
  },
  "room": "main"
}
```

세 값이 다 있어야 **공유 모드**로 켜집니다. 비어 있으면 **로컬 모드**가 되어
채팅은 같은 브라우저의 다른 탭끼리만 오가고, 방문자 수도 내 브라우저 기준으로만 셉니다.
위젯에 그렇게 표시되니 숫자를 오해할 일은 없습니다.

> [!NOTE]
> 이 저장소는 이미 채워져 있습니다.
> 프로젝트 `warumnicht1915-blog`, DB `https://warumnicht1915-blog-default-rtdb.firebaseio.com`.
> 규칙도 위 내용 그대로 게시돼 있고, 실제 DB 에 13가지 침투 시나리오
> (남의 uid 로 쓰기 · 조회수 조작 · 비로그인 쓰기 · 스스로 관리자 등록 · 루트 통째 읽기/삭제 등)를
> 시험해서 전부 막히는 것까지 확인했습니다.

### 2-4. 나를 관리자로 등록하기

관리자만 남의 댓글·채팅을 지울 수 있습니다. 한 번만 등록하면 됩니다.

1. 배포된 블로그에서 `/admin/` → **프로필 · 설정** 으로 갑니다
2. 아래쪽 **내 사용자 ID** 에 뜨는 값을 복사합니다 (`abc123...` 형태)
3. Firebase 콘솔 → Realtime Database → 데이터 탭에서 이렇게 만듭니다

```text
admins
  └─ 복사한_사용자_ID : true
```

4. 블로그를 새로고침하면 모든 댓글과 채팅에 **삭제** 가 보입니다

> [!WARNING]
> 이 ID 는 브라우저마다 다릅니다. 브라우저 저장소를 지우거나 다른 기기에서 관리하려면
> 그 기기의 ID 도 같은 방법으로 추가하세요.

---

## 3. 글쓰기 · 수정 · 삭제 (두 가지 방법)

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
  - 새 글은 열 때의 **날짜·시각이 자동으로** 들어갑니다
  - 태그는 칩으로 붙고, × 를 눌러 하나씩 뺍니다
- **프로필 이미지 업로드** — 파일을 고르면 `static/img/` 에 올라가고 경로가 자동으로 채워집니다
  (기본 이미지 `avatar.svg` 는 그대로 남아 있어 언제든 되돌릴 수 있습니다)
- 프로필, 블로그 제목·소개, 한 페이지 글 수 변경
- **태그 관리** — 태그 이름을 바꾸거나 지우면 그 태그가 쓰인 모든 글이 함께 수정됩니다
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

### 글쓰기 전용 페이지 `/write/`

`/admin/` 의 **새 글 쓰기** 버튼을 누르면 전용 편집기가 열립니다.

- 마크다운 도구 모음 (제목 · 굵게 · 링크 · 코드 · 표 · 콜아웃 …)
- 단축키: `Ctrl+B` 굵게, `Ctrl+I` 기울임, `Ctrl+K` 링크, `Ctrl+S` 임시저장, `Ctrl+Enter` 발행
- 보기 전환: 나란히 / 편집만 / 미리보기만 / 집중 모드(전체화면)
- 이미지: 버튼 · **끌어다 놓기** · **붙여넣기** 모두 됩니다 (저장소에 올린 뒤 본문에 삽입)
- 글자 수 · 단어 수 · 예상 읽기 시간
- 자동 임시저장 (브라우저에 보관하며, 발행하면 지워집니다)

### 배너 · 로고 바꾸기

`/admin/` → **프로필 · 설정** → **최상단 배너** 에서 바꿉니다.

- 헤더 로고: 글자(기본 `W`) 또는 이미지
- 큰 제목과 그 아래 단어들(기본 `생성 · 기록 · 공유`)
- 배경 이미지 업로드 + 어둡게 덮는 정도 조절 (비우면 그라데이션)

### 인기 검색어 · 채팅 관리

`/admin/` → **검색어 · 채팅** 탭에서 합니다.

- 인기 검색어를 하나씩 지우거나 전부 비우기 (사이드바 위젯에서도 관리자에게만 × 가 보입니다)
- 채팅 메시지는 채팅창에서 바로 **지우기** — 지운 자리에는 “삭제된 메시지입니다” 가 남습니다
- 대화 전부 지우기

### 채팅 이미지

방문자가 채팅에 이미지를 올릴 수 있습니다. 브라우저에서 먼저 축소·압축한 뒤 보내고,
`site.config.json` 의 `realtime.chat.image` 로 한도를 정합니다.

| 항목 | 기본값 | 뜻 |
|---|---|---|
| `maxWidth` | 900 | 긴 변을 이 크기로 줄임 |
| `maxBytes` | 160000 | 이미지 1장 최대 (약 156KB) |
| `perUserBytes` | 3000000 | 한 사람당 누적 3MB |
| `perUserCount` | 20 | 한 사람당 20장 |
| `totalBytes` | 60000000 | 채팅방 전체 60MB |

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

## 4. 내 정보로 바꾸기

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

## 5. 개인 도메인 붙이기 (선택)

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
