const express = require('express');
const router = express.Router();
const { pool, formatDbError } = require('../db');

// GET /api/stats - Dashboard counts: lots, kg in stock, roasts, avg score
router.get('/', async (req, res) => {
  try {
    const [lotsCount] = await pool.query('SELECT COUNT(*) AS count FROM lot');
    const [stockSum] = await pool.query(
      'SELECT COALESCE(SUM(stock_remaining_kg), 0) AS total_kg FROM v_lot_stock'
    );
    const [roastsCount] = await pool.query('SELECT COUNT(*) AS count FROM roast_log');
    const [avgScore] = await pool.query(
      'SELECT ROUND(AVG(total_score), 2) AS avg_score FROM cupping_score'
    );
    const [lowStock] = await pool.query(
      "SELECT COUNT(*) AS count FROM v_lot_stock WHERE stock_status = 'LOW'"
    );

    res.json({
      total_lots: parseInt(lotsCount[0].count, 10),
      total_stock_kg: parseFloat(stockSum[0].total_kg),
      total_roasts: parseInt(roastsCount[0].count, 10),
      overall_avg_score: avgScore[0].avg_score !== null ? parseFloat(avgScore[0].avg_score) : null,
      low_stock_count: parseInt(lowStock[0].count, 10)
    });
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ error: formatDbError(err) });
  }
});

module.exports = router;
