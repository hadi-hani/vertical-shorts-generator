# المرحلة 1 — تقرير: المصادقة + قاعدة البيانات (SQLite)

التاريخ: 2026-08-16
الفرع: `feature/auth-sqlite` (من `saas`)

## ما أُنجز

- نظام مصادقة كامل: تسجيل حساب، تسجيل دخول، تسجيل خروج، جلسات Cookie موقعّرة
  (`express-session` مع مخزن SQLite خاص `app/db/session-store.js`).
- قاعدة بيانات SQLite عبر `better-sqlite3` (v13.0.3) مع سجل ترحيلات
  (`app/db/migrations/001_init.sql`): جدولا `users` و `sessions`.
- تشفير كلمات المرور بـ `crypto.scrypt` المدمج في Node (بدون اعتماديات إضافية).
- ميدل وير `requireAuth` يحمي مسارات التوليد والمخرجات:
  `POST /api/generate/subtitles`, `POST /api/generate-script`,
  `GET /api/jobs`, `GET /api/jobs/:id`, `GET /api/outputs/:file`.
- واجهة مصادقة عربية RTL (`public/auth.html` + `public/js/auth.js`) بنفس
  الهوية البصرية الحالية، مع شريط حالة في الصفحة الرئيسية يعرض البريد وزر الخروج.
- بنية وحدات جديدة: `app/config.js`, `app/db/`, `app/services/auth.js`,
  `app/middleware/auth.js`, `app/routes/auth.js` — معزولة تماماً عن منطق الكابشن.
- `.env.example` أُضيفت له: `SESSIONS_SECRET`, `DB_PATH`, `COOKIE_SECURE`.
- `.gitignore` يستثني ملفات قاعدة البيانات.

## متغيرات البيئة الجديدة

| المتغير | الافتراضي | الوصف |
|---|---|---|
| `SESSIONS_SECRET` | *(عشوائي لكل إقلاع + تحذير)* | توقيع كوكيز الجلسة — إلزامي في الإنتاج |
| `DB_PATH` | `./data/app.db` | موقع ملف قاعدة البيانات |
| `COOKIE_SECURE` | `0` | `1` عبر HTTPS فقط |

## الاختبار اليدوي (سكربت `smoke`) — 21 فحصاً نجحت جميعها

1. `GET /api/health` مفتوح — 200.
2. بدون جلسة: `GET /api/jobs` → 401، `GET /api/outputs/*` → 401،
   `POST /api/generate/subtitles` → 401 (رسالة "Please log in first").
3. `POST /api/auth/register` → 201 + `user.id`؛ البريد المكرر → 409.
4. `GET /api/auth/me` بعد التسجيل → يعيد البريد الصحيح.
5. `POST /api/auth/logout` ثم `/api/auth/me` → 401؛ ثم login يعيد الجلسة → 200.
6. كلمة مرور خاطئة → 401.
7. مسار التوليد (النمطان `word` و `progressive`):
   - إرسال نص عربي قصير → 202 + job id.
   - الوظيفة تكتمل (`completed`)، والملفات `mp4` و `srt` قابلة للتحميل (200).
   - تحميل `mp4` بدون جلسة → 401.
   - `meta.ttsSource = edge-tts`، `wordCount` و `audioDuration` صحيحة.

## أوامر التشغيل (لم تتغير)

```sh
npm install
pip install edge-tts
npm start          # أو: docker compose up --build
```

## ملاحظات

- مسار توليد الكابشن لم يتغير سلوكه: `app/captions.js` والأداتان كما هما،
  والأخبار أُضيفت على مستوى الـ routes فقط.
- جلسات المستخدم تبقى في قاعدة البيانات حتى انتهاء صلاحيتها (7 أيام)،
  ولا تضيع عند إعادة تشغيل الخادم (على عكس الوظائف التي تبقى في الذاكرة مؤقتاً —
  سيتم نقلها إلى DB في المرحلة 2).
- `better-sqlite3` يشحن binaries جاهزة داخل الحزمة، فلا حاجة لتغيير
  `--ignore-scripts` في Dockerfile.
- حدود: الوظائف (`jobs`) ما زالت في الذاكرة وليست مرتبطة بمستخدم — من مهام المرحلة 2.