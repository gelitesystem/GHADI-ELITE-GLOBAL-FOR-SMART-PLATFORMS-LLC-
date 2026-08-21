# Ghadi Firebase Integration Layer

هذه الحزمة طبقة تكامل إضافية وليست مشروعًا جديدًا. تُستخرج محتوياتها بالنسبة إلى جذر المشروع الكنسي `~/g-elite-g-smart-platform/`، مع عدم الكتابة فوق الأصول المحمية.

## ما تم إعادة هندسته

تم تحويل جوهر Ghadi من خادم Express دائم وحالة in-memory وtRPC وDrizzle/MySQL إلى Cloud Function Gen 2 HTTP مع Firebase Admin SDK وFirestore. تستخدم الوظيفة قاعدة البيانات الحالية `G-Elite-G`، وتخزن التشغيلات في `ghadiRuns` والموافقات في `ghadiApprovals`، مع حالة تشغيل وأحداث وتدقيق داخل وثيقة التشغيل.

تمت إزالة اعتماد الواجهة على OAuth/JWT وManus runtime من طبقة التكامل الجديدة، لأن المتطلبات تنص على عدم إضافة مصادقة غير لازمة. لا يقرأ المتصفح Firestore مباشرة؛ جميع عمليات الحالة وGemini تتم في الخادم.

## الملفات الجديدة

| المسار | الوظيفة |
|---|---|
| `functions/package.json` | dependencies وسكربتات Functions Gen 2 |
| `functions/tsconfig.json` | TypeScript strict build |
| `functions/src/firebase.ts` | Firebase Admin وFirestore database ID |
| `functions/src/contracts.ts` | عقود البيانات، Zod validation، limits، redaction |
| `functions/src/engine/ghadi-engine.ts` | Observer/Planner/Guardrails/Approval/Result وFirestore persistence |
| `functions/src/index.ts` | HTTP API وتسجيل Cloud Function `ghadiApi` |
| `public/dashboard.html` | Dashboard ديناميكي مستقل |
| `public/assets/dashboard.css` | CSS responsive عربي/إنجليزي |
| `public/assets/dashboard.js` | اتصال حقيقي بـ`/api/*` دون mock responses |
| `firestore.rules` | منع وصول المتصفح المباشر إلى state |
| `firestore.indexes.json` | الفهارس المطلوبة للاستعلامات |
| `docs/firebase-integration.fragment.json` | إضافات Firebase التي لا يجوز دمجها أعمى |

## API

```text
GET  /api/health
POST /api/submit
GET  /api/runs
GET  /api/runs/:runId
GET  /api/approvals
POST /api/approvals/:approvalId/decision
```

تستخدم أخطاء API الشكل التالي:

```json
{
  "success": false,
  "error": {
    "symbol": "invalid_request",
    "message": "The request payload is invalid."
  }
}
```

## الأسرار

لا توجد قيم أسرار داخل هذه الحزمة. إذا تم تفعيل Gemini، يجب توفير `GEMINI_API_KEY` عبر Firebase Secret Manager أو آلية secrets المعتمدة، مع `GHADI_ENABLE_GEMINI=true` و`GHADI_GEMINI_MODEL` اختياريًا. لا يوضع المفتاح في HTML أو JavaScript أو CSS.

## خطوات الدمج

يجب أولًا فحص `firebase.json` الفعلي الحالي ودمج `functions`, `firestore`, وHosting rewrite بأقل تعديل. لا يُسمح باستبدال الملف كاملًا قبل مقارنة محتواه. يجب أيضًا فحص وجود `functions/` حاليًا؛ إن وُجد، تُدمج ملفات Ghadi داخله بدل إنشاء `functions/functions/`.

بعد التحقق:

```sh
cd ~/g-elite-g-smart-platform/functions
npm install
npm run check
npm run build

cd ~/g-elite-g-smart-platform
firebase deploy --only functions:ghadiApi,firestore,hosting
```

أمر النشر أعلاه إرشادي فقط؛ يجب اعتماد الأمر النهائي بعد فحص `firebase.json` الفعلي واسم الدالة النهائي. لا تنفذ النشر تلقائيًا ضمن حزمة الدمج.

## ملاحظة حول الصفحة الرئيسية

`public/dashboard.html` موجود هنا كطبقة Dashboard مستقلة لأن المتطلبات تسمح بإنشائها إذا أثبت الفحص عدم وجود الملف، لكن ربط زر Dashboard الموجود في `public/index.html` لا يُنفذ على نسخة غير مرفقة من الصفحة. يجب تعديل `public/index.html` الفعلي بإضافة الرابط فقط بعد فحصه، مع الحفاظ على جميع وظائفه الحالية. لا تُستبدل الصفحة ولا تُنقل.
