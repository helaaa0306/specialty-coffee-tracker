const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { pool } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../public')));

// Database health check
app.get('/api/health', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 AS ok');
    res.json({ status: 'healthy', database: 'connected', time: new Date() });
  } catch (err) {
    res.status(500).json({ status: 'unhealthy', error: err.message });
  }
});

// Mount API routes
try {
  const farmsRouter = require('./routes/farms');
  const lotsRouter = require('./routes/lots');
  const roastsRouter = require('./routes/roasts');
  const cuppingRouter = require('./routes/cupping');
  const leaderboardRouter = require('./routes/leaderboard');
  const statsRouter = require('./routes/stats');

  app.use('/api/farms', farmsRouter);
  app.use('/api/lots', lotsRouter);
  app.use('/api/roasts', roastsRouter);
  app.use('/api/sessions', cuppingRouter.sessionsRouter);
  app.use('/api/samples', cuppingRouter.samplesRouter);
  app.use('/api/leaderboard', leaderboardRouter);
  app.use('/api/stats', statsRouter);
} catch (e) {
  // Routes may be mounted in subsequent step
}

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
});

// Centralized error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

// Start listening if run directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` Specialty Coffee Cupping & Bean Tracker Server`);
    console.log(` Running on: http://localhost:${PORT}`);
    console.log(` Static files served from /public`);
    console.log(`====================================================`);
  });
}

module.exports = app;
