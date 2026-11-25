CREATE TABLE IF NOT EXISTS trials (
  store_id INT PRIMARY KEY,
  started DATE NOT NULL,
  ends DATE NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id)
) ENGINE=InnoDB;
INSERT INTO trials (store_id,started,ends)
SELECT s.id, DATE_SUB(s.expires, INTERVAL 14 DAY), s.expires
FROM stores s LEFT JOIN trials t ON t.store_id=s.id
WHERE s.subscription='teste' AND t.store_id IS NULL;
