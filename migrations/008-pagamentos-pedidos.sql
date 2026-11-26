CREATE TABLE IF NOT EXISTS order_payment_checkouts (
 id CHAR(36) PRIMARY KEY,
 store_id INT NOT NULL,
 visit_id INT NOT NULL,
 provider VARCHAR(30) NOT NULL,
 status VARCHAR(30) NOT NULL DEFAULT 'criado',
 amount INT NOT NULL,
 preference_id VARCHAR(120),
 checkout_url VARCHAR(1000),
 external_payment_id VARCHAR(80),
 method VARCHAR(80),
 credited BOOLEAN NOT NULL DEFAULT FALSE,
 created DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
 updated DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
 INDEX(store_id,status),
 INDEX(visit_id,status),
 UNIQUE(provider,external_payment_id),
 FOREIGN KEY(store_id) REFERENCES stores(id),
 FOREIGN KEY(visit_id) REFERENCES visits(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS order_payment_items (
 checkout_id CHAR(36) NOT NULL,
 order_id INT NOT NULL,
 amount INT NOT NULL,
 PRIMARY KEY(checkout_id,order_id),
 FOREIGN KEY(checkout_id) REFERENCES order_payment_checkouts(id),
 FOREIGN KEY(order_id) REFERENCES orders(id)
) ENGINE=InnoDB;
