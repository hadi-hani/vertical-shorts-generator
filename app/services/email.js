'use strict';

/* Optional transactional email via Resend or SendGrid HTTP APIs (no SDK).
 * No-op when not configured — verification/reset flows still work locally,
 * they just can't deliver mail. */

const config = require('../config');
const { log } = require('../lib/logger');

function isConfigured() {
  return Boolean(
    config.EMAIL_PROVIDER &&
      ((config.EMAIL_PROVIDER === 'resend' && config.RESEND_API_KEY) ||
        (config.EMAIL_PROVIDER === 'sendgrid' && config.SENDGRID_API_KEY)) &&
      config.EMAIL_FROM
  );
}

async function sendEmail({ to, subject, html }) {
  if (!isConfigured()) {
    log('warn', 'email_not_configured', { to, subject });
    return false;
  }
  try {
    if (config.EMAIL_PROVIDER === 'resend') {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: config.EMAIL_FROM, to, subject, html }),
      });
      if (!res.ok) throw new Error(`resend HTTP ${res.status}`);
    } else {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.SENDGRID_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: config.EMAIL_FROM },
          subject,
          content: [{ type: 'text/html', value: html }],
        }),
      });
      if (!res.ok) throw new Error(`sendgrid HTTP ${res.status}`);
    }
    log('info', 'email_sent', { to, subject });
    return true;
  } catch (err) {
    log('error', 'email_send_failed', { to, subject, message: err.message });
    return false;
  }
}

function verifyHtml(baseUrl, token) {
  const url = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;
  return `<div dir="rtl" style="font-family:sans-serif;line-height:1.8"><h2>تأكيد البريد الإلكتروني</h2><p>اضغط الرابط التالي لتأكيد بريدك:</p><p><a href="${url}">${url}</a></p></div>`;
}

function resetHtml(baseUrl, token) {
  const url = `${baseUrl}/api/auth/reset?token=${encodeURIComponent(token)}`;
  return `<div dir="rtl" style="font-family:sans-serif;line-height:1.8"><h2>إعادة تعيين كلمة المرور</h2><p>اضغط الرابط التالي لإعادة تعيين كلمة المرور (صالحة لساعة واحدة):</p><p><a href="${url}">${url}</a></p></div>`;
}

module.exports = { sendEmail, isConfigured, verifyHtml, resetHtml };