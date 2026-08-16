# المرحلة 0 — تقرير: تقوية المصادقة (auth-hardening)

التاريخ: 2026-08-16
الفرع: `feature/auth-hardening` (من `saas`)

## ما أُنجز

1. **SESSIONS_SECRET Fail-fast في الإنتاج** (`app/config.js`):
   - مع `NODE_ENV=production` وسر فارغ → رفض بدء التشغيل برسالة واضحة.
   - في غير الإنتاج: يبقى السر العشوائي + تحذير (لم تتغير تجربة التطوير).
2. **TRUST_PROXY** (`app/config.js` + `app/server.js`):
   - `app.set('trust proxy', <TRUST_PROXY>)`؛ متغير جديد `.env` افتراضي `0` —
   - ضروري لـ Secure cookies و rate limiting بالـ IP خلف Nginx/Cloudflare.
3. **Rate limiting** (`app/middleware/rate-limit.js`):
   - `express-rate-limit` v8 على `POST /api/auth/register` و `POST /api/auth/login`
     (نافذة 15 دقيقة، حد 20 طلباً، استجابة JSON عربية، `standardHeaders`).
   - مخزن في الذاكرة — مناسب للعملية الواحدة الحالية.
4. **تدوير Session ID** (`app/routes/auth.js`):
   - `req.session.regenerate()` قبل تعيين `userId` في التسجيل والدخول — يمنع
     session fixation.
5. **تنظيف الجلسات المنتهية** (`app/db/session-store.js` + `app/server.js`):
   - `cleanupExpired()` يحذف الصفوف المنتهية، ومؤقت كل ساعة مع `.unref()`.
6. **رسائل عربية** (`app/middleware/auth.js` + `app/routes/auth.js`):
   - 401: "يجب تسجيل الدخول أولاً"، invalid_email، weak_password، email_taken،
     invalid_credentials، too_many_requests — كلها عربية.
7. **سكربت اختبار مكرر** (`scripts/smoke-auth.js` + `npm run smoke`):
   - Node، يقلع الخادم كعملية فرعية على منفذ اختبار مع DB/Mخرجات/عمل مؤقتة
     (`fs.mkdtemp` + تجاوز `DB_PATH`/`OUTPUT_DIR`/`WORK_DIR`)، وينظّف بعدها.
   - يتطلب ffmpeg + edge-tts (نفس متطلبات التطبيق).

## تغييرات الإعدادات الجديدة

| المتغير | الافتراضي | الوصف |
|---|---|---|
| `TRUST_PROXY` | `0` | عدد طبقات الـ reverse proxy الموثوقة (مثلاً `1`) |
| `OUTPUT_DIR` / `WORK_DIR` | `data/output` / `data/work` | قابلان للتجاوز عبر env (للسكربت الاختباري) |
| `NODE_ENV=production` | — | يجعل `SESSIONS_SECRET` إلزامياً (Fail-fast) |

## الاختبار

- **`npm run smoke` — 23/23 فحصاً نجحت**:
  - 401 للمجهول (jobs / outputs / generate).
  - تسجيل → 201 + cookie؛ بريد مكرر → 409؛ me → بريد صحيح.
  - خروج → me → 401؛ دخول → 200 (مع تدوير الـ cookie)؛ كلمة مرور خاطئة → 401.
  - النمطان `word` و `progressive`: إرسال → 202 → اكتمال → تنزيل mp4/srt (200) →
    حظر التنزيل بدون جلسة (401).
- **Fail-fast مؤكد**: `NODE_ENV=production SESSIONS_SECRET=` → خطأ عند التحميل؛
  مع سر → يعمل.
- **Rate limiting مؤكد**: 25 طلباً متتالياً → الـ 21+ يرد 429.
- **مسار الكابشن**: لم يُمَس (`captions.js` والأداتان كما هما) — النمطان أنتجا
  فيديوهات بنجاح عبر الـ smoke.

## ملاحظات
- أوامر التشغيل كما هي: `npm install && npm start`، والجديد `npm run smoke`.
- خادم محلي قديم (كود المرحلة 1) كان يعمل على 8283 أثناء التطوير — أُوقف؛
  بياناته (app.db، output) محفوظة في مكانها.
- تنظيف الجلسات المنتهية يستخدم توقيت داخل العملية (غير موزّع) — كافٍ للعملية الواحدة.