'use strict';

const express = require('express');

const usersRepo = require('../db/repositories/users');
const authService = require('../services/auth');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function validateEmail(email) {
  return EMAIL_RE.test(String(email || '').trim());
}

router.post('/register', (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');

  if (!validateEmail(email)) {
    return res.status(400).json({ error: 'invalid_email', message: 'Enter a valid email address' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res
      .status(400)
      .json({ error: 'weak_password', message: 'Password must be at least 8 characters' });
  }
  if (usersRepo.findByEmail(email)) {
    return res.status(409).json({ error: 'email_taken', message: 'This email is already registered' });
  }

  const user = usersRepo.create({ email, passwordHash: authService.hashPassword(password) });
  req.session.userId = user.id;
  res.status(201).json({ user: authService.toPublicUser(user) });
});

router.post('/login', (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const password = String((req.body || {}).password || '');
  const user = usersRepo.findByEmail(email);

  if (!user || !authService.verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'invalid_credentials', message: 'Incorrect email or password' });
  }

  req.session.userId = user.id;
  res.json({ user: authService.toPublicUser(user) });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sid');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'unauthorized', message: 'Not logged in' });
  }
  const user = usersRepo.findById(req.session.userId);
  if (!user) return res.status(401).json({ error: 'unauthorized', message: 'Not logged in' });
  res.json({ user: authService.toPublicUser(user) });
});

module.exports = router;
