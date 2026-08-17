# المرحلة 6 — المراقبة والإدارة (admin-observability)

**الحالة:** مكتملة ومدموجة إلى `saas` · **الاختبار:** 58/58 smoke

## ما أُضيف

### 1. تسجيل منظم (structured logs)
- `app/lib/logger.js`: كل حدث = سطر JSON واحد
  `{"ts":...,"level":...,"event":...,"jobId":...,"userId":...}` مع دالة `redact` كشبكة أمان.
- أحداث الوظائف: `job_start`, `job_completed` (مع `processingMs`), `job_failed`, `job_interrupted`, `job_discarded`.
- أحداث المصادقة: `user_registered`, `user_login`, `login_failed` (البريد فقط), `user_logout`.
- **بدون أي كلمة مرور أو أسرار** — المصادقة لا تسجل كلمة المرور أصلاً، والتسجيل لا يمسّ الجلسات.

### 2. نهايات إدارة داخلية محمية (`ADMIN_EMAILS`)
- `app/middleware/admin.js`: `requireAdmin` = جلسة + بريد ضمن قائمة `ADMIN_EMAILS` (مفصولة بفاصلة في `.env`).
- `GET /api/admin/overview`: عدادات (إجمالي، حسب الحالة، ناجحة/فاشلة، مجموع/متوسط مدة التوليد) + مساحة التخزين (المخرجات + حجم قاعدة البيانات).
- `GET /api/admin/jobs?status=&limit=&offset=`: مراجعة الوظائف عبر كل المستخدمين (فشلت/الطابور) مع تصفية وصفحات.
- غير مصرح → 401، مستخدم عادي → 403.

### 3. فحص صحة شامل `GET /api/health`
- SQLite: `db.ok` (استعلام فعلي `SELECT 1`).
- القرص: `disk.freeBytes/totalBytes/freePercent` عبر `fs.statfsSync` (بدون كشف مسارات).
- FFmpeg: `ffmpegAvailable` (كما كان).

### 4. عدادات
- `app/db/repositories/projects.js`:
  - `stats()`: إجمالي، حسب الحالة، `totalProcessingMs`/`avgProcessingMs` (من `meta.processingMs` عبر `json_extract`).
  - `listForAdmin()`: قائمة بأي حالة مع ترقيم صفحات.
- `processingMs` يُسجَّل عند اكتمال الوظيفة في `meta`.

### 5. نسخ احتياطي دوري لـ SQLite
- `app/services/backup.js`: نسخة عبر واجهة `db.backup()` (آمنة مع WAL) إلى `data/backups/app-<ts>.db`، ثم تقليم لأحدث `BACKUP_KEEP` (افتراضي 5).
- يُنفَّذ عند الإقلاع ثم كل `BACKUP_INTERVAL_MS` (افتراضي 24 ساعة) في `setInterval(...).unref()`.

## إعدادات جديدة (`.env`)
```env
ADMIN_EMAILS=hadi11hani22@gmail.com
BACKUP_DIR=./data/backups
BACKUP_KEEP=5
BACKUP_INTERVAL_MS=86400000
```

## التحقق
- smoke 58/58 (يغطي: health db/disk/ffmpeg، 401/403 للأدمن، overview بإحصاءات ومدة ومساحة، تصفية الحالات).
- تحقق حي على المنفذ 8283: `db.ok:true`, `ffmpegAvailable:true`, `disk.freePercent:51`؛ الأدمن يرفض مجهولاً (401) وغير-أدمن (403)؛ `backup_done` عند الإقلاع.