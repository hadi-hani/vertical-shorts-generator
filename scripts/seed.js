'use strict';

/* Provision an initial account (e.g. the admin) from environment variables.
 * Idempotent: existing accounts are left untouched. The email must ALSO be
 * listed in ADMIN_EMAILS to access the internal /api/admin/* endpoints.
 *
 *   SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD=secret123 npm run seed
 */

const { initDb } = require('../app/db');
const usersRepo = require('../app/db/repositories/users');
const authService = require('../app/services/auth');

const email = (process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD || '';

if (!email || password.length < 8) {
  console.error('Usage: SEED_ADMIN_EMAIL=<email> SEED_ADMIN_PASSWORD=<min-8-chars> npm run seed');
  process.exit(1);
}

initDb();

if (usersRepo.findByEmail(email)) {
  console.log(`User ${email} already exists — nothing to do.`);
  process.exit(0);
}

const user = usersRepo.create({
  email,
  passwordHash: authService.hashPassword(password),
  emailVerified: 1,
});
console.log(`Created user ${user.email} (${user.id}).`);
process.exit(0);