const express = require('express');
const router = express.Router();
const { pool, formatDbError } = require('../db');

// Allowed coffee processing methods as per CHECK constraint
const ALLOWED_PROCESSES = ['Washed', 'Natural', 'Honey', 'Anaerobic'];

// GET /api/lots - Lots with farm + stock (using v_lot_stock joined to lot details)
router.get('/', async (req, res) => {
  try {
    const query = `
      SELECT s.lot_id, s.lot_code, s.farm_name, f.country, f.region,
             l.supplier_name, l.variety, l.process, l.harvest_year, l.purchase_date,
             s.quantity_kg, l.price_per_kg,
             s.roasted_green_kg, s.stock_remaining_kg, s.stock_status
      FROM v_lot_stock s
      JOIN lot l ON l.lot_id = s.lot_id
      JOIN farm f ON f.farm_id = l.farm_id
      ORDER BY s.lot_id DESC
    `;
    const [lots] = await pool.query(query);
    res.json(lots);
  } catch (err) {
    console.error('Error fetching lots:', err);
    res.status(500).json({ error: formatDbError(err) });
  }
});

// POST /api/lots - Add a lot (process must be Washed/Natural/Honey/Anaerobic)
router.post('/', async (req, res) => {
  try {
    const {
      farm_id,
      lot_code,
      supplier_name,
      variety,
      process,
      harvest_year,
      purchase_date,
      quantity_kg,
      price_per_kg
    } = req.body;

    // Validation
    if (!farm_id) {
      return res.status(400).json({ error: 'Farm selection is required.' });
    }
    if (!lot_code || !lot_code.trim()) {
      return res.status(400).json({ error: 'Lot code is required.' });
    }
    if (!process || !ALLOWED_PROCESSES.includes(process)) {
      return res.status(400).json({
        error: `Invalid process. Allowed options: ${ALLOWED_PROCESSES.join(', ')}`
      });
    }

    const qty = parseFloat(quantity_kg);
    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Quantity (kg) must be a positive number.' });
    }

    let price = null;
    if (price_per_kg !== undefined && price_per_kg !== null && price_per_kg !== '') {
      price = parseFloat(price_per_kg);
      if (isNaN(price) || price < 0) {
        return res.status(400).json({ error: 'Price per kg must be 0 or greater.' });
      }
    }

    let year = null;
    if (harvest_year !== undefined && harvest_year !== null && harvest_year !== '') {
      year = parseInt(harvest_year, 10);
      if (isNaN(year) || year < 1900 || year > 2100) {
        return res.status(400).json({ error: 'Invalid harvest year.' });
      }
    }

    const dateVal = purchase_date && purchase_date.trim() ? purchase_date.trim() : null;

    const [result] = await pool.query(
      `INSERT INTO lot (farm_id, lot_code, supplier_name, variety, process, harvest_year, purchase_date, quantity_kg, price_per_kg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        parseInt(farm_id, 10),
        lot_code.trim(),
        supplier_name ? supplier_name.trim() : null,
        variety ? variety.trim() : null,
        process,
        year,
        dateVal,
        qty,
        price
      ]
    );

    res.status(201).json({
      message: 'Lot added successfully',
      lot_id: result.insertId,
      lot_code: lot_code.trim()
    });
  } catch (err) {
    console.error('Error adding lot:', err);
    res.status(400).json({ error: formatDbError(err) });
  }
});

// GET /api/lots/:id - Lot report (sp_lot_report) + its roasts + its scores (traceability)
router.get('/:id', async (req, res) => {
  try {
    const lotId = parseInt(req.params.id, 10);
    if (isNaN(lotId)) {
      return res.status(400).json({ error: 'Invalid lot ID.' });
    }

    // 1. Call stored procedure sp_lot_report
    const [reportRows] = await pool.query('CALL sp_lot_report(?)', [lotId]);
    const reportData = reportRows && reportRows[0] && reportRows[0][0];

    if (!reportData) {
      return res.status(404).json({ error: `Lot with ID ${lotId} not found.` });
    }

    // 2. Fetch roasts for this lot
    const [roasts] = await pool.query(
      `SELECT r.roast_id, r.roast_date, r.roast_level, r.green_kg, r.roasted_kg,
              ROUND((r.green_kg - r.roasted_kg) / r.green_kg * 100, 2) AS weight_loss_pct
       FROM roast_log r
       WHERE r.lot_id = ?
       ORDER BY r.roast_date DESC, r.roast_id DESC`,
      [lotId]
    );

    // 3. Fetch cupping score sheets for this lot using v_score_traceability
    const [scores] = await pool.query(
      `SELECT sc.score_id, sc.cupper_name, sc.total_score, sc.blind_code,
              sc.session_date, sc.roast_date, sc.roast_level
       FROM v_score_traceability sc
       WHERE sc.lot_code = ?
       ORDER BY sc.session_date DESC, sc.score_id DESC`,
      [reportData.lot_code]
    );

    res.json({
      report: {
        lot_id: lotId,
        ...reportData
      },
      roasts,
      scores
    });
  } catch (err) {
    console.error('Error fetching lot details:', err);
    res.status(500).json({ error: formatDbError(err) });
  }
});

module.exports = router;
