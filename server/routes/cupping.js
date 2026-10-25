const express = require('express');
const sessionsRouter = express.Router();
const samplesRouter = express.Router();
const { pool, formatDbError } = require('../db');

// ============================================================================
// SESSIONS ROUTER (/api/sessions)
// ============================================================================

// GET /api/sessions - List cupping sessions
sessionsRouter.get('/', async (req, res) => {
  try {
    const query = `
      SELECT s.session_id, s.session_date, s.notes,
             COUNT(cs.sample_id) AS sample_count
      FROM cupping_session s
      LEFT JOIN cupping_sample cs ON cs.session_id = s.session_id
      GROUP BY s.session_id, s.session_date, s.notes
      ORDER BY s.session_date DESC, s.session_id DESC
    `;
    const [sessions] = await pool.query(query);
    res.json(sessions);
  } catch (err) {
    console.error('Error fetching sessions:', err);
    res.status(500).json({ error: formatDbError(err) });
  }
});

// POST /api/sessions - Create a session
sessionsRouter.post('/', async (req, res) => {
  try {
    const { session_date, notes } = req.body;

    if (!session_date || !session_date.trim()) {
      return res.status(400).json({ error: 'Session date is required.' });
    }

    const [result] = await pool.query(
      'INSERT INTO cupping_session (session_date, notes) VALUES (?, ?)',
      [session_date.trim(), notes ? notes.trim() : null]
    );

    res.status(201).json({
      message: 'Cupping session created successfully',
      session_id: result.insertId,
      session_date: session_date.trim()
    });
  } catch (err) {
    console.error('Error creating session:', err);
    res.status(400).json({ error: formatDbError(err) });
  }
});

// GET /api/sessions/:id - Samples of a session + summary (sp_session_summary)
sessionsRouter.get('/:id', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (isNaN(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }

    // 1. Session info
    const [sessions] = await pool.query(
      'SELECT session_id, session_date, notes FROM cupping_session WHERE session_id = ?',
      [sessionId]
    );
    if (!sessions.length) {
      return res.status(404).json({ error: `Cupping session ${sessionId} not found.` });
    }

    // 2. Call sp_session_summary(p_session_id)
    const [summaryResult] = await pool.query('CALL sp_session_summary(?)', [sessionId]);
    const summary = summaryResult && summaryResult[0] ? summaryResult[0] : [];

    // 3. Samples in this session (with lot & roast details for blind reveal)
    const [samples] = await pool.query(
      `SELECT cs.sample_id, cs.session_id, cs.roast_id, cs.blind_code,
              r.roast_date, r.roast_level,
              l.lot_id, l.lot_code, l.variety, l.process,
              f.farm_name, f.country,
              COUNT(sc.score_id) AS score_count,
              ROUND(AVG(sc.total_score), 2) AS sample_avg_score
       FROM cupping_sample cs
       JOIN roast_log r ON r.roast_id = cs.roast_id
       JOIN lot l ON l.lot_id = r.lot_id
       JOIN farm f ON f.farm_id = l.farm_id
       LEFT JOIN cupping_score sc ON sc.sample_id = cs.sample_id
       WHERE cs.session_id = ?
       GROUP BY cs.sample_id, cs.session_id, cs.roast_id, cs.blind_code,
                r.roast_date, r.roast_level, l.lot_id, l.lot_code, l.variety, l.process,
                f.farm_name, f.country
       ORDER BY cs.blind_code ASC`,
      [sessionId]
    );

    // 4. Detailed individual scores for all samples in this session
    const [scores] = await pool.query(
      `SELECT sc.score_id, sc.sample_id, cs.blind_code, sc.cupper_name,
              sc.fragrance_aroma, sc.flavor, sc.aftertaste, sc.acidity,
              sc.body, sc.balance, sc.uniformity, sc.clean_cup,
              sc.sweetness, sc.overall, sc.defect_deduction, sc.total_score
       FROM cupping_score sc
       JOIN cupping_sample cs ON cs.sample_id = sc.sample_id
       WHERE cs.session_id = ?
       ORDER BY cs.blind_code ASC, sc.score_id ASC`,
      [sessionId]
    );

    res.json({
      session: sessions[0],
      summary,
      samples,
      scores
    });
  } catch (err) {
    console.error('Error fetching session details:', err);
    res.status(500).json({ error: formatDbError(err) });
  }
});

// POST /api/sessions/:id/samples - Add a sample (roast_id + blind_code)
sessionsRouter.post('/:id/samples', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    const { roast_id, blind_code } = req.body;

    if (isNaN(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID.' });
    }
    if (!roast_id) {
      return res.status(400).json({ error: 'Please select a roast for this sample.' });
    }
    if (!blind_code || !blind_code.trim()) {
      return res.status(400).json({ error: 'Blind code is required (e.g. A1, B2).' });
    }

    const trimmedCode = blind_code.trim().toUpperCase();

    const [result] = await pool.query(
      'INSERT INTO cupping_sample (session_id, roast_id, blind_code) VALUES (?, ?, ?)',
      [sessionId, parseInt(roast_id, 10), trimmedCode]
    );

    res.status(201).json({
      message: 'Sample added successfully to session',
      sample_id: result.insertId,
      session_id: sessionId,
      blind_code: trimmedCode
    });
  } catch (err) {
    console.error('Error adding sample:', err);
    res.status(400).json({ error: formatDbError(err) });
  }
});

// ============================================================================
// SAMPLES ROUTER (/api/samples)
// ============================================================================

// POST /api/samples/:id/scores - Add a score sheet (10 attributes + defect_deduction)
// Note: total_score is a GENERATED column; never insert or update it!
samplesRouter.post('/:id/scores', async (req, res) => {
  try {
    const sampleId = parseInt(req.params.id, 10);
    if (isNaN(sampleId)) {
      return res.status(400).json({ error: 'Invalid sample ID.' });
    }

    const {
      cupper_name,
      fragrance_aroma,
      flavor,
      aftertaste,
      acidity,
      body,
      balance,
      uniformity,
      clean_cup,
      sweetness,
      overall,
      defect_deduction
    } = req.body;

    // Check cupper name
    if (!cupper_name || !cupper_name.trim()) {
      return res.status(400).json({ error: 'Cupper name cannot be blank.' });
    }

    // Helper to validate score attribute in [0, 10]
    const attributes = {
      fragrance_aroma,
      flavor,
      aftertaste,
      acidity,
      body,
      balance,
      uniformity,
      clean_cup,
      sweetness,
      overall
    };

    const parsedValues = {};
    for (const [key, val] of Object.entries(attributes)) {
      const num = parseFloat(val);
      if (isNaN(num) || num < 0 || num > 10) {
        return res.status(400).json({
          error: `Attribute '${key.replace('_', ' ')}' must be between 0.00 and 10.00.`
        });
      }
      parsedValues[key] = num;
    }

    let defect = 0;
    if (defect_deduction !== undefined && defect_deduction !== null && defect_deduction !== '') {
      defect = parseFloat(defect_deduction);
      if (isNaN(defect) || defect < 0) {
        return res.status(400).json({ error: 'Defect deduction must be 0 or greater.' });
      }
    }

    // Insert score sheet. Total score is computed automatically by MySQL.
    const [result] = await pool.query(
      `INSERT INTO cupping_score
       (sample_id, cupper_name, fragrance_aroma, flavor, aftertaste, acidity,
        body, balance, uniformity, clean_cup, sweetness, overall, defect_deduction)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sampleId,
        cupper_name.trim(),
        parsedValues.fragrance_aroma,
        parsedValues.flavor,
        parsedValues.aftertaste,
        parsedValues.acidity,
        parsedValues.body,
        parsedValues.balance,
        parsedValues.uniformity,
        parsedValues.clean_cup,
        parsedValues.sweetness,
        parsedValues.overall,
        defect
      ]
    );

    // Retrieve the newly inserted score with the database-generated total_score
    const [inserted] = await pool.query(
      `SELECT score_id, sample_id, cupper_name, fragrance_aroma, flavor,
              aftertaste, acidity, body, balance, uniformity, clean_cup,
              sweetness, overall, defect_deduction, total_score
       FROM cupping_score
       WHERE score_id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      message: 'Score sheet recorded successfully',
      score: inserted[0]
    });
  } catch (err) {
    console.error('Error recording score sheet:', err);
    res.status(400).json({ error: formatDbError(err) });
  }
});

module.exports = {
  sessionsRouter,
  samplesRouter
};
