'use strict';

function requireAuth(req, res, next) {
  const userId = req.session && req.session.userId;
  if (!userId) {
    return res
      .status(401)
      .json({ error: 'unauthorized', message: 'يجب تسجيل الدخول أولاً' });
  }
  req.user = { id: userId };
  next();
}

module.exports = { requireAuth };