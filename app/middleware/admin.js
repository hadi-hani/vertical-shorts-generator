'use strict';

const { requireAuth } = require('./auth');
const usersRepo = require('../db/repositories/users');
const config = require('../config');

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    const user = usersRepo.findById(req.user.id);
    if (!user || !config.ADMIN_EMAILS.includes(user.email)) {
      return res.status(403).json({ error: 'forbidden', message: 'غير مصرح' });
    }
    req.user = { id: user.id, email: user.email };
    next();
  });
}

module.exports = { requireAdmin };