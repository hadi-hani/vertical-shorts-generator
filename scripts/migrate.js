'use strict';

/* Apply pending SQL migrations to the configured SQLite database.
 *   npm run migrate
 * Safe to run repeatedly; applied migrations are recorded in
 * schema_migrations and skipped. */

const { initDb } = require('../app/db');

initDb();
console.log('Migrations up to date.');
process.exit(0);