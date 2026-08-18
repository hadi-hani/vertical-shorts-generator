# 🚀 دليل إطلاق Beta السريع (Fast Beta Launch)

**الهدف**: نشر التطبيق على سيرفر VPS عام خلال أقل وقت، مع فواتير PayPal Sandbox
وحماية backups، **بدون أي ميزات جديدة**.

**النطاق**: فرع `feature/production-readiness` → يُدمج إلى `saas` بعد المراجعة.

---

## 1. البنية المستهدفة

```
المتصفح
   │  HTTPS (شهادة Cloudflare مجانية)
   ▼
Cloudflare  →  caption.teachhorizon.online  (A record + Proxy نارنجي)
   │  ينتهي TLS هنا، يمرر فقط المنافذ 80/443
   ▼
VPS  →  Caddy/Nginx (reverse proxy)  :80/443
   │  reverse_proxy → 127.0.0.1:8283
   ▼
Docker  →  shorts-video (docker-compose)  :8283
   │  volume: ./data (قاعدة البيانات + outputs + backups)
```

لماذا Caddy/Nginx؟ لأن Cloudflare النارنجي يمرر **80/443 فقط**، والتطبيق يستمع
على **8283** — فيقف الـ proxy أمامه. إعداد SSL في Cloudflare = **Flexible**
(لا حاجة لشهادة على السيرفر لأن Cloudflare ينهي TLS).

---

## 2. المتغيرات الضرورية (`/opt/shorts/.env` على السيرفر)

| المتغير | مطلوب؟ | قيمة Beta الموصى بها | شرح |
|---------|--------|----------------------|-----|
| `NODE_ENV` | ✅ | `production` | يفعّل الفحوص الصارمة ويطالب بالأسرار |
| `SESSIONS_SECRET` | ✅ | سلسلة عشوائية 64 بايت | `openssl rand -hex 32` — يُرفض الإقلاع بدونه في production |
| `GEMINI_API_KEY` | ✅ | مفتاحك | مطلوب لتفعيل توليد السكربت تلقائياً |
| `PAYPAL_MODE` | ✅ | `sandbox` | **ليس live** |
| `PAYPAL_CLIENT_ID` | ✅ | من لوحة PayPal Sandbox | |
| `PAYPAL_CLIENT_SECRET` | ✅ | من لوحة PayPal Sandbox | |
| `PAYPAL_PLAN_ID` | ✅ | من Sandbox | |
| `PAYPAL_WEBHOOK_ID` | ✅ | من Sandbox | هوية التوقيع |
| `PAYPAL_BASE_URL` | ✅ | `https://caption.teachhorizon.online` | العنوان العام للعودة بعد الدفع |
| `PUBLIC_BASE_URL` | ✅ | `https://caption.teachhorizon.online` | روابط البريد (تحقق/إعادة تعيين) |
| `COOKIE_SECURE` | ✅ | `1` | لأن الاتصال HTTPS |
| `TRUST_PROXY` | ✅ | `1` | خلف proxy واحد (Cloudflare) |
| `ADMIN_EMAILS` | ✅ | بريدك | صلاحيات `/api/admin/*` |
| `PORT` | اختياري | `8283` | داخل الحاوية |
| `HOST` | اختياري | `0.0.0.0` | |
| `FREE_MONTHLY_VIDEO_LIMIT` | اختياري | `10` | الحصة المجانية |
| `PREMIUM_MONTHLY_VIDEO_LIMIT` | اختياري | `200` | الحصة المدفوعة |
| `MAX_JOBS_PER_USER` | اختياري | `2` | حد جوبات المستخدم المتزامنة |
| `MAX_QUEUED_JOBS` | اختياري | `50` | حد الطابور العالمي |
| `MAX_PROJECTS_PER_USER` | اختياري | `100` | حد صفوف المشاريع |
| `BACKUP_DIR` | اختياري | `./data/backups` | يُنسخ احتياطياً تلقائياً |
| `BACKUP_KEEP` | اختياري | `5` | عدد النسخ المحتفظ بها |
| `BACKUP_INTERVAL_MS` | اختياري | `86400000` | كل 24 ساعة + عند الإقلاع |
| `EMAIL_*` / `SENTRY_DSN` / `REDIS_URL` / `S3_*` / `CORS_ORIGIN` | اختياري | — | لاحقاً حسب الحاجة |

> نسخ احتياطي للـ `.env` لا يُرفع إلى git أبداً — هو في `.gitignore`.

---

## 3. الأمر الصحيح لـ Docker

### الخيار أ: docker compose (موصى به)

```bash
cd /opt/shorts
cp .env.example .env          # ثم عبّئ القيم من الجدول أعلاه
mkdir -p data
docker compose up -d --build
docker compose ps             # health = healthy
docker compose logs -f        # تتبع
```

### الخيار ب: docker run مباشر

```bash
docker build -t shorts-video .
docker run -d --name shorts \
  --env-file .env \
  -p 8283:8283 \
  -v /opt/shorts/data:/app/data \
  --restart unless-stopped \
  shorts-video
```

> الحاوية `docker-compose.yml` جاهزة بالفعل: volume `./data:/app/data` دائم،
> `restart: unless-stopped`، healthcheck على `/api/health`، و `env_file: .env`.

**التحقق من healthcheck** (خطوة يدوية على السيرفر — لا تتوفر أدوات docker على
جهاز التطوير):

```bash
docker inspect --format='{{.State.Health.Status}}' shorts   # → healthy
curl -fsS http://127.0.0.1:8283/api/health                  # → {"status":"ok",...}
```

---

## 4. إعداد Cloudflare + reverse proxy

### 4.1 Cloudflare (لوحة Cloudflare → DNS)

1. أضف سجل **A**:
   - الاسم: `caption`
   - المحتوى: **IP الـ VPS العام** (مثال `154.253.63.170` — استبدله بـ IP سيرفرك)
   - Proxy status: **Proxied** (النارنجي **ON**)
2. **SSL/TLS → Overview**: وضع **Flexible** (Cloudflare ينهي TLS أمام السيرفر).
3. انتظر دقيقة حتى يُنتشر السجل، ثم تحقق: `curl -fsSI https://caption.teachhorizon.online`

### 4.2 Caddy (موصى به — بسطرين)

```bash
sudo apt-get install -y caddy
```

`/etc/caddy/Caddyfile`:

```
caption.teachhorizon.online {
    reverse_proxy 127.0.0.1:8283
}
```

```bash
sudo systemctl enable --now caddy
```

### 4.3 بديل Nginx

```bash
sudo apt-get install -y nginx
```

`/etc/nginx/sites-available/caption`:

```nginx
server {
    listen 80;
    server_name caption.teachhorizon.online;

    location / {
        proxy_pass http://127.0.0.1:8283;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/caption /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

> لا مانع من فتح المنفذ 8283 فقط محلياً (التطبيق لا يتعرض للإنترنت مباشرة).

---

## 5. PayPal Sandbox Webhook

**رابط الويبوك**: `https://caption.teachhorizon.online/api/billing/webhook`

### إنشاء الويبوك (لوحة PayPal Developer → Sandbox → Webhooks)

1. افتح [developer.paypal.com](https://developer.paypal.com) → **Apps & Credentials**
   → اختر تطبيق Sandbox → سجّل **Client ID / Secret**.
2. **Billing Plans** (أو عبر `scripts/setup-paypal.js`) → أنشئ خطة شهرية
   (مثال 9.99 USD) → ضع id في `PAYPAL_PLAN_ID`.
3. **Webhooks → Add Webhook**:
   - **Webhook URL**: `https://caption.teachhorizon.online/api/billing/webhook`
   - فعّل كل الأحداث:
     - `BILLING.SUBSCRIPTION.ACTIVATED`
     - `BILLING.SUBSCRIPTION.RE-ACTIVATED`
     - `BILLING.SUBSCRIPTION.RENEWED`
     - `BILLING.SUBSCRIPTION.CANCELLED`
     - `BILLING.SUBSCRIPTION.EXPIRED`
     - `BILLING.SUBSCRIPTION.SUSPENDED`
     - `BILLING.SUBSCRIPTION.PAYMENT.FAILED`
     - `PAYMENT.SALE.COMPLETED`
     - `PAYMENT.SALE.REFUNDED`
     - `PAYMENT.SALE.REVERSED`
     - `PAYMENT.SALE.DENIED`
   - انسخ **Webhook ID** إلى `PAYPAL_WEBHOOK_ID` في `.env`.
4. أعد تشغيل الحاوية: `docker compose restart`

> التطبيق يتحقق من توقيع كل طلب بـ `PAYPAL_WEBHOOK_ID` قبل أي تغيير، ويتجاهل
> الأحداث المكررة (idempotent). يمكنك في لوحة PayPal ضغط **Send test notification**
> وستجد سجل 200 في سجل الويبوك.

---

## 6. خطوات اختبار الاشتراك والإلغاء

المتطلبات: حساب Sandbox **buyer** (لوحة PayPal → Sandbox → Accounts).

1. أنشئ حساباً في التطبيق: `/register`.
2. افتح صفحة الفوترة → اشترك (سيوجهك لـ PayPal Sandbox) → **وافق** بالحساب
   التجريبي (اضغط Agree/Approve).
3. بعد العودة إلى `PAYPAL_BASE_URL` تُفعَّل الخطة تلقائياً بالـ webhook:
   - تحقق: `/api/usage` يعرض `plan: premium` و `limit: 200`.
4. في لوحة PayPal: **Billing → Subscriptions →** اختر الاشتراك → **Cancel**.
5. تحقق: `/api/usage` يعود إلى `plan: free` و `limit: 10`.
6. (اختياري) **Payment failure**: من حساب الـ buyer عطّل طريقة الدفع ثم أرسل
   `Send test notification` لـ `BILLING.SUBSCRIPTION.PAYMENT.FAILED` → يجب
   تخفيض الخطة.

**التحقق من سجل الويبوك**: سجلات الحاوية `docker compose logs shorts-video`
تظهر `webhook activate ... plan=premium` / `webhook deactivate ... plan=free`.

---

## 7. خطوات اختبار Backup / Restore

### النسخ الاحتياطي التلقائي

```bash
# بعد الإقلاع ثم كل BACKUP_INTERVAL_MS، تظهر نسخة في:
ls -la /opt/shorts/data/backups/       # app-<timestamp>.db (آخر 5)

# فحص سلامة أي نسخة:
sqlite3 /opt/shorts/data/backups/app-<timestamp>.db "PRAGMA integrity_check;"   # → ok
```

### تجربة Restore (على نسخة تجريبية — لا تُفسد الإنتاج)

```bash
# 1. أوقف الحاوية
docker compose stop

# 2. استعد من آخر نسخة (بداخل مجلد المشروع)
BACKUP_FILE=./data/backups/app-<timestamp>.db DB_PATH=./data/app.db node scripts/restore.js --yes

# 3. أعد التشغيل وتأكد من بياناتك
docker compose up -d
```

`scripts/restore.js` يفرض `--yes`، يشغّل `PRAGMA integrity_check` على المصدر،
وينسخ بشكل ذرّي (temp + rename). **لا يستعيد ملفات outputs** — البيانات وحدها.

---

## 8. Checklist الإطلاق — Go / No-Go

| # | المعيار | الحالة | كيف تتحقق |
|---|---------|--------|-----------|
| 1 | `npm test` ناجح | ✅ محلياً | `npm test` → 16 وحدة + 5 حدود + 3 webhook-http كلها خضراء |
| 2 | `npm run smoke` ناجح | ✅ محلياً | `npm run smoke` → 80/80 |
| 3 | المنتج يولد MP4/SRT/ASS | ✅ محلياً (smoke يُصدّر فعلياً) | انظر `scripts/smoke-auth.js` → تنزيل `jobId.mp4/.srt/.ass` |
| 4 | Docker healthcheck ينجح | ⬜ **يدوياً على السيرفر** | `docker compose ps` → `healthy` + `curl /api/health` |
| 5 | PayPal Sandbox webhook يصل ويتحقق | ⬜ **يدوياً** | أنشئ الويبوك (قسم 5) → Send test notification → سجل 200 |
| 6 | Subscription activate/cancel يعملان | ✅ محلياً | قسم 6 (webhook mock في smoke يفعّل/يلغي/يرتد) — أعدها على Sandbox الفعلي |
| 7 | Backup restore مجرَّب | ✅ محلياً | `test/backup.test.js` + تجربة `restore.js` (قسم 7) |

**Go**: كل البنود ✅ أو ⬜ مكتملة يدوياً على السيرفر.
**No-Go**: أي بند ⬜ غير مُتحقق، أو `PAYPAL_MODE=live`، أو أسرار حقيقية في الريبو.

---

## 9. بعد الإطلاق (ممنوع في Beta)

- ❌ **لا `PAYPAL_MODE=live`** — يلزم أولاً تطبيق Live حقيقي + خطة + webhook
  واختبار شراء فعلي.
- ❌ لا مفاتيح إنتاج حقيقية في أي ملف مرفوع إلى git.
- ❌ لا ميزات جديدة أو refactor — اكتب issues وادمجها في سباق لاحق.