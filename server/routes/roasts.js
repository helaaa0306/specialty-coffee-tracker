const express = require('express');
const router = express.Router();
const { pool, formatDbError } = require('../db');

const ALLOWED_ROAST_LEVELS = ['Light', 'Medium-Light', 'Medium', 'Dark'];

// GET /api/roasts - Roast log with lot code, weight-loss %
router.get('/', async (req, res) => {
  try {
    const query = `
      SELECT r.roast_id, r.lot_id, l.lot_code, f.farm_name,
             r.roast_date, r.roast_level, r.green_kg, r.roasted_kg,
             ROUND((r.green_kg - r.roasted_kg) / r.green_kg * 100, 2) AS weight_loss_pct
      FROM roast_log r
      JOIN lot l ON l.lot_id = r.lot_id
      JOIN farm f ON f.farm_id = l.farm_id
      ORDER BY r.roast_date DESC, r.roast_id DESC
    `;
    const [roasts] = await pool.query(query);
    res.json(roasts);
  } catch (err) {
    console.error('Error fetching roasts:', err);
    res.status(500).json({ error: formatDbError(err) });
  }
});

// POST /api/roasts - Record a roast via stored procedure sp_add_roast
router.post('/', async (req, res) => {
  try {
    const { lot_id, roast_date, roast_level, green_kg, roasted_kg } = req.body;

    // Server-side validations
    if (!lot_id) {
      return res.status(400).json({ error: 'Please select a lot.' });
    }
    if (!roast_date || !roast_date.trim()) {
      return res.status(400).json({ error: 'Roast date is required.' });
    }
    if (!roast_level || !ALLOWED_ROAST_LEVELS.includes(roast_level)) {
      return res.status(400).json({
        error: `Roast level must be one of: ${ALLOWED_ROAST_LEVELS.join(', ')}`
      });
    }

    const green = parseFloat(green_kg);
    if (isNaN(green) || green <= 0) {
      return res.status(400).json({ error: 'Green coffee weight must be greater than 0 kg.' });
    }

    const roasted = parseFloat(roasted_kg);
    if (isNaN(roasted) || roasted <= 0) {
      return res.status(400).json({ error: 'Roasted coffee weight must be greater than 0 kg.' });
    }

    if (roasted > green) {
      return res.status(400).json({
        error: 'Roasted weight must be less than or equal to green coffee weight.'
      });
    }

    // Call stored procedure sp_add_roast(p_lot_id, p_date, p_level, p_green, p_roasted)
    // sp_add_roast locks the lot row and enforces trigger trg_roast_stock_check
    const [spResult] = await pool.query(
      'CALL sp_add_roast(?, ?, ?, ?, ?)',
      [parseInt(lot_id, 10), roast_date.trim(), roast_level, green, roasted]
    );

    // sp_add_roast returns SELECT LAST_INSERT_ID() AS roast_id, fn_lot_stock(p_lot_id) AS stock_left_kg;
    const roastMeta = spResult && spResult[0] && spResult[0][0];

    res.status(201).json({
      message: 'Roast recorded successfully',
      roast_id: roastMeta ? roastMeta.roast_id : null,
      stock_left_kg: roastMeta ? roastMeta.stock_left_kg : null
    });
  } catch (err) {
    console.error('Error recording roast:', err);
    // Returns HTTP 400 with trigger or check error message
    res.status(400).json({ error: formatDbError(err) });
  }
});

module.exports = router;
