'use strict';

const express = require('express');

const usersRepo = require('../db/repositories/users');
const authService = require('../services/auth');
const { authLimiter } = require('../middleware/rate-limit');
const { log } = require('../lib/logger');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function validateEmail(email) {
  return EMAIL_RE.test(String(email || '').trim());
}

router.post('/register', authLimiter, (req, res) => {
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

  const user = usersRepo.create({ email, passwordHash: authService.hashPassword(password) });
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

module.exports = router;