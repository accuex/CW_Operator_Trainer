-- Password reset + email change tokens (MariaDB)
-- mysql -u USER -p DBNAME < sql/schema_auth_mail.sql

CREATE TABLE IF NOT EXISTS auth_mail_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  purpose ENUM('password_reset', 'email_change') NOT NULL,
  token_hash CHAR(64) NOT NULL COMMENT 'sha256 hex of raw token',
  new_email VARCHAR(255) NULL COMMENT 'target email for email_change',
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_mail_token_hash (token_hash),
  KEY idx_auth_mail_user_purpose (user_id, purpose),
  KEY idx_auth_mail_expires (expires_at),
  CONSTRAINT fk_auth_mail_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
