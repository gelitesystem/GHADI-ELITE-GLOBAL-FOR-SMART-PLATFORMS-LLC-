# ملخص المتطلبات النهائية بعد قراءة الملفات الثلاثة

## القرار المعماري

المطلوب هو **إعادة هيكلة كاملة للمشروع فعليًا**، وليس تحليل الأرشيف أو نسخه كما هو، وليس إنشاء مشروع جديد. الأرشيف مصدر لمكونات Ghadi ووظائفه، بينما جذر Termux الحالي هو مصدر الحقيقة.

الهدف النهائي هو تطبيق Firebase متماسك يعمل من:

```text
~/g-elite-g-smart-platform/
```

ويستخدم:

```text
Firebase Hosting
+ Firebase Cloud Functions Gen 2
+ Firestore database: G-Elite-G
+ Google AI / Gemini عبر @google/genai
+ Ghadi Agent Engine
```

## الأصول المحمية

لا يجوز حذف أو استبدال أو إعادة تسمية أو نقل:

```text
public/index.html
public/platform/index.html
public/image/
firebase.json
.firebaserc
.gitignore
README.md
package-lock.json
```

الصفحة الرئيسية الحالية تحتوي أصلًا على مدخل/واجهة Dashboard. لا يجوز افتراض وجود `public/dashboard.html`؛ إذا لم يوجد بعد فقرار إنشائه يعتمد على الفحص الحقيقي. كما لا يجوز إنشاء `public/photo/` أو أي دليل صور بديل إذا كان الاسم الحقيقي هو `public/image/`.

## ما يجب التخلص منه أثناء إعادة الهندسة

لا يُنقل تصميم الأرشيف كما هو لأنه يعتمد على:

- خادم Express دائم بدل Firebase Functions.
- tRPC وManus OAuth/JWT، بينما المتطلبات تمنع إضافة OAuth/JWT/Firebase Auth إلا إذا أثبت الفحص ضرورة لا يمكن التخلص منها.
- Drizzle/MySQL، بينما الهدف Firestore الحالي `G-Elite-G`.
- Forge/S3 storage، بينما المطلوب تكامل Firebase/Google Cloud مناسب.
- حالة in-memory، بينما المطلوب حالة تشغيل وذاكرة وتدقيق durable في Firestore.
- runtime ومكونات Manus الخاصة ببيئة الإنشاء.

## الوظائف التي يجب الحفاظ عليها وإعادة بنائها

يجب أن يحتفظ النظام بالوظائف الحقيقية التي ظهرت في الأرشيف، لكن بعد تحويلها إلى بنية Firebase:

1. استقبال نية المستخدم.
2. Observer لفهم الطلب وحدوده.
3. Planner لبناء خطة منظمة structured data.
4. Workers محدودة الصلاحيات.
5. Tools مصنفة إلى `read` و`write` و`high_risk`.
6. بوابة موافقة بشرية للإجراءات الحساسة.
7. Verification/Critic قبل النتيجة.
8. Final result لا يدعي تكاملًا لم يحدث.
9. Firestore لتخزين tasks/runs/events/approvals/memory/audit بالحد الأدنى الضروري.
10. Gemini اختياري ومتكامل server-side فقط عبر `@google/genai`، مع model configurable.
11. حدود `max_steps` و`max_tool_calls` و`max_runtime` و`max_retries` وإيقاف آمن موثق.
12. idempotency ومنع تكرار العمليات الحساسة وFirestore triggers.
13. API نظيف عبر Cloud Functions، دون اختلاق endpoints أو responses.
14. Dashboard عربي/إنجليزي، RTL/LTR، responsive، ويعرض الحالة الحقيقية للـbackend وFirestore وGemini وRAG.
15. حماية الأسرار وعدم وضع المفاتيح داخل HTML/CSS/JavaScript أو Git.
16. أخطاء API موحدة دون تسريب stack traces أو أسرار.
17. اختبارات syntax/import/build/API/Firestore/Gemini/guardrails.

## المخرجات النهائية المطلوبة

بعد التنفيذ يجب تسليم تقرير يتضمن:

- الشجرة المكتشفة.
- المشكلات والتعارضات والبنية القديمة.
- المعمارية المختارة وسبب اختيارها.
- الملفات التي أُنشئت.
- الملفات التي عُدلت.
- الملفات المحمية التي بقيت كما هي.
- الملفات المستبعدة أو المحذوفة عمدًا مع السبب.
- dependencies المضافة.
- تغييرات `firebase.json` إن وجدت.
- متطلبات Firestore.
- الأسرار المطلوبة دون قيمها.
- أوامر التثبيت.
- أوامر النشر بعد فحص التكوين الفعلي.
- خطوات Firebase Console اليدوية المتبقية.
- نتائج التحقق الفعلية فقط، دون ادعاء نجاح نشر لم يحدث.

## قيد التنفيذ الحالي

الملفات المرفقة تعطي وصفًا تفصيليًا لشجرة المشروع، لكنها لا تحتوي النسخ الفعلية لمحتويات `public/index.html` و`public/platform/index.html` و`firebase.json` و`.firebaserc` و`package-lock.json` من Termux. لذلك لا يجوز تعديل هذه الملفات أو الادعاء بإتمام الدمج النهائي قبل توفيرها أو تنفيذ العمل داخل بيئة Termux نفسها. يمكن تنفيذ طبقة التكامل الجديدة في مساحة staging، لكن الدمج النهائي مع الأصول المحمية يتطلب محتواها الفعلي للتحقق من imports والمسارات وعدم كسر الصفحات الحالية.
