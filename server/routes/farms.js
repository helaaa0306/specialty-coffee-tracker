const express = require('express');
const router = express.Router();
const { pool, formatDbError } = require('../db');

// GET /api/farms - List all farms
router.get('/', async (req, res) => {
  try {
    const [farms] = await pool.query(
      'SELECT farm_id, farm_name, country, region, altitude_masl FROM farm ORDER BY farm_name ASC'
    );
    res.json(farms);
  } catch (err) {
    console.error('Error fetching farms:', err);
    res.status(500).json({ error: formatDbError(err) });
  }
});

// POST /api/farms - Add a new farm
router.post('/', async (req, res) => {
  try {
    const { farm_name, country, region, altitude_masl } = req.body;

    if (!farm_name || !farm_name.trim()) {
      return res.status(400).json({ error: 'Farm name is required.' });
    }
    if (!country || !country.trim()) {
      return res.status(400).json({ error: 'Country is required.' });
    }

    let alt = null;
    if (altitude_masl !== undefined && altitude_masl !== null && altitude_masl !== '') {
      alt = parseInt(altitude_masl, 10);
      if (isNaN(alt) || alt <= 0) {
        return res.status(400).json({ error: 'Altitude must be a positive number.' });
      }
    }

    const [result] = await pool.query(
      'INSERT INTO farm (farm_name, country, region, altitude_masl) VALUES (?, ?, ?, ?)',
      [farm_name.trim(), country.trim(), region ? region.trim() : null, alt]
    );

    res.status(201).json({
      message: 'Farm added successfully',
      farm_id: result.insertId,
      farm_name: farm_name.trim()
    });
  } catch (err) {
    console.error('Error adding farm:', err);
    res.status(400).json({ error: formatDbError(err) });
  }
});

module.exports = router;
