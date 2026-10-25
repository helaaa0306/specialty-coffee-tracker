-- =====================================================================
-- Exp 8 | Project Phase II : SQL Query Implementation
-- Run after 01_schema_and_data.sql
-- =====================================================================
USE coffee_tracker;

-- ============================ JOINS ==================================
-- Q1. Every lot with its farm of origin
SELECT l.lot_code, f.farm_name, f.country, f.region, l.variety, l.process, l.quantity_kg
FROM lot AS l
INNER JOIN farm AS f ON f.farm_id = l.farm_id
ORDER BY f.country, l.lot_code;

-- Q2. Roast history with lot and farm
SELECT r.roast_id, r.roast_date, r.roast_level, l.lot_code, f.farm_name, r.green_kg, r.roasted_kg
FROM roast_log AS r
INNER JOIN lot  AS l ON l.lot_id  = r.lot_id
INNER JOIN farm AS f ON f.farm_id = l.farm_id
ORDER BY r.roast_date, r.roast_id;

-- Q3. Samples on each cupping table (blind code vs. what it really is)
SELECT cs.session_id, cs.blind_code, l.lot_code, r.roast_level, f.farm_name
FROM cupping_sample AS cs
INNER JOIN roast_log AS r ON r.roast_id = cs.roast_id
INNER JOIN lot       AS l ON l.lot_id   = r.lot_id
INNER JOIN farm      AS f ON f.farm_id  = l.farm_id
ORDER BY cs.session_id, cs.blind_code;

-- Q4. Full traceability: score sheet -> farm
SELECT sc.score_id, sc.cupper_name, sc.total_score, cs.blind_code, ses.session_date,
       r.roast_level, l.lot_code, f.farm_name, f.country
FROM cupping_score AS sc
INNER JOIN cupping_sample  AS cs  ON cs.sample_id  = sc.sample_id
INNER JOIN cupping_session AS ses ON ses.session_id = cs.session_id
INNER JOIN roast_log       AS r   ON r.roast_id    = cs.roast_id
INNER JOIN lot             AS l   ON l.lot_id      = r.lot_id
INNER JOIN farm            AS f   ON f.farm_id     = l.farm_id
ORDER BY sc.total_score DESC;

-- ========================= AGGREGATES ================================
-- Q5. Green coffee remaining per lot (LEFT JOIN keeps never-roasted lots)
SELECT l.lot_code, l.quantity_kg AS bought_kg,
       COALESCE(SUM(r.green_kg),0) AS roasted_kg,
       l.quantity_kg - COALESCE(SUM(r.green_kg),0) AS remaining_kg
FROM lot AS l
LEFT JOIN roast_log AS r ON r.lot_id = l.lot_id
GROUP BY l.lot_id, l.lot_code, l.quantity_kg
ORDER BY remaining_kg;

-- Q6. Lots running low (under 10 kg left)
SELECT l.lot_code, l.quantity_kg - COALESCE(SUM(r.green_kg),0) AS remaining_kg
FROM lot AS l
LEFT JOIN roast_log AS r ON r.lot_id = l.lot_id
GROUP BY l.lot_id, l.lot_code, l.quantity_kg
HAVING remaining_kg < 10
ORDER BY remaining_kg;

-- Q7. Average weight loss by roast level
SELECT roast_level, COUNT(*) AS roasts,
       ROUND(AVG((green_kg - roasted_kg) / green_kg * 100), 2) AS avg_loss_pct
FROM roast_log
GROUP BY roast_level
ORDER BY avg_loss_pct;

-- Q8. Lots ranked by average cupping score
SELECT l.lot_code, f.farm_name, COUNT(sc.score_id) AS sheets,
       ROUND(AVG(sc.total_score), 2) AS avg_score
FROM lot AS l
INNER JOIN farm AS f           ON f.farm_id = l.farm_id
INNER JOIN roast_log AS r      ON r.lot_id = l.lot_id
INNER JOIN cupping_sample AS cs ON cs.roast_id = r.roast_id
INNER JOIN cupping_score AS sc  ON sc.sample_id = cs.sample_id
GROUP BY l.lot_id, l.lot_code, f.farm_name
ORDER BY avg_score DESC;

-- Q9. Average score by processing method
SELECT l.process, ROUND(AVG(sc.total_score), 2) AS avg_score, COUNT(*) AS sheets
FROM lot AS l
INNER JOIN roast_log AS r       ON r.lot_id = l.lot_id
INNER JOIN cupping_sample AS cs ON cs.roast_id = r.roast_id
INNER JOIN cupping_score AS sc  ON sc.sample_id = cs.sample_id
GROUP BY l.process
ORDER BY avg_score DESC;

-- Q10. How strict is each cupper?
SELECT cupper_name, COUNT(*) AS sheets, ROUND(AVG(total_score),2) AS avg_given,
       MIN(total_score) AS lowest, MAX(total_score) AS highest
FROM cupping_score
GROUP BY cupper_name
ORDER BY avg_given;

-- Q11. Purchase value per farm
SELECT f.farm_name, COUNT(l.lot_id) AS lots, SUM(l.quantity_kg) AS total_kg,
       SUM(l.quantity_kg * l.price_per_kg) AS purchase_value_inr
FROM farm AS f
LEFT JOIN lot AS l ON l.farm_id = f.farm_id
GROUP BY f.farm_id, f.farm_name
ORDER BY purchase_value_inr DESC;

-- ========================== SUBQUERIES ===============================
-- Q12. Scalar subquery: lots costing more than the average price per kg
SELECT lot_code, variety, price_per_kg
FROM lot
WHERE price_per_kg > (SELECT AVG(price_per_kg) FROM lot)
ORDER BY price_per_kg DESC;

-- Q13. Subquery in HAVING: samples scoring above the overall average
SELECT cs.session_id, cs.blind_code, ROUND(AVG(sc.total_score),2) AS avg_score
FROM cupping_sample AS cs
INNER JOIN cupping_score AS sc ON sc.sample_id = cs.sample_id
GROUP BY cs.sample_id, cs.session_id, cs.blind_code
HAVING AVG(sc.total_score) > (SELECT AVG(total_score) FROM cupping_score)
ORDER BY avg_score DESC;

-- Q14. Correlated NOT EXISTS: roasts that have never been cupped
SELECT r.roast_id, r.roast_date, r.roast_level, l.lot_code
FROM roast_log AS r
INNER JOIN lot AS l ON l.lot_id = r.lot_id
WHERE NOT EXISTS (SELECT 1 FROM cupping_sample AS cs WHERE cs.roast_id = r.roast_id);

-- Q15. Correlated subquery: sheets scored above that sample's own average
SELECT sc.sample_id, sc.cupper_name, sc.total_score
FROM cupping_score AS sc
WHERE sc.total_score > (SELECT AVG(s2.total_score) FROM cupping_score AS s2 WHERE s2.sample_id = sc.sample_id)
ORDER BY sc.sample_id, sc.total_score DESC;

-- Q16. Derived-table subquery: lots with less than 40% of their stock left
SELECT l.lot_code, l.quantity_kg, st.remaining_kg,
       ROUND(st.remaining_kg / l.quantity_kg * 100, 1) AS pct_left
FROM lot AS l
INNER JOIN (
    SELECT l2.lot_id, l2.quantity_kg - COALESCE(SUM(r.green_kg),0) AS remaining_kg
    FROM lot AS l2
    LEFT JOIN roast_log AS r ON r.lot_id = l2.lot_id
    GROUP BY l2.lot_id, l2.quantity_kg
) AS st ON st.lot_id = l.lot_id
WHERE st.remaining_kg < 0.4 * l.quantity_kg
ORDER BY pct_left;
