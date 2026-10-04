-- CW Operator Trainer sync schema (MariaDB 10.5+)
-- charset: utf8mb4

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_blobs (
  user_id BIGINT UNSIGNED NOT NULL,
  profile_json JSON NOT NULL,
  settings_json JSON NOT NULL,
  schema_version INT NOT NULL DEFAULT 1,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_blobs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS answers (
  user_id BIGINT UNSIGNED NOT NULL,
  answer_id VARCHAR(64) NOT NULL,
  payload_json JSON NOT NULL,
  occurred_at BIGINT NOT NULL COMMENT 'client timestamp ms',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, answer_id),
  KEY idx_answers_user_time (user_id, occurred_at),
  CONSTRAINT fk_answers_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  user_id BIGINT UNSIGNED NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  payload_json JSON NOT NULL,
  started_at BIGINT NOT NULL COMMENT 'client startedAt ms',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, session_id),
  KEY idx_sessions_user_time (user_id, started_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Passkeys (also in schema_passkeys.sql for incremental migrate)
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id VARCHAR(64) NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  purpose ENUM('register', 'login') NOT NULL,
  challenge_b64 VARCHAR(512) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_webauthn_challenges_expires (expires_at),
  CONSTRAINT fk_webauthn_challenges_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  credential_id_b64 VARCHAR(1024) NOT NULL,
  public_key_pem TEXT NOT NULL,
  sign_count INT UNSIGNED NOT NULL DEFAULT 0,
  transports_json JSON NULL,
  name VARCHAR(128) NOT NULL DEFAULT 'Passkey',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_webauthn_credential_id (credential_id_b64(191)),
  KEY idx_webauthn_credentials_user (user_id),
  CONSTRAINT fk_webauthn_credentials_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Password reset + email change (also in schema_auth_mail.sql)
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
