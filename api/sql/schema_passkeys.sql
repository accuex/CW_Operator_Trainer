-- Passkeys / WebAuthn (run after schema.sql)

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
