'use strict';

const express = require('express');

const usersRepo = require('../db/repositories/users');
const authService = require('../services/auth');
const emailService = require('../services/email');
const config = require('../config');
const { authLimiter } = require('../middleware/rate-limit');
const { log } = require('../lib/logger');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function validateEmail(email) {
  return EMAIL_RE.test(String(email || '').trim());
}

router.post('/register', authLimiter, async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');

  if (!validateEmail(email)) {
    return res
      .status(400)
      .json({ error: 'invalid_email', message: 'أدخل بريداً إلكترونياً صالحاً' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({
      error: 'weak_password',
      message: 'كلمة المرور يجب ألا تقل عن 8 أحرف',
    });
  }
  if (usersRepo.findByEmail(email)) {
    return res
      .status(409)
      .json({ error: 'email_taken', message: 'هذا البريد الإلكتروني مسجّل مسبقاً' });
  }

  const user = usersRepo.create({
    email,
    passwordHash: authService.hashPassword(password),
    emailVerified: emailService.isConfigured() ? 0 : 1,
  });
  if (emailService.isConfigured()) {
    const token = authService.randomToken();
    usersRepo.updateFields(user.id, {
      email_verify_token: token,
      email_verify_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    await emailService.sendEmail({
      to: user.email,
      subject: 'تأكيد بريدك الإلكتروني — Shorts Captions',
      html: emailService.verifyHtml(config.PUBLIC_BASE_URL || `http://localhost:${config.PORT}`, token),
    });
  }
  req.session.regenerate((err) => {
    if (err) {
      return res.status(500).json({ error: 'session_error', message: 'تعذّر بدء الجلسة' });
    }
    req.session.userId = user.id;
    log('info', 'user_registered', { userId: user.id, email });
    res.status(201).json({ user: authService.toPublicUser(user) });
  });
});

router.post('/login', authLimiter, (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  const user = usersRepo.findByEmail(email);

  if (!user || !authService.verifyPassword(password, user.password_hash)) {
    log('warn', 'login_failed', { email });
    return res
      .status(401)
      .json({ error: 'invalid_credentials', message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
  }

  req.session.regenerate((err) => {
    if (err) {
      return res.status(500).json({ error: 'session_error', message: 'تعذّر بدء الجلسة' });
    }
    req.session.userId = user.id;
    log('info', 'user_login', { userId: user.id, email });
    res.json({ user: authService.toPublicUser(user) });
  });
});

router.post('/logout', (req, res) => {
  log('info', 'user_logout', { userId: req.session && req.session.userId });
  req.session.destroy(() => {
    res.clearCookie('sid');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res
      .status(401)
      .json({ error: 'unauthorized', message: 'يجب تسجيل الدخول أولاً' });
  }
  const user = usersRepo.findById(req.session.userId);
  if (!user) return res.status(401).json({ error: 'unauthorized', message: 'يجب تسجيل الدخول أولاً' });
  res.json({ user: authService.toPublicUser(user) });
});

/* Email verification (link from the verification email). */
router.get('/verify', (req, res) => {
  const token = String((req.query || {}).token || '');
  const user = token ? usersRepo.findByEmailVerifyToken(token) : null;
  const html = (ok, msg) =>
    '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تأكيد البريد</title></head>' +
    `<body style="font-family:sans-serif;text-align:center;padding-top:3rem"><h2>${msg}</h2>` +
    (ok ? '<p><a href="/auth.html">تسجيل الدخول</a></p>' : '') +
    '</body></html>';
  if (!user) return res.status(400).send(html(false, 'الرابط غير صالح أو منتهي الصلاحية.'));
  usersRepo.updateFields(user.id, {
    email_verified: 1,
    email_verify_token: null,
    email_verify_expires_at: null,
  });
  log('info', 'email_verified', { userId: user.id });
  res.send(html(true, 'تم تأكيد بريدك الإلكتروني بنجاح.'));
});

/* Request a password reset email. Always 200 for unknown emails (no
 * enumeration); requires the email service to be configured. */
router.post('/forgot', authLimiter, async (req, res) => {
  if (!emailService.isConfigured()) {
    return res
      .status(503)
      .json({ error: 'email_not_configured', message: 'خدمة البريد غير مضبوطة حالياً' });
  }
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const user = validateEmail(email) ? usersRepo.findByEmail(email) : null;
  if (user) {
    const token = authService.randomToken();
    usersRepo.updateFields(user.id, {
      password_reset_token: token,
      password_reset_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    await emailService.sendEmail({
      to: user.email,
      subject: 'إعادة تعيين كلمة المرور — Shorts Captions',
      html: emailService.resetHtml(
        config.PUBLIC_BASE_URL || `http://localhost:${config.PORT}`,
        token
      ),
    });
  }
  res.json({ ok: true });
});

/* Complete the password reset. */
router.post('/reset', async (req, res) => {
  const token = String((req.body || {}).token || '');
  const password = String((req.body || {}).password || '');
  const user = token ? usersRepo.findByPasswordResetToken(token) : null;
  if (!user) {
    return res
      .status(400)
      .json({ error: 'invalid_token', message: 'الرابط غير صالح أو منتهي الصلاحية' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({
      error: 'weak_password',
      message: 'كلمة المرور يجب ألا تقل عن 8 أحرف',
    });
  }
  usersRepo.updateFields(user.id, {
    password_hash: authService.hashPassword(password),
    password_reset_token: null,
    password_reset_expires_at: null,
  });
  log('info', 'password_reset', { userId: user.id });
  res.json({ ok: true });
});

module.exports = router;