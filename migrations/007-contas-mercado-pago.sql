CREATE TABLE IF NOT EXISTS store_payment_accounts (
 id INT PRIMARY KEY AUTO_INCREMENT,
 store_id INT NOT NULL,
 provider VARCHAR(30) NOT NULL,
 external_user_id VARCHAR(80) NOT NULL,
 access_token_encrypted TEXT NOT NULL,
 refresh_token_encrypted TEXT,
 scope VARCHAR(500),
 expires_at DATETIME,
 status VARCHAR(20) NOT NULL DEFAULT 'conectada',
 created DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
 updated DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
 UNIQUE(store_id,provider),
 UNIQUE(provider,external_user_id),
 FOREIGN KEY(store_id) REFERENCES stores(id)
) ENGINE=InnoDB;
