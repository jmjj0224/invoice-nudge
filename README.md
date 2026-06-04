# 🧾 invoice-nudge

프리랜서용 인보이스 미리알림 봇. 인보이스를 등록하면, 마감일에 맞춰 클라이언트에게 **정중한 리마인더 이메일을 자동 발송**합니다. "돈 주세요" 말하는 어색함을 시스템이 대신 처리해요.

dead simple — 의존성 0개, `node server.js` 한 줄로 실행됩니다.

---

## 1. 실행하기 (30초)

이 폴더에서 터미널을 열고:

```bash
node server.js
```

브라우저에서 → **http://localhost:4000**

인보이스를 추가하고, 완료되면 "Mark paid" 누르면 끝. 데이터는 같은 폴더의 `invoices.json`에 저장돼요 (DB 불필요).

---

## 2. 이메일 자동 발송 연결 (n8n 재활용)

리마인더 이메일은 이미 쓰고 있는 **n8n**이 보냅니다. 같이 받은 `invoice-reminder-sender.n8n.json`을 쓰세요.

1. n8n → **Import from File** → `invoice-reminder-sender.n8n.json`
2. **Send Reminder Email** 노드 → **Gmail 자격증명** 연결 (구글 계정 OAuth 한 번)
3. **Reminder Webhook** 노드를 열어 **Production URL** 복사 (예: `https://<your-ngrok>/webhook/send-invoice-reminder`)
4. 워크플로우 **Activate**
5. 앱을 그 웹훅 주소와 함께 실행:

```bash
N8N_WEBHOOK_URL="https://<your-ngrok>/webhook/send-invoice-reminder" SENDER_NAME="장민재" node server.js
```

이제 앱이 매일 한 번(그리고 시작할 때) 마감 지난 미납 인보이스를 찾아 → n8n으로 보내고 → n8n이 정중한 이메일을 발송합니다.

> **바로 테스트:** 마감일이 오늘이거나 지난 인보이스를 하나 등록한 뒤, 터미널에서
> `curl -X POST localhost:4000/api/run-reminders`
> 를 실행하면 즉시 리마인더 체크가 돌아요. 클라이언트 이메일 칸에 **본인 이메일**을 넣어 테스트해보세요.

---

## 3. 설정 (환경변수, 전부 선택)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | 4000 | 웹 서버 포트 |
| `N8N_WEBHOOK_URL` | (없음) | 리마인더를 보낼 n8n 웹훅. 없으면 발송 건너뜀 |
| `SENDER_NAME` | "Your name" | 이메일 서명에 들어갈 이름 |
| `REMIND_EVERY_DAYS` | 3 | 미납 상태일 때 며칠마다 다시 보낼지 |

---

## 4. 리마인더 규칙 (현재 v1)

- **마감일 당일 또는 그 이후**의 **미납** 인보이스에만 발송
- 한 번 보내면 `REMIND_EVERY_DAYS`(기본 3일)마다 다시 발송 — 받을 때까지
- "Mark paid" 누르면 즉시 멈춤

규칙을 바꾸고 싶으면 `server.js`의 `reminderDue()` 함수 한 곳만 고치면 돼요.

---

## 5. 다음에 붙일 것 (페르소나 로드맵)

- **결제 (Lemon Squeezy)** — Merchant of Record라 글로벌 세금 자동 처리. anti-free-trial 가격($9/월, 효과 없으면 100% 환불).
- **마감 전 리마인더** — 며칠 전 미리 알림
- **클라이언트별 톤 조절** / 다국어 템플릿
- **로그인 + 멀티유저** (남에게 팔 때)

코드를 짜고 GitHub에 push하면 — 이미 만들어둔 **build-in-public 파이프라인**이 자동으로 트윗 초안을 Slack에 만들어줍니다. 만들면서 마케팅이 쌓이는 구조예요.

---

*Ship beats perfect. 이건 v1입니다. 첫 고객부터 잡고, 나머지는 나중에.*
