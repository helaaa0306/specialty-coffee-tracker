const express = require('express');
const router = express.Router();
const { pool, formatDbError } = require('../db');

// GET /api/leaderboard - v_lot_leaderboard + avg score by process + avg score by cupper
router.get('/', async (req, res) => {
  try {
    // 1. Ranked lots from view v_lot_leaderboard
    const [rankedLots] = await pool.query(
      `SELECT lot_id, lot_code, farm_name, process, sheets, avg_score, rank_no
       FROM v_lot_leaderboard
       ORDER BY rank_no ASC`
    );

    // 2. Average cupping score by processing method
    const [processScores] = await pool.query(
      `SELECT l.process,
              ROUND(AVG(sc.total_score), 2) AS avg_score,
              COUNT(sc.score_id) AS sheets
       FROM lot l
       JOIN roast_log r ON r.lot_id = l.lot_id
       JOIN cupping_sample cs ON cs.roast_id = r.roast_id
       JOIN cupping_score sc ON sc.sample_id = cs.sample_id
       GROUP BY l.process
       ORDER BY avg_score DESC`
    );

    // 3. Cupper analysis: how strict is each cupper?
    const [cupperScores] = await pool.query(
      `SELECT cupper_name,
              COUNT(score_id) AS sheets,
              ROUND(AVG(total_score), 2) AS avg_given,
              MIN(total_score) AS lowest,
              MAX(total_score) AS highest
       FROM cupping_score
       GROUP BY cupper_name
       ORDER BY avg_given DESC`
    );

    res.json({
      rankedLots,
      processScores,
      cupperScores
    });
  } catch (err) {
    console.error('Error fetching leaderboard:', err);
    res.status(500).json({ error: formatDbError(err) });
  }
});

module.exports = router;
