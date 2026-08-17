-- Email verification + password reset tokens. Optional features: no tokens
-- are generated unless the email service is configured.

ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN email_verify_token TEXT;
ALTER TABLE users ADD COLUMN email_verify_expires_at TEXT;
ALTER TABLE users ADD COLUMN password_reset_token TEXT;
ALTER TABLE users ADD COLUMN password_reset_expires_at TEXT;

CREATE INDEX idx_users_verify_token ON users(email_verify_token);
CREATE INDEX idx_users_reset_token ON users(password_reset_token);