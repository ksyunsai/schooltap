# 기존 스쿨탭 발송 함수에 언어별 문구 연결하기

`send-schooltap-push/` 안의 세 파일을 기존 `supabase/functions/send-schooltap-push/`에 복사합니다. 기존 `index.ts`의 import 구문에 다음 줄을 추가합니다.

```ts
import { localizeRecipientPayload } from './recipient-payload.mjs';
```

기존 함수가 발송 권한, 학교, 수신자, 일시중지 여부를 확인한 뒤 각 구독으로 발송하는 지점에서 본문을 만듭니다. 아래 코드의 `row`는 현재 수신자의 구독 행, `payload`는 기존 함수가 만든 발송용 객체, `record`는 해당 운행 기록입니다. 이미 이름과 정류장의 번역을 조회했다면 `record`에 `student_name_ko`, `student_name_en`, `stop_ko`, `stop_en`을 넣을 수 있습니다.

```ts
const recipientPayload = localizeRecipientPayload(row, payload, record);
const body = JSON.stringify(recipientPayload);
```

기존 Web Push 발송 호출의 본문 인자로 `body`를 사용합니다. 수신자 한 명마다 계산해야 같은 운행 알림을 각 기기 설정에 맞춰 보낼 수 있습니다. 암호화와 발송 옵션, 오류 처리, 만료된 구독 정리는 기존 함수에서 계속 담당합니다.

앱은 각 구독의 `subscription_json.lang`에 `en` 또는 `ko`를 기록합니다. 언어가 저장되지 않은 구독에는 기존 본문을 그대로 반환합니다. 형식 지정에 사용하는 문구 파일 두 개는 앱의 `ride-messages.js`, `ride-alerts.js`와 동일한 버전을 사용합니다.

이 폴더에서 `node verify.mjs`를 실행하면 영어와 한국어, 무작위 문구 전체, 기존 구독, 알림 원문에 대한 회귀 검사를 실행합니다. 실제 함수 프로젝트에서는 `deno check supabase/functions/send-schooltap-push/index.ts`로 연결된 파일을 확인할 수 있습니다. 세 파일 사이에는 확장자를 명시한 상대 경로 import만 있어, 함수 진입점에서 모듈을 import하면 함수와 함께 번들됩니다.
