-- =====================================================================
-- Exp 9 | Project Phase III : Advanced Database Programming
-- Run with the mysql CLI / Workbench (needs DELIMITER support):
--   mysql -u root -p coffee_tracker < 03_programming_phase3.sql
-- =====================================================================
USE coffee_tracker;

DROP TABLE IF EXISTS lot_price_log;
CREATE TABLE lot_price_log (
  log_id     INT AUTO_INCREMENT PRIMARY KEY,
  lot_id     INT NOT NULL,
  old_price  DECIMAL(10,2),
  new_price  DECIMAL(10,2),
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_log_lot FOREIGN KEY (lot_id) REFERENCES lot(lot_id)
) ENGINE=InnoDB;

-- ============================== VIEWS ================================
CREATE OR REPLACE VIEW v_lot_stock AS
SELECT l.lot_id, l.lot_code, f.farm_name, l.quantity_kg,
       COALESCE(SUM(r.green_kg),0)                     AS roasted_green_kg,
       l.quantity_kg - COALESCE(SUM(r.green_kg),0)     AS stock_remaining_kg,
       CASE WHEN l.quantity_kg - COALESCE(SUM(r.green_kg),0) < 10
            THEN 'LOW' ELSE 'OK' END                   AS stock_status
FROM lot l
JOIN farm f ON f.farm_id = l.farm_id
LEFT JOIN roast_log r ON r.lot_id = l.lot_id
GROUP BY l.lot_id, l.lot_code, f.farm_name, l.quantity_kg;

CREATE OR REPLACE VIEW v_lot_leaderboard AS
SELECT l.lot_id, l.lot_code, f.farm_name, l.process,
       COUNT(sc.score_id)              AS sheets,
       ROUND(AVG(sc.total_score), 2)   AS avg_score,
       RANK() OVER (ORDER BY AVG(sc.total_score) DESC) AS rank_no
FROM lot l
JOIN farm f            ON f.farm_id = l.farm_id
JOIN roast_log r       ON r.lot_id = l.lot_id
JOIN cupping_sample cs ON cs.roast_id = r.roast_id
JOIN cupping_score sc  ON sc.sample_id = cs.sample_id
GROUP BY l.lot_id, l.lot_code, f.farm_name, l.process;

CREATE OR REPLACE VIEW v_score_traceability AS
SELECT sc.score_id, sc.cupper_name, sc.total_score, cs.blind_code, ses.session_date,
       r.roast_date, r.roast_level, l.lot_code, f.farm_name, f.country
FROM cupping_score sc
JOIN cupping_sample cs   ON cs.sample_id = sc.sample_id
JOIN cupping_session ses ON ses.session_id = cs.session_id
JOIN roast_log r         ON r.roast_id = cs.roast_id
JOIN lot l               ON l.lot_id = r.lot_id
JOIN farm f              ON f.farm_id = l.farm_id;

DELIMITER $$

-- ============================= FUNCTION ==============================
DROP FUNCTION IF EXISTS fn_lot_stock$$
CREATE FUNCTION fn_lot_stock(p_lot_id INT) RETURNS DECIMAL(10,2)
READS SQL DATA
BEGIN
  DECLARE v_stock DECIMAL(10,2);
  SELECT l.quantity_kg - COALESCE((SELECT SUM(green_kg) FROM roast_log WHERE lot_id = p_lot_id), 0)
    INTO v_stock
    FROM lot l WHERE l.lot_id = p_lot_id;
  RETURN v_stock;
END$$

-- ============================== TRIGGERS =============================
-- T1: a roast may not use more green coffee than the lot has left
DROP TRIGGER IF EXISTS trg_roast_stock_check$$
CREATE TRIGGER trg_roast_stock_check
BEFORE INSERT ON roast_log
FOR EACH ROW
BEGIN
  IF NEW.green_kg > fn_lot_stock(NEW.lot_id) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Roast exceeds remaining green coffee stock for this lot';
  END IF;
END$$

-- T2: log every change of purchase price
DROP TRIGGER IF EXISTS trg_lot_price_audit$$
CREATE TRIGGER trg_lot_price_audit
AFTER UPDATE ON lot
FOR EACH ROW
BEGIN
  IF NOT (OLD.price_per_kg <=> NEW.price_per_kg) THEN
    INSERT INTO lot_price_log (lot_id, old_price, new_price)
    VALUES (OLD.lot_id, OLD.price_per_kg, NEW.price_per_kg);
  END IF;
END$$

-- T3: cupper name cannot be blank or only spaces
DROP TRIGGER IF EXISTS trg_score_cupper_name$$
CREATE TRIGGER trg_score_cupper_name
BEFORE INSERT ON cupping_score
FOR EACH ROW
BEGIN
  IF TRIM(NEW.cupper_name) = '' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Cupper name cannot be blank';
  END IF;
END$$

-- ============================= PROCEDURES ============================
-- P1: record a roast; the lot row is locked so two roasts cannot both
--     claim the same remaining kilograms
DROP PROCEDURE IF EXISTS sp_add_roast$$
CREATE PROCEDURE sp_add_roast(
  IN p_lot_id INT, IN p_date DATE, IN p_level VARCHAR(20),
  IN p_green DECIMAL(8,2), IN p_roasted DECIMAL(8,2))
BEGIN
  DECLARE v_lock INT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;
  SELECT lot_id INTO v_lock FROM lot WHERE lot_id = p_lot_id FOR UPDATE;
  INSERT INTO roast_log (lot_id, roast_date, roast_level, green_kg, roasted_kg)
  VALUES (p_lot_id, p_date, p_level, p_green, p_roasted);
  COMMIT;

  SELECT LAST_INSERT_ID() AS roast_id, fn_lot_stock(p_lot_id) AS stock_left_kg;
END$$

-- P2: ranked result of one cupping session
DROP PROCEDURE IF EXISTS sp_session_summary$$
CREATE PROCEDURE sp_session_summary(IN p_session_id INT)
BEGIN
  SELECT cs.blind_code, l.lot_code, r.roast_level,
         COUNT(sc.score_id) AS sheets,
         ROUND(AVG(sc.total_score), 2) AS avg_score
  FROM cupping_sample cs
  JOIN roast_log r ON r.roast_id = cs.roast_id
  JOIN lot l       ON l.lot_id = r.lot_id
  LEFT JOIN cupping_score sc ON sc.sample_id = cs.sample_id
  WHERE cs.session_id = p_session_id
  GROUP BY cs.sample_id, cs.blind_code, l.lot_code, r.roast_level
  ORDER BY avg_score DESC;
END$$

-- P3: one-stop report for a lot
DROP PROCEDURE IF EXISTS sp_lot_report$$
CREATE PROCEDURE sp_lot_report(IN p_lot_id INT)
BEGIN
  SELECT l.lot_code, f.farm_name, f.country, l.variety, l.process,
         l.quantity_kg, fn_lot_stock(l.lot_id) AS stock_remaining_kg,
         (SELECT ROUND(AVG(sc.total_score),2)
            FROM roast_log r
            JOIN cupping_sample cs ON cs.roast_id = r.roast_id
            JOIN cupping_score sc  ON sc.sample_id = cs.sample_id
           WHERE r.lot_id = l.lot_id) AS avg_score
  FROM lot l JOIN farm f ON f.farm_id = l.farm_id
  WHERE l.lot_id = p_lot_id;
END$$

DELIMITER ;

-- ============================ DEMONSTRATION ==========================
-- Views
SELECT * FROM v_lot_stock ORDER BY stock_remaining_kg;
SELECT * FROM v_lot_leaderboard ORDER BY rank_no;

-- Procedure: valid roast (lot 1 has 28 kg left -> 20 kg left)
CALL sp_add_roast(1, '2026-03-20', 'Medium', 8.00, 6.80);

-- Procedure + trigger T1: must FAIL (lot 5 only has 3 kg left)
-- CALL sp_add_roast(5, '2026-03-21', 'Light', 5.00, 4.30);

-- Table CHECK: must FAIL (roasted more than green)
-- INSERT INTO roast_log (lot_id,roast_date,roast_level,green_kg,roasted_kg) VALUES (2,'2026-03-22','Medium',2.00,3.00);

-- Trigger T2: price change is logged
UPDATE lot SET price_per_kg = 800.00 WHERE lot_id = 1;
SELECT * FROM lot_price_log;

-- Trigger T3: must FAIL (blank cupper)
-- INSERT INTO cupping_score (sample_id,cupper_name,fragrance_aroma,flavor,aftertaste,acidity,body,balance,uniformity,clean_cup,sweetness,overall)
-- VALUES (1,'   ',8,8,8,8,8,8,10,10,10,8);

CALL sp_session_summary(2);
CALL sp_lot_report(5);
