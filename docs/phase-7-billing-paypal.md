# المرحلة 7 — الدفع عبر PayPal (billing-paypal)

**الحالة:** مكتملة ومدموجة إلى `saas` · **الاختبار:** 70/70 smoke

## ما أُضيف

### نموذج الخطط
- ترحيل `004_billing.sql`:
  - `users.plan` (`free`/`premium`، افتراضي `free`).
  - جدول `subscriptions` (معرّف اشتراك PayPal، المستخدم، الحالة، بريد المشترك، `UNIQUE(user_id)`).
  - جدول `webhook_events` للمعرفات — **idempotency** ضد إعادة إرسال الأحداث.
- `config.planLimit(plan)`: `free` → `FREE_MONTHLY_VIDEO_LIMIT` (10)، `premium` → `PREMIUM_MONTHLY_VIDEO_LIMIT` (200).

### خدمة PayPal (`app/services/paypal.js`) — بلا أي مكتبات إضافية (global fetch)
- رمز وصول مؤقت (`/v1/oauth2/token`) مع تخزين مؤقت.
- إنشاء اشتراك (`/v1/billing/subscriptions`) مع `custom_id=userId` لربط الاشتراك بالمستخدم، و`return_url`/`cancel_url`.
- إلغاء اشتراك، والتحقق من توقيع الـ webhook (`/v1/notifications/verify-webhook-signature`).
- الأوضاع: `sandbox` | `live` | **`mock`** (يُجرّب التدفق كاملاً دون حساب PayPal).

### النهايات (`app/routes/billing.js`)
- `POST /api/billing/checkout` (auth): ينشئ الاشتراك ويعيد `{ subscriptionId, approvalUrl }`؛ `409` إن كان مفعلاً؛ `503` إذا لم يُجهَّز الدفع.
- `POST /api/billing/cancel` (auth): يلغي اشتراك PayPal ويُعيد الخطة المجانية.
- `POST /api/billing/webhook` (**بلا مصادقة** — التحقق بالتوقيع): أحداث التفعيل/التجديد/الإلغاء/الاسترداد تُحدِّث الخطة. الـ webhook هو **مصدر الحقيقة**. التوقيع يُتحقق قبل أي تغيير؛ الحدث المُكرَّر يُتجاهل.
- صفحات عربية بسيطة `GET /api/billing/success` و`GET /api/billing/cancel`.

### التكامل مع الحصص
- `buildUsageView`: يعيد `plan` الحقيقي والحدّ من الخطة + `subscription.status` (يظهر في `/api/usage`).
- `POST /api/generate/subtitles`: يقرأ الحدّ من خطة المستخدم (المدفوعة تتجاوز المجانية فوراً) مع رسالة 429 عربية تحدّد الرقم وتقترح الترقية.
- `/api/admin/overview` يعيد `billing.premiumUsers`.

### الواجهة
- بطاقة الحصة في `/projects` تعرض اسم الخطة وزر:
  - خطة مجانية → **«ترقية إلى المدفوعة»** → توجيه إلى PayPal.
  - خطة مدفوعة → **«إلغاء الاشتراك»** (بتأكيد).

### الأمان
- لا تُسجَّل كلمات مرور/أسرار؛ الأسرار في `.env` فقط.
- توقيع الـ webhook إلزامي؛ لا اعتماد على بيانات من المتصفح (الخطط/الحدود تُدار على الخادم).
- `rawBody` يُلتقط لتحقق التوقيع من البايتات الأصلية.

## الإعداد المطلوب للدفع الحقيقي
في `.env` (Sandbox للتجربة، ثم Live مع حساب Business):
```env
PAYPAL_MODE=sandbox            # أو live
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_PLAN_ID=...             # خطة اشتراك شهرية تُنشأ في لوحة PayPal
PAYPAL_WEBHOOK_ID=...          # معرّف webhook من لوحة PayPal
PAYPAL_BASE_URL=https://app.example.com
```
لتجربة سريعة دون حساب: `PAYPAL_MODE=mock` + أي `PAYPAL_PLAN_ID`.

## التحقق
- smoke **70/70** (يغطي: 401، checkout → approval URL، تفعيل webhook → خطة premium وحد 200 → توليد يتجاوز الحصة المجانية → webhook مكرر idempotent → إلغاء → عودة free → 400 عند الإلغاء بلا اشتراك + عدادات الأدمن).
- تحقق حي على 8283: بدون مفاتيح → checkout يعيد `503 paypal_not_configured` برسالة عربية؛ `/api/usage` يعيد `plan/limit/consumed/remaining/subscription`.