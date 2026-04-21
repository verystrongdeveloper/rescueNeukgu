# 랭킹 백엔드 설치 가이드 (Google Apps Script + Google Sheet)

서버를 따로 돌릴 필요 없이, **구글 스프레드시트 1개**를 DB처럼 사용합니다.

## 1. 스프레드시트 만들기

1. 구글 드라이브에서 **새 Google 스프레드시트** 생성 (제목 예: `늑구 랭킹`)
2. 상단 메뉴 **확장 프로그램 → Apps Script** 클릭

## 2. Apps Script에 코드 붙여넣기

1. 기본 생성된 `Code.gs` 내용을 모두 지우고, 이 폴더의 [`Code.gs`](./Code.gs) 내용을 전부 복사해 붙여넣기
2. 저장 (Ctrl+S)

## 3. 웹 앱으로 배포

1. 오른쪽 위 **배포 → 새 배포** 클릭
2. 유형: **웹 앱** 선택
3. 설정:
   - 다음 사용자로 실행: **나**
   - 액세스 권한: **모든 사용자** ← 중요
4. **배포** 클릭 → 권한 허용
5. 표시되는 **웹 앱 URL** 을 복사 (`https://script.google.com/macros/s/AKfy.../exec` 형식)

## 4. 프론트에 URL 입력

프로젝트 루트의 `game.js` 맨 아래쪽에 있는 아래 상수에 방금 복사한 URL을 붙여넣기:

```js
const RANKING_API_URL = ''; // ← 여기에 배포한 웹 앱 URL
```

입력 후 페이지 새로고침하면 랭킹 기능이 활성화됩니다.

## 5. ⚠️ 중요: `file://`로 열면 안 됩니다

`index.html`을 탐색기에서 더블클릭해서 열면 브라우저 origin이 `null`이 되어 Google Apps Script가 **401 + CORS 에러**로 요청을 차단합니다. 반드시 **로컬 서버로 띄워서** `http://localhost:...`로 접속하세요.

가장 간단한 방법 (Python 필요):
```powershell
cd c:\Users\user\Desktop\코딩\rescueNeukgu
python -m http.server 8000
```
그 다음 브라우저에서 `http://localhost:8000` 접속.

또는 VS Code / Cursor의 **Live Server** 확장 설치 후 `index.html` 우클릭 → "Open with Live Server".

## API 명세 (참고)

### `GET ?action=rank&limit=20`
응답:
```json
{ "ok": true, "rank": [ { "username": "홍길동", "totalRescued": 12 } ] }
```

### `POST` (Content-Type: text/plain — CORS preflight 회피)
요청 본문:
```json
{ "username": "홍길동", "rescuedCount": 3 }
```
응답:
```json
{ "ok": true, "username": "홍길동", "totalRescued": 15 }
```

## 시트 구조

Apps Script가 `rankings` 시트를 자동 생성합니다.

| A (username) | B (totalRescued) | C (updatedAt) |
|---|---|---|
| 홍길동 | 15 | 2026-04-21T06:12:33.000Z |

수동으로 값을 수정해도 됩니다 (예: 이름 정리, 초기화 등).

## 주의사항

- 웹 앱 URL은 공개되므로 누구나 요청 가능합니다. 간단 랭킹용이면 OK지만, 조작 방지가 필요하면 서명키/토큰 검증 로직을 추가해야 합니다.
- Apps Script는 일일 실행 한도가 있지만 개인 랭킹 용도로는 충분합니다.
- 코드를 수정한 뒤에는 **배포 → 배포 관리 → 수정(연필) → 새 버전 → 배포** 로 다시 배포해야 반영됩니다.
