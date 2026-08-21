# سجل نتائج تنفيذ Ghadi في Termux

> انسخ خرج الأوامر إلى الحقول المقابلة. لا تضع محتوى ملفات `.env` أو أي مفاتيح أو رموز دخول أو ملفات حسابات خدمة داخل هذا السجل.

## تعريف الجلسة

| الحقل | القيمة |
| --- | --- |
| التاريخ والوقت | |
| الفرع | |
| Git HEAD قبل البدء | |
| إصدار Node | |
| إصدار npm | |
| إصدار Firebase CLI | |

## أوامر الحزمة المحلية

| الترتيب | الأمر | رمز الخروج | النتيجة المختصرة | مسار الدليل/التقرير |
| --- | --- | --- | --- | --- |
| 1 | `./ghadi-safe-foundation-termux.sh inspect` | | | |
| 2 | `CONFIRM_LOCAL_FOUNDATION=1 ./ghadi-safe-foundation-termux.sh apply` | | | |
| 3 | `./ghadi-safe-foundation-termux.sh verify` | | | |
| 4 | `./ghadi-safe-foundation-termux.sh report` | | | |
| 5 | `git diff --stat` | | | |
| 6 | `git diff --check` | | | |

## مخرجات الفحص

```text
ألصق هنا فقط مخرجات inspect وverify وgit diff --check بعد حذف أي سطر يحوي سراً أو رمز دخول.
```

## تحقق الملفات

| ملف أو مكون | الحالة | ملاحظة |
| --- | --- | --- |
| `functions/src/auth.ts` | | |
| `functions/src/policy.ts` | | |
| `functions/src/runs.ts` | | |
| `functions/src/tasks.ts` | | |
| `functions/src/events.ts` | | |
| `functions/src/attachments.ts` | | |
| `functions/src/index.ts` | | |
| `firestore.rules` | | |
| `storage.rules` | | |
| `firebase.json` | | |
| `firestore.indexes.json` | | |

## بوابات لم تنفذ

| البوابة | الحالة | الدليل المطلوب قبل تنفيذها |
| --- | --- | --- |
| إعداد Firebase Authentication ومزود الدخول | لم ينفذ | إعداد يدوي من مالك المشروع واختبار ID token. |
| إعداد الأسرار وتدويرها | لم ينفذ | تأكيد المالك من لوحة موفر الأسرار، بلا نسخ قيم هنا. |
| محاكيات Firebase | لم ينفذ | نجاح `verify` وإعداد Emulator Suite. |
| نشر staging | لم ينفذ | بيئة staging مستقلة ونتائج محاكيات. |
| نشر production | لم ينفذ | مراجعة staging وموافقة إصدار صريحة. |

## قرار الجلسة

اكتب أحد القيمتين فقط: `foundation_verified` أو `blocked_with_evidence`، ثم أرسل هذا الملف مع سجل الأوامر المفلتر للمراجعة التالية.
