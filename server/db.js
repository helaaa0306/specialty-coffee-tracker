const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : '',
  database: process.env.DB_NAME || 'coffee_tracker',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true,
  dateStrings: true,
  multipleStatements: false
});

/**
 * Format database errors into readable messages for HTTP 400 responses.
 * Handles custom SIGNAL 45000, CHECK violations, and duplicate keys.
 */
function formatDbError(err) {
  if (!err) return 'An unexpected error occurred';

  // 1. Custom SIGNAL 45000 from triggers / stored procedures (e.g. trg_roast_stock_check, trg_score_cupper_name)
  if (err.sqlState === '45000' || err.errno === 1644) {
    return err.sqlMessage || err.message || 'Validation error in business logic';
  }

  // 2. CHECK constraint violation (MySQL 8.0.16+) - Error 3819
  if (err.errno === 3819) {
    const msg = err.sqlMessage || err.message || '';
    if (msg.includes('chk_roast_roasted')) {
      return 'Roasted weight must be greater than 0 and less than or equal to green coffee weight.';
    }
    if (msg.includes('chk_roast_green')) {
      return 'Green coffee weight must be greater than 0 kg.';
    }
    if (msg.includes('chk_roast_level')) {
      return 'Roast level must be one of: Light, Medium-Light, Medium, Dark.';
    }
    if (msg.includes('chk_lot_process')) {
      return 'Process must be one of: Washed, Natural, Honey, Anaerobic.';
    }
    if (msg.includes('chk_lot_qty')) {
      return 'Lot quantity must be greater than 0 kg.';
    }
    if (msg.includes('chk_lot_price')) {
      return 'Price per kg cannot be negative.';
    }
    if (msg.includes('chk_farm_altitude')) {
      return 'Farm altitude must be a positive number.';
    }
    if (msg.includes('chk_defect')) {
      return 'Defect deduction must be 0 or greater.';
    }
    if (msg.includes('chk_fragrance') || msg.includes('chk_flavor') || msg.includes('chk_aftertaste') ||
        msg.includes('chk_acidity') || msg.includes('chk_body') || msg.includes('chk_balance') ||
        msg.includes('chk_uniformity') || msg.includes('chk_clean_cup') || msg.includes('chk_sweetness') ||
        msg.includes('chk_overall')) {
      return 'Cupping attribute scores must be between 0.00 and 10.00.';
    }
    return err.sqlMessage || 'Check constraint violation.';
  }

  // 3. Duplicate key entry - Error 1062
  if (err.errno === 1062) {
    const msg = err.sqlMessage || err.message || '';
    if (msg.includes('uq_sample_cupper')) {
      return 'This cupper has already submitted a score sheet for this sample.';
    }
    if (msg.includes('uq_session_blind')) {
      return 'This blind code is already assigned to another sample in this session.';
    }
    if (msg.includes('uq_session_roast')) {
      return 'This roast has already been added as a sample to this session.';
    }
    if (msg.includes('lot_code')) {
      return 'A lot with this lot code already exists.';
    }
    return 'Duplicate entry: a record with these unique details already exists.';
  }

  // 4. Foreign key constraint violation - Error 1452
  if (err.errno === 1452) {
    return 'Referenced record does not exist (invalid farm, lot, roast, or session reference).';
  }

  // 5. Connection refused / bad credentials
  if (err.code === 'ECONNREFUSED') {
    return 'Could not connect to MySQL server. Please ensure MySQL is running on ' + (process.env.DB_HOST || 'localhost') + ':' + (process.env.DB_PORT || '3306');
  }
  if (err.errno === 1045) {
    return 'Database access denied: invalid MySQL username or password in .env';
  }
  if (err.errno === 1049) {
    return 'Database "coffee_tracker" does not exist. Please run npm run db:setup first.';
  }

  // Fallback
  return err.sqlMessage || err.message || 'Database error occurred';
}

module.exports = {
  pool,
  formatDbError
};
