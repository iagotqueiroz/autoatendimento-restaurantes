ALTER TABLE stores MODIFY subscription VARCHAR(16) NOT NULL DEFAULT 'pendente';
CREATE TABLE IF NOT EXISTS billing_checkouts (
 id CHAR(36) PRIMARY KEY,
 store_id INT NOT NULL,
 provider VARCHAR(30) NOT NULL,
 preference_id VARCHAR(120),
 status VARCHAR(30) NOT NULL DEFAULT 'criado',
 amount INT NOT NULL,
 created DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
 updated DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
 INDEX(store_id,status),
 FOREIGN KEY(store_id) REFERENCES stores(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS billing_payments (
 id INT PRIMARY KEY AUTO_INCREMENT,
 store_id INT NOT NULL,
 checkout_id CHAR(36) NOT NULL,
 provider VARCHAR(30) NOT NULL,
 external_id VARCHAR(120) NOT NULL,
 status VARCHAR(30) NOT NULL,
 amount INT NOT NULL,
 method VARCHAR(80),
 paid_at DATETIME,
 created DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
 UNIQUE(provider,external_id),
 INDEX(store_id,created),
 FOREIGN KEY(store_id) REFERENCES stores(id),
 FOREIGN KEY(checkout_id) REFERENCES billing_checkouts(id)
) ENGINE=InnoDB;
