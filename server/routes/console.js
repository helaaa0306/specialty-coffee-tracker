const express = require('express');
const router = express.Router();
const path = require('path');
const { spawnSync } = require('child_process');
const mysql = require('mysql2/promise');
const { pool: defaultPool } = require('../db');

// Separate pool for SQL Console if CONSOLE_DB_USER is configured in .env
let consolePool = null;
if (process.env.CONSOLE_DB_USER) {
  consolePool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.CONSOLE_DB_USER,
    password: process.env.CONSOLE_DB_PASSWORD || '',
    database: process.env.DB_NAME || 'coffee_tracker',
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    decimalNumbers: true,
    dateStrings: true,
    multipleStatements: false
  });
}

function getDbPool() {
  return consolePool || defaultPool;
}

// Table / View allowlist for built-in describe and sample commands
const ALLOWED_OBJECTS = [
  'farm',
  'lot',
  'roast_log',
  'cupping_session',
  'cupping_sample',
  'cupping_score',
  'lot_price_log',
  'v_lot_stock',
  'v_lot_leaderboard',
  'v_score_traceability'
];

/**
 * Clean SQL string and validate statement count.
 * Returns: { cleanedSql, primaryVerb, error }
 */
function parseAndValidateSql(rawSql) {
  if (!rawSql || typeof rawSql !== 'string' || !rawSql.trim()) {
    return { error: 'SQL statement cannot be empty.' };
  }

  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  let cleaned = '';
  let statementCount = 0;
  let hasCharsAfterSemicolon = false;

  const len = rawSql.length;
  let i = 0;

  while (i < len) {
    const char = rawSql[i];
    const nextChar = i + 1 < len ? rawSql[i + 1] : '';

    // Handle string literals and escapes
    if (inSingleQuote) {
      cleaned += char;
      if (char === '\\' && i + 1 < len) {
        cleaned += nextChar;
        i += 2;
        continue;
      }
      if (char === "'") {
        inSingleQuote = false;
      }
      i++;
      continue;
    }

    if (inDoubleQuote) {
      cleaned += char;
      if (char === '\\' && i + 1 < len) {
        cleaned += nextChar;
        i += 2;
        continue;
      }
      if (char === '"') {
        inDoubleQuote = false;
      }
      i++;
      continue;
    }

    if (inBacktick) {
      cleaned += char;
      if (char === '`') {
        inBacktick = false;
      }
      i++;
      continue;
    }

    // Handle comments
    if (inLineComment) {
      if (char === '\n' || char === '\r') {
        inLineComment = false;
        cleaned += '\n';
      }
      i++;
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // Check start of comment
    if (char === '-' && nextChar === '-') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (char === '#') {
      inLineComment = true;
      i++;
      continue;
    }
    if (char === '/' && nextChar === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }

    // Check quotes
    if (char === "'") {
      inSingleQuote = true;
      cleaned += char;
      i++;
      continue;
    }
    if (char === '"') {
      inDoubleQuote = true;
      cleaned += char;
      i++;
      continue;
    }
    if (char === '`') {
      inBacktick = true;
      cleaned += char;
      i++;
      continue;
    }

    // Check semicolon outside quotes and comments
    if (char === ';') {
      cleaned += ';';
      statementCount++;
      // Check remaining text
      const remaining = rawSql.slice(i + 1).replace(/\/\*[\s\S]*?\*\/|--.*|#.*/g, '').trim();
      if (remaining.length > 0) {
        hasCharsAfterSemicolon = true;
      }
      i++;
      continue;
    }

    cleaned += char;
    i++;
  }

  if (hasCharsAfterSemicolon) {
    return { error: 'Only one SQL statement is permitted per request (multiple statements rejected).' };
  }

  // Strip trailing whitespace and trailing semicolons
  let trimmed = cleaned.trim();
  while (trimmed.endsWith(';')) {
    trimmed = trimmed.slice(0, -1).trim();
  }

  if (!trimmed) {
    return { error: 'SQL statement cannot be empty.' };
  }

  // Check for forbidden keywords (case-insensitive word boundary check outside string literals)
  // Mask out string literals to avoid false positives on words like 'create' inside text
  const literalMasked = trimmed
    .replace(/'(?:\\.|[^\\'])*'/g, "''")
    .replace(/"(?:\\.|[^\\"])*"/g, '""');

  const forbiddenRegex = /\b(DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|RENAME|USE|SET|LOAD|INTO\s+OUTFILE|INTO\s+DUMPFILE|LOAD_FILE)\b/i;
  const forbiddenMatch = literalMasked.match(forbiddenRegex);
  if (forbiddenMatch) {
    return { error: `Operation '${forbiddenMatch[1].toUpperCase()}' is forbidden in the SQL Console.` };
  }

  // Extract primary verb
  const verbMatch = literalMasked.trim().match(/^([a-zA-Z]+)/);
  const primaryVerb = verbMatch ? verbMatch[1].toUpperCase() : '';

  return { cleanedSql: trimmed, primaryVerb, error: null };
}

// POST /api/console/execute - Execute SQL statement
router.post('/execute', async (req, res) => {
  const { sql, allowWrites } = req.body;
  const isWriteAllowed = Boolean(allowWrites);

  const { cleanedSql, primaryVerb, error } = parseAndValidateSql(sql);
  if (error) {
    return res.status(400).json({
      error: {
        code: 400,
        sqlState: '42000',
        message: error
      }
    });
  }

  // Read-only allowed verbs
  const readVerbs = ['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'WITH'];
  // Write allowed verbs
  const writeVerbs = ['INSERT', 'UPDATE', 'DELETE', 'CALL'];

  if (!isWriteAllowed) {
    if (writeVerbs.includes(primaryVerb)) {
      return res.status(400).json({
        error: {
          code: 403,
          sqlState: '42000',
          message: `Writes are disabled. Toggle 'Allow writes' to execute ${primaryVerb} statements.`
        }
      });
    }
    if (!readVerbs.includes(primaryVerb)) {
      return res.status(400).json({
        error: {
          code: 400,
          sqlState: '42000',
          message: `Command '${primaryVerb}' is not supported in the SQL Console.`
        }
      });
    }
  } else {
    if (!readVerbs.includes(primaryVerb) && !writeVerbs.includes(primaryVerb)) {
      return res.status(400).json({
        error: {
          code: 400,
          sqlState: '42000',
          message: `Command '${primaryVerb}' is not supported in the SQL Console.`
        }
      });
    }
  }

  const pool = getDbPool();
  const startTime = process.hrtime.bigint();

  try {
    // 10 second execution timeout via mysql2 query options
    const [results, fields] = await pool.query({
      sql: cleanedSql,
      timeout: 10000
    });

    const endTime = process.hrtime.bigint();
    const timeMs = Number((endTime - startTime) / 1000000n);

    // Format output based on command type
    if (primaryVerb === 'CALL') {
      // Stored procedures return array of result sets + OkPacket
      const resultSets = [];
      let totalAffected = 0;

      if (Array.isArray(results)) {
        for (const item of results) {
          if (Array.isArray(item)) {
            const cols = item.length > 0 ? Object.keys(item[0]) : [];
            const truncated = item.length > 500;
            resultSets.push({
              columns: cols,
              rows: truncated ? item.slice(0, 500) : item,
              rowCount: item.length,
              truncated
            });
          } else if (item && typeof item === 'object' && 'affectedRows' in item) {
            totalAffected += item.affectedRows || 0;
            resultSets.push({
              affectedRows: item.affectedRows,
              insertId: item.insertId
            });
          }
        }
      }

      const firstTabular = resultSets.find(rs => rs.columns !== undefined);
      return res.json({
        isCall: true,
        resultSets,
        columns: firstTabular ? firstTabular.columns : [],
        rows: firstTabular ? firstTabular.rows : [],
        rowCount: firstTabular ? firstTabular.rows.length : 0,
        affectedRows: totalAffected,
        truncated: resultSets.some(rs => rs.truncated),
        timeMs
      });
    }

    if (Array.isArray(results)) {
      // Tabular query (SELECT, SHOW, DESCRIBE, EXPLAIN, WITH)
      const truncated = results.length > 500;
      const rows = truncated ? results.slice(0, 500) : results;
      const columns = fields && fields.length
        ? fields.map(f => f.name)
        : (rows.length > 0 ? Object.keys(rows[0]) : []);

      return res.json({
        columns,
        rows,
        rowCount: results.length,
        affectedRows: 0,
        truncated,
        timeMs
      });
    }

    // Mutation query (INSERT, UPDATE, DELETE)
    return res.json({
      columns: [],
      rows: [],
      rowCount: 0,
      affectedRows: results.affectedRows || 0,
      insertId: results.insertId || null,
      changedRows: results.changedRows || 0,
      truncated: false,
      timeMs
    });

  } catch (err) {
    const endTime = process.hrtime.bigint();
    const timeMs = Number((endTime - startTime) / 1000000n);

    // Return exact MySQL error codes and messages
    const code = err.errno || err.code || 1000;
    const sqlState = err.sqlState || 'HY000';
    const message = err.sqlMessage || err.message || 'Unknown database error';

    return res.status(400).json({
      error: {
        code,
        sqlState,
        message,
        timeMs
      }
    });
  }
});

// POST /api/console/reset - Reset sample data by executing db:setup
router.post('/reset', (req, res) => {
  const { allowWrites } = req.body;
  if (!allowWrites) {
    return res.status(400).json({
      error: {
        code: 403,
        sqlState: '42000',
        message: "Resetting sample data requires 'Allow writes' to be enabled."
      }
    });
  }

  try {
    const setupScript = path.resolve(__dirname, '../../scripts/db-setup.js');
    const result = spawnSync(process.execPath, [setupScript], {
      stdio: 'pipe',
      encoding: 'utf8'
    });

    if (result.status !== 0) {
      return res.status(500).json({
        error: {
          code: 500,
          sqlState: 'HY000',
          message: 'Reset script failed: ' + (result.stderr || result.stdout || 'Unknown error')
        }
      });
    }

    res.json({
      success: true,
      message: 'Database schema and sample data reset successfully.'
    });
  } catch (err) {
    res.status(500).json({
      error: {
        code: 500,
        sqlState: 'HY000',
        message: 'Failed to reset database: ' + err.message
      }
    });
  }
});

// GET /api/console/meta - Schema objects and sample queries grouped
router.get('/meta', (req, res) => {
  const metadata = {
    tables: [
      { name: 'farm', desc: 'Coffee farms and estates of origin' },
      { name: 'lot', desc: 'Purchased green coffee lots and varieties' },
      { name: 'roast_log', desc: 'Roasting batches and weight logs' },
      { name: 'cupping_session', desc: 'Cupping table sessions' },
      { name: 'cupping_sample', desc: 'Blind-coded samples on cupping tables' },
      { name: 'cupping_score', desc: '10-attribute sensory score sheets' },
      { name: 'lot_price_log', desc: 'Audit log for green lot price adjustments' }
    ],
    views: [
      { name: 'v_lot_stock', desc: 'Stock remaining per lot and LOW badges' },
      { name: 'v_lot_leaderboard', desc: 'Ranked lots by average cupping score' },
      { name: 'v_score_traceability', desc: 'Traceability: score -> sample -> roast -> farm' }
    ],
    procedures: [
      { name: 'sp_add_roast', desc: 'Add roast with row lock and stock validation' },
      { name: 'sp_session_summary', desc: 'Ranked cupping results for a session table' },
      { name: 'sp_lot_report', desc: 'Full origin, stock, and quality profile for a lot' }
    ],
    triggers: [
      { name: 'trg_roast_stock_check', desc: 'Prevents over-allocation of green coffee stock' },
      { name: 'trg_lot_price_audit', desc: 'Audit trails every purchase price modification' },
      { name: 'trg_score_cupper_name', desc: 'Rejects empty or whitespace-only cupper names' }
    ],
    sampleQueries: {
      Joins: [
        {
          name: 'Q1. Lots with farm of origin',
          sql: `SELECT l.lot_code, f.farm_name, f.country, f.region, l.variety, l.process, l.quantity_kg\nFROM lot AS l\nINNER JOIN farm AS f ON f.farm_id = l.farm_id\nORDER BY f.country, l.lot_code;`
        },
        {
          name: 'Q2. Roast history with lot and farm',
          sql: `SELECT r.roast_id, r.roast_date, r.roast_level, l.lot_code, f.farm_name, r.green_kg, r.roasted_kg\nFROM roast_log AS r\nINNER JOIN lot  AS l ON l.lot_id  = r.lot_id\nINNER JOIN farm AS f ON f.farm_id = l.farm_id\nORDER BY r.roast_date, r.roast_id;`
        },
        {
          name: 'Q3. Samples on cupping table (blind code vs truth)',
          sql: `SELECT cs.session_id, cs.blind_code, l.lot_code, r.roast_level, f.farm_name\nFROM cupping_sample AS cs\nINNER JOIN roast_log AS r ON r.roast_id = cs.roast_id\nINNER JOIN lot       AS l ON l.lot_id   = r.lot_id\nINNER JOIN farm      AS f ON f.farm_id  = l.farm_id\nORDER BY cs.session_id, cs.blind_code;`
        },
        {
          name: 'Q4. Full traceability: score sheet -> farm',
          sql: `SELECT sc.score_id, sc.cupper_name, sc.total_score, cs.blind_code, ses.session_date,\n       r.roast_level, l.lot_code, f.farm_name, f.country\nFROM cupping_score AS sc\nINNER JOIN cupping_sample  AS cs  ON cs.sample_id  = sc.sample_id\nINNER JOIN cupping_session AS ses ON ses.session_id = cs.session_id\nINNER JOIN roast_log       AS r   ON r.roast_id    = cs.roast_id\nINNER JOIN lot             AS l   ON l.lot_id      = r.lot_id\nINNER JOIN farm            AS f   ON f.farm_id     = l.farm_id\nORDER BY sc.total_score DESC;`
        }
      ],
      Aggregates: [
        {
          name: 'Q5. Green coffee remaining per lot',
          sql: `SELECT l.lot_code, l.quantity_kg AS bought_kg,\n       COALESCE(SUM(r.green_kg),0) AS roasted_kg,\n       l.quantity_kg - COALESCE(SUM(r.green_kg),0) AS remaining_kg\nFROM lot AS l\nLEFT JOIN roast_log AS r ON r.lot_id = l.lot_id\nGROUP BY l.lot_id, l.lot_code, l.quantity_kg\nORDER BY remaining_kg;`
        },
        {
          name: 'Q6. Lots running low (< 10 kg)',
          sql: `SELECT l.lot_code, l.quantity_kg - COALESCE(SUM(r.green_kg),0) AS remaining_kg\nFROM lot AS l\nLEFT JOIN roast_log AS r ON r.lot_id = l.lot_id\nGROUP BY l.lot_id, l.lot_code, l.quantity_kg\nHAVING remaining_kg < 10\nORDER BY remaining_kg;`
        },
        {
          name: 'Q7. Weight loss % by roast level',
          sql: `SELECT roast_level, COUNT(*) AS roasts,\n       ROUND(AVG((green_kg - roasted_kg) / green_kg * 100), 2) AS avg_loss_pct\nFROM roast_log\nGROUP BY roast_level\nORDER BY avg_loss_pct;`
        },
        {
          name: 'Q8. Lots ranked by average cupping score',
          sql: `SELECT l.lot_code, f.farm_name, COUNT(sc.score_id) AS sheets,\n       ROUND(AVG(sc.total_score), 2) AS avg_score\nFROM lot AS l\nINNER JOIN farm AS f           ON f.farm_id = l.farm_id\nINNER JOIN roast_log AS r      ON r.lot_id = l.lot_id\nINNER JOIN cupping_sample AS cs ON cs.roast_id = r.roast_id\nINNER JOIN cupping_score AS sc  ON sc.sample_id = cs.sample_id\nGROUP BY l.lot_id, l.lot_code, f.farm_name\nORDER BY avg_score DESC;`
        },
        {
          name: 'Q9. Average score by processing method',
          sql: `SELECT l.process, ROUND(AVG(sc.total_score), 2) AS avg_score, COUNT(*) AS sheets\nFROM lot AS l\nINNER JOIN roast_log AS r       ON r.lot_id = l.lot_id\nINNER JOIN cupping_sample AS cs ON cs.roast_id = r.roast_id\nINNER JOIN cupping_score AS sc  ON sc.sample_id = cs.sample_id\nGROUP BY l.process\nORDER BY avg_score DESC;`
        },
        {
          name: 'Q10. Cupper strictness calibration',
          sql: `SELECT cupper_name, COUNT(*) AS sheets, ROUND(AVG(total_score),2) AS avg_given,\n       MIN(total_score) AS lowest, MAX(total_score) AS highest\nFROM cupping_score\nGROUP BY cupper_name\nORDER BY avg_given;`
        },
        {
          name: 'Q11. Purchase value per farm',
          sql: `SELECT f.farm_name, COUNT(l.lot_id) AS lots, SUM(l.quantity_kg) AS total_kg,\n       SUM(l.quantity_kg * l.price_per_kg) AS purchase_value_inr\nFROM farm AS f\nLEFT JOIN lot AS l ON l.farm_id = f.farm_id\nGROUP BY f.farm_id, f.farm_name\nORDER BY purchase_value_inr DESC;`
        }
      ],
      Subqueries: [
        {
          name: 'Q12. Lots costing above average price/kg',
          sql: `SELECT lot_code, variety, price_per_kg\nFROM lot\nWHERE price_per_kg > (SELECT AVG(price_per_kg) FROM lot)\nORDER BY price_per_kg DESC;`
        },
        {
          name: 'Q13. Samples scoring above overall average',
          sql: `SELECT cs.session_id, cs.blind_code, ROUND(AVG(sc.total_score),2) AS avg_score\nFROM cupping_sample AS cs\nINNER JOIN cupping_score AS sc ON sc.sample_id = cs.sample_id\nGROUP BY cs.sample_id, cs.session_id, cs.blind_code\nHAVING AVG(sc.total_score) > (SELECT AVG(total_score) FROM cupping_score)\nORDER BY avg_score DESC;`
        },
        {
          name: 'Q14. Roasts never cupped (Correlated NOT EXISTS)',
          sql: `SELECT r.roast_id, r.roast_date, r.roast_level, l.lot_code\nFROM roast_log AS r\nINNER JOIN lot AS l ON l.lot_id = r.lot_id\nWHERE NOT EXISTS (SELECT 1 FROM cupping_sample AS cs WHERE cs.roast_id = r.roast_id);`
        },
        {
          name: 'Q15. Sheets above sample own average',
          sql: `SELECT sc.sample_id, sc.cupper_name, sc.total_score\nFROM cupping_score AS sc\nWHERE sc.total_score > (SELECT AVG(s2.total_score) FROM cupping_score AS s2 WHERE s2.sample_id = sc.sample_id)\nORDER BY sc.sample_id, sc.total_score DESC;`
        },
        {
          name: 'Q16. Lots with < 40% stock left (Derived table)',
          sql: `SELECT l.lot_code, l.quantity_kg, st.remaining_kg,\n       ROUND(st.remaining_kg / l.quantity_kg * 100, 1) AS pct_left\nFROM lot AS l\nINNER JOIN (\n    SELECT l2.lot_id, l2.quantity_kg - COALESCE(SUM(r.green_kg),0) AS remaining_kg\n    FROM lot AS l2\n    LEFT JOIN roast_log AS r ON r.lot_id = l2.lot_id\n    GROUP BY l2.lot_id, l2.quantity_kg\n) AS st ON st.lot_id = l.lot_id\nWHERE st.remaining_kg < 0.4 * l.quantity_kg\nORDER BY pct_left;`
        }
      ],
      Programming: [
        {
          name: 'View: v_lot_stock',
          sql: `SELECT * FROM v_lot_stock ORDER BY stock_remaining_kg;`
        },
        {
          name: 'View: v_lot_leaderboard',
          sql: `SELECT * FROM v_lot_leaderboard ORDER BY rank_no;`
        },
        {
          name: 'View: v_score_traceability',
          sql: `SELECT * FROM v_score_traceability LIMIT 20;`
        },
        {
          name: 'Function: fn_lot_stock(1)',
          sql: `SELECT fn_lot_stock(1) AS lot_1_remaining_green_kg;`
        },
        {
          name: 'Procedure: CALL sp_session_summary(2)',
          sql: `CALL sp_session_summary(2);`
        },
        {
          name: 'Procedure: CALL sp_lot_report(5)',
          sql: `CALL sp_lot_report(5);`
        },
        {
          name: 'Procedure (Write): CALL sp_add_roast (Valid)',
          sql: `CALL sp_add_roast(1, '2026-03-20', 'Medium', 8.00, 6.80);`
        },
        {
          name: 'Procedure (Write): CALL sp_add_roast (Over-stock trigger)',
          sql: `CALL sp_add_roast(5, '2026-03-21', 'Light', 5.00, 4.30);`
        },
        {
          name: 'Audit: SELECT * FROM lot_price_log',
          sql: `SELECT * FROM lot_price_log;`
        }
      ]
    }
  };

  res.json(metadata);
});

module.exports = router;
