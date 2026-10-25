-- =====================================================================
-- Specialty Coffee Cupping & Bean Tracker  |  MySQL 8.0.16+
-- 01_schema_and_data.sql : creates database, 6 tables, sample data
-- Run:  mysql -u root -p < 01_schema_and_data.sql
-- =====================================================================
DROP DATABASE IF EXISTS coffee_tracker;
CREATE DATABASE coffee_tracker CHARACTER SET utf8mb4;
USE coffee_tracker;

CREATE TABLE farm (
  farm_id       INT AUTO_INCREMENT PRIMARY KEY,
  farm_name     VARCHAR(100) NOT NULL,
  country       VARCHAR(50)  NOT NULL,
  region        VARCHAR(80),
  altitude_masl INT,
  CONSTRAINT chk_farm_altitude CHECK (altitude_masl IS NULL OR altitude_masl > 0)
) ENGINE=InnoDB;

CREATE TABLE lot (
  lot_id        INT AUTO_INCREMENT PRIMARY KEY,
  farm_id       INT NOT NULL,
  lot_code      VARCHAR(30) NOT NULL UNIQUE,
  supplier_name VARCHAR(100),
  variety       VARCHAR(60),
  process       VARCHAR(30),
  harvest_year  INT,
  purchase_date DATE,
  quantity_kg   DECIMAL(10,2) NOT NULL,
  price_per_kg  DECIMAL(10,2),
  CONSTRAINT fk_lot_farm FOREIGN KEY (farm_id) REFERENCES farm(farm_id),
  CONSTRAINT chk_lot_process CHECK (process IN ('Washed','Natural','Honey','Anaerobic')),
  CONSTRAINT chk_lot_qty CHECK (quantity_kg > 0),
  CONSTRAINT chk_lot_price CHECK (price_per_kg IS NULL OR price_per_kg >= 0)
) ENGINE=InnoDB;

CREATE TABLE roast_log (
  roast_id   INT AUTO_INCREMENT PRIMARY KEY,
  lot_id     INT NOT NULL,
  roast_date DATE NOT NULL,
  roast_level VARCHAR(20),
  green_kg   DECIMAL(8,2) NOT NULL,
  roasted_kg DECIMAL(8,2) NOT NULL,
  CONSTRAINT fk_roast_lot FOREIGN KEY (lot_id) REFERENCES lot(lot_id),
  CONSTRAINT chk_roast_level CHECK (roast_level IN ('Light','Medium-Light','Medium','Dark')),
  CONSTRAINT chk_roast_green CHECK (green_kg > 0),
  CONSTRAINT chk_roast_roasted CHECK (roasted_kg > 0 AND roasted_kg <= green_kg)
) ENGINE=InnoDB;

CREATE TABLE cupping_session (
  session_id   INT AUTO_INCREMENT PRIMARY KEY,
  session_date DATE NOT NULL,
  notes        VARCHAR(300)
) ENGINE=InnoDB;

CREATE TABLE cupping_sample (
  sample_id  INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  roast_id   INT NOT NULL,
  blind_code VARCHAR(10) NOT NULL,
  CONSTRAINT fk_sample_session FOREIGN KEY (session_id) REFERENCES cupping_session(session_id),
  CONSTRAINT fk_sample_roast   FOREIGN KEY (roast_id)   REFERENCES roast_log(roast_id),
  CONSTRAINT uq_session_blind  UNIQUE (session_id, blind_code),
  CONSTRAINT uq_session_roast  UNIQUE (session_id, roast_id)
) ENGINE=InnoDB;

CREATE TABLE cupping_score (
  score_id        INT AUTO_INCREMENT PRIMARY KEY,
  sample_id       INT NOT NULL,
  cupper_name     VARCHAR(60) NOT NULL,
  fragrance_aroma DECIMAL(4,2) NOT NULL,
  flavor          DECIMAL(4,2) NOT NULL,
  aftertaste      DECIMAL(4,2) NOT NULL,
  acidity         DECIMAL(4,2) NOT NULL,
  body            DECIMAL(4,2) NOT NULL,
  balance         DECIMAL(4,2) NOT NULL,
  uniformity      DECIMAL(4,2) NOT NULL,
  clean_cup       DECIMAL(4,2) NOT NULL,
  sweetness       DECIMAL(4,2) NOT NULL,
  overall         DECIMAL(4,2) NOT NULL,
  defect_deduction DECIMAL(4,2) NOT NULL DEFAULT 0,
  total_score     DECIMAL(5,2) GENERATED ALWAYS AS
    (fragrance_aroma + flavor + aftertaste + acidity + body + balance
     + uniformity + clean_cup + sweetness + overall - defect_deduction) STORED,
  CONSTRAINT fk_score_sample FOREIGN KEY (sample_id) REFERENCES cupping_sample(sample_id),
  CONSTRAINT uq_sample_cupper UNIQUE (sample_id, cupper_name),
  CONSTRAINT chk_fragrance  CHECK (fragrance_aroma BETWEEN 0 AND 10),
  CONSTRAINT chk_flavor     CHECK (flavor     BETWEEN 0 AND 10),
  CONSTRAINT chk_aftertaste CHECK (aftertaste BETWEEN 0 AND 10),
  CONSTRAINT chk_acidity    CHECK (acidity    BETWEEN 0 AND 10),
  CONSTRAINT chk_body       CHECK (body       BETWEEN 0 AND 10),
  CONSTRAINT chk_balance    CHECK (balance    BETWEEN 0 AND 10),
  CONSTRAINT chk_uniformity CHECK (uniformity BETWEEN 0 AND 10),
  CONSTRAINT chk_clean_cup  CHECK (clean_cup  BETWEEN 0 AND 10),
  CONSTRAINT chk_sweetness  CHECK (sweetness  BETWEEN 0 AND 10),
  CONSTRAINT chk_overall    CHECK (overall    BETWEEN 0 AND 10),
  CONSTRAINT chk_defect     CHECK (defect_deduction >= 0)
) ENGINE=InnoDB;

-- ---------------------------- SAMPLE DATA ----------------------------
INSERT INTO farm (farm_id, farm_name, country, region, altitude_masl) VALUES
 (1,'Bababudangiri Hills Estate','India','Chikmagalur',1300),
 (2,'Sakleshpur Green Valley','India','Hassan',950),
 (3,'Finca La Esperanza','Colombia','Huila',1750),
 (4,'Kochere Washing Station','Ethiopia','Yirgacheffe',1950),
 (5,'Kiambu Ridge Estate','Kenya','Kiambu',1700);

INSERT INTO lot (lot_id, farm_id, lot_code, supplier_name, variety, process, harvest_year, purchase_date, quantity_kg, price_per_kg) VALUES
 (1,1,'IN-BB-2526-01','Western Ghats Traders','S795','Washed',2025,'2025-12-10',60.00, 780.00),
 (2,1,'IN-BB-2526-02','Western Ghats Traders','S795','Natural',2025,'2025-12-10',40.00, 820.00),
 (3,2,'IN-SK-2526-01','Hassan Coffee Co-op','Chandragiri','Honey',2025,'2026-01-05',50.00, 760.00),
 (4,3,'CO-LE-2526-01','Andes Direct Imports','Caturra','Washed',2025,'2026-01-20',30.00,1450.00),
 (5,4,'ET-KO-2526-01','Horn Origin Exports','Heirloom','Natural',2025,'2026-02-02', 8.00,1900.00),
 (6,5,'KE-KR-2526-01','Nairobi Lot Brokers','SL28','Anaerobic',2025,'2026-02-15',12.00,2200.00);

INSERT INTO roast_log (roast_id, lot_id, roast_date, roast_level, green_kg, roasted_kg) VALUES
 (1,1,'2026-01-15','Medium',      10.00, 8.50),
 (2,1,'2026-01-22','Light',       10.00, 8.70),
 (3,1,'2026-02-05','Dark',        12.00, 9.80),
 (4,2,'2026-01-16','Medium-Light', 8.00, 6.90),
 (5,2,'2026-02-06','Medium',       8.00, 6.80),
 (6,3,'2026-01-25','Medium',      10.00, 8.55),
 (7,3,'2026-02-10','Light',       10.00, 8.75),
 (8,4,'2026-02-01','Medium-Light', 6.00, 5.20),
 (9,4,'2026-02-20','Medium',       6.00, 5.10),
 (10,5,'2026-02-12','Light',       5.00, 4.35),
 (11,6,'2026-02-25','Light',       4.00, 3.50),
 (12,6,'2026-03-05','Medium-Light',4.00, 3.40);

INSERT INTO cupping_session (session_id, session_date, notes) VALUES
 (1,'2026-02-20','Baseline: Indian lots across roast levels'),
 (2,'2026-03-10','Light roast comparison across origins'),
 (3,'2026-03-12','Medium roast shootout');

INSERT INTO cupping_sample (sample_id, session_id, roast_id, blind_code) VALUES
 (1,1,1,'A1'),(2,1,4,'A2'),(3,1,6,'A3'),(4,1,3,'A4'),
 (5,2,2,'B1'),(6,2,7,'B2'),(7,2,10,'B3'),(8,2,11,'B4'),
 (9,3,9,'C1'),(10,3,5,'C2');

INSERT INTO cupping_score
 (sample_id,cupper_name,fragrance_aroma,flavor,aftertaste,acidity,body,balance,uniformity,clean_cup,sweetness,overall,defect_deduction) VALUES
 (1,'Aarav',7.75,7.75,7.50,7.75,7.50,7.75,10,10,10,7.75,0),
 (1,'Meera',7.50,7.75,7.50,7.50,7.75,7.50,10,10,10,7.50,0),
 (1,'Kabir',7.75,7.50,7.25,7.75,7.50,7.50,10,10,10,7.50,0),
 (2,'Aarav',8.00,8.00,7.75,7.50,7.75,7.75,10,10,10,8.00,0),
 (2,'Meera',7.75,8.25,7.75,7.50,8.00,7.75,10,10,10,8.00,0),
 (2,'Kabir',8.00,8.00,7.50,7.75,7.75,7.50,10, 8,10,7.75,2),
 (3,'Aarav',7.75,7.75,7.50,7.50,7.75,7.75,10,10,10,7.75,0),
 (3,'Meera',7.50,7.50,7.50,7.50,7.50,7.50,10,10,10,7.50,0),
 (3,'Kabir',7.75,7.75,7.25,7.50,7.75,7.50,10,10,10,7.50,0),
 (4,'Aarav',7.00,6.75,6.75,6.50,7.50,7.00,10,10,10,6.75,0),
 (4,'Meera',7.25,7.00,6.75,6.50,7.25,7.00,10,10,10,7.00,0),
 (4,'Kabir',7.00,6.75,6.50,6.75,7.50,6.75,10,10,10,6.75,0),
 (5,'Aarav',8.25,8.25,8.00,8.00,7.75,8.00,10,10,10,8.25,0),
 (5,'Meera',8.00,8.25,8.00,8.25,7.75,8.00,10,10,10,8.00,0),
 (5,'Kabir',8.25,8.00,7.75,8.00,8.00,8.00,10,10,10,8.00,0),
 (6,'Aarav',8.00,8.00,7.75,8.00,7.75,7.75,10,10,10,8.00,0),
 (6,'Meera',8.00,7.75,7.75,8.25,7.50,7.75,10,10,10,7.75,0),
 (6,'Kabir',7.75,8.00,7.75,8.00,7.75,8.00,10,10,10,8.00,0),
 (7,'Aarav',8.75,8.75,8.50,8.75,8.25,8.50,10,10,10,8.75,0),
 (7,'Meera',8.50,8.75,8.50,9.00,8.25,8.50,10,10,10,8.75,0),
 (7,'Kabir',8.75,8.50,8.25,8.75,8.25,8.50,10,10,10,8.50,0),
 (8,'Aarav',8.50,8.75,8.25,9.00,8.00,8.25,10,10,10,8.50,0),
 (8,'Meera',8.75,8.50,8.25,9.25,8.00,8.25,10,10,10,8.50,0),
 (8,'Kabir',8.50,8.50,8.00,9.00,8.00,8.00,10,10,10,8.25,0),
 (9,'Aarav',8.00,8.00,7.75,8.00,8.00,8.00,10,10,10,8.00,0),
 (9,'Meera',8.25,8.00,7.75,7.75,8.00,8.00,10,10,10,8.00,0),
 (9,'Kabir',8.00,8.25,7.75,8.00,7.75,8.00,10,10,10,8.00,0),
 (10,'Aarav',7.75,7.75,7.50,7.50,7.75,7.75,10,10,10,7.75,0),
 (10,'Meera',7.75,7.50,7.50,7.50,7.75,7.50,10,10,10,7.50,0),
 (10,'Kabir',7.50,7.75,7.25,7.50,7.75,7.50,10,10,10,7.50,1.00);

-- Quick sanity check
SELECT 'farm' t, COUNT(*) n FROM farm UNION ALL SELECT 'lot', COUNT(*) FROM lot
UNION ALL SELECT 'roast_log', COUNT(*) FROM roast_log UNION ALL SELECT 'cupping_session', COUNT(*) FROM cupping_session
UNION ALL SELECT 'cupping_sample', COUNT(*) FROM cupping_sample UNION ALL SELECT 'cupping_score', COUNT(*) FROM cupping_score;
