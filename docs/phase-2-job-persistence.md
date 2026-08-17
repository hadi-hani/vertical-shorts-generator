# المرحلة 2 — تقرير: استمرارية المهام (job-persistence)

التاريخ: 2026-08-17
الفرع: `feature/job-persistence` (من `saas`)

## ما أُنجز

- **الـ worker يقرأ من قاعدة البيانات**: أُزيل خريطة الذاكرة `jobs` تماماً؛
  SQLite هو مصدر الحقيقة الوحيد. الإرسال ينشئ صفاً في `projects` (queued) ثم
  `enqueue(id)` يضيف المهمة إلى طابور sequential — والطابور يقرأ بيانات المهمة
  من DB (`processJobById` → `processJob(row)`).
- **استرجاع العالق عند الإقلاع**: أي صف في الحالة `queued` أو `processing` عند
  بدء التشغيل يُعلَّم `interrupted` مع `errorCode=interrupted` ورسالة توضح أنه
  تُرك من إعادة تشغيل سابقة (`recoverStaleJobs()` داخل `boot()`).
- **حد زمني لكل خطوة فعلي**: `runProcess` الآن يملك `timeoutMs` حقيقياً يقتل
  العملية الفرعية بـ SIGKILL ويرفض بالكود `process_timeout` (سابقاً كانت `timeout`
  تُمرَّر إلى `spawn` التي تتجاهلها — أي أن مهلات edge-tts/whisper/ffmpeg لم تكن
  تعمل إطلاقاً). المهلات أصبحت `timeoutMs` في المواضع الثلاثة.
- **حد زمني كلي لكل وظيفة**: `JOB_TIMEOUT_MS` (افتراضي 10 دقائق، قابل للتكوين
  عبر البيئة). عند تجاوزه تُقتل العملية الفرعية النشطة ويُعلَّم المشروع `failed`
  مع `errorCode=job_timeout`.
- **مراحل التقدم**: `meta.stage` يُحدَّث خلال المعالجة: `start` → `tts` →
  `captions` → `render` → `done` (دون فقدان بقية meta عبر دمج جزئي في المخزن).
- **`/api/health`** يعتمد الآن على DB (`jobCount` + إحصاء الحالات).
- `projectsRepo.update` يدمج `meta` مع السابق بدلاً من استبدالها، وأضيف
  `statusCounts()`.

## الاختبار

- **`npm run smoke` — 31/31 فحصاً نجحت** (أُضيف فحص أن المشروع المكتمل يحمل
  `meta.stage === 'done'`، وبقية فحوصات العزل والتدفق كما هي).
- **الاسترجاع (اختبار منفصل)**: إدراج صف `queued` مباشرة في DB ثم إعادة تشغيل
  الخادم → `RECOVERY OK` (يظهر `interrupted`).
- **الحد الزمني (اختبار منفصل)**: `JOB_TIMEOUT_MS=1000` → المهمة تفشل
  بـ `TIMEOUT OK` (`failed` + `errorCode=job_timeout`)، مع قتل العملية الفرعية.
- **الثبات**: المشاريع المكتملة تبقى (المرحلة 1) — التحقق من غير المرحلة 2.

## ملاحظات
- الحالات: `queued`, `processing`, `completed`, `failed`, `interrupted`.
- `JOB_TIMEOUT_MS` مضاف إلى `.env.example` وجدول الإعدادات في README.
- طابور المعالجة ما زال sequential (عامل واحد) — البناء جاهز للانتقال لاحقاً إلى
  معالجة متوازية أو طابور متعدد العمال إذا لزم.