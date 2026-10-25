#!/usr/bin/env node
/**
 * Automated API Test Suite for Specialty Coffee Tracker
 * Verifies all endpoints and database rules (triggers, check constraints, procedures, views).
 */
const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const app = require('../server/index');
const PORT = 3001; // Use test port

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: 'localhost',
        port: PORT,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (e) {
            parsed = data;
          }
          resolve({ status: res.statusCode, data: parsed });
        });
      }
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('====================================================');
  console.log(' Specialty Coffee Tracker - API Test Suite');
  console.log('====================================================\n');

  const server = app.listen(PORT);
  let passed = 0;
  let failed = 0;

  function assert(title, condition, extraInfo = '') {
    if (condition) {
      console.log(`✓ [PASS] ${title}`);
      passed++;
    } else {
      console.error(`✗ [FAIL] ${title} ${extraInfo ? '-> ' + extraInfo : ''}`);
      failed++;
    }
  }

  try {
    // 1. Health check
    const health = await request('GET', '/api/health');
    assert('GET /api/health (Database connectivity)', health.status === 200 && health.data.database === 'connected');

    if (health.status !== 200) {
      console.error('\n⚠️ Cannot reach database. Halting test suite.');
      console.error('Error detail:', health.data.error);
      server.close();
      process.exit(1);
    }

    // 2. Stats endpoint
    const stats = await request('GET', '/api/stats');
    assert('GET /api/stats (Dashboard counts)', stats.status === 200 && typeof stats.data.total_lots === 'number');

    // 3. Farms endpoints
    const farms = await request('GET', '/api/farms');
    assert('GET /api/farms (List farms)', farms.status === 200 && Array.isArray(farms.data));

    const newFarm = await request('POST', '/api/farms', {
      farm_name: 'Test Hacienda ' + Date.now(),
      country: 'Panama',
      region: 'Boquete',
      altitude_masl: 1650
    });
    assert('POST /api/farms (Add farm)', newFarm.status === 201 && newFarm.data.farm_id > 0);

    // 4. Lots endpoints
    const lots = await request('GET', '/api/lots');
    assert('GET /api/lots (List lots from v_lot_stock)', lots.status === 200 && Array.isArray(lots.data));

    const testLotCode = 'TEST-LOT-' + Math.floor(Math.random() * 10000);
    const newLot = await request('POST', '/api/lots', {
      farm_id: farms.data[0].farm_id,
      lot_code: testLotCode,
      supplier_name: 'Test Exporters',
      variety: 'Geisha',
      process: 'Natural',
      harvest_year: 2026,
      purchase_date: '2026-03-01',
      quantity_kg: 25.00,
      price_per_kg: 950.00
    });
    assert('POST /api/lots (Add lot with valid process)', newLot.status === 201 && newLot.data.lot_id > 0);

    const lotDetail = await request('GET', `/api/lots/${lots.data[0].lot_id}`);
    assert('GET /api/lots/:id (Lot report sp_lot_report + roasts + scores)', lotDetail.status === 200 && lotDetail.data.report && Array.isArray(lotDetail.data.roasts));

    // 5. Roasts endpoints
    const roasts = await request('GET', '/api/roasts');
    assert('GET /api/roasts (Roast history with weight-loss %)', roasts.status === 200 && Array.isArray(roasts.data));

    // Valid roast via sp_add_roast
    const validRoast = await request('POST', '/api/roasts', {
      lot_id: newLot.data.lot_id,
      roast_date: '2026-03-25',
      roast_level: 'Medium',
      green_kg: 5.00,
      roasted_kg: 4.25
    });
    assert('POST /api/roasts (Valid roast via sp_add_roast)', validRoast.status === 201 && validRoast.data.roast_id > 0);

    // Over-stock roast -> Trigger trg_roast_stock_check
    const overStockRoast = await request('POST', '/api/roasts', {
      lot_id: newLot.data.lot_id,
      roast_date: '2026-03-26',
      roast_level: 'Light',
      green_kg: 50.00, // lot only had 20 kg left!
      roasted_kg: 42.00
    });
    assert(
      'Trigger Check: Over-stock roast fails (trg_roast_stock_check)',
      overStockRoast.status === 400 && /stock/i.test(overStockRoast.data.error),
      overStockRoast.data.error
    );

    // CHECK constraint test: roasted > green
    const invalidWeightRoast = await request('POST', '/api/roasts', {
      lot_id: newLot.data.lot_id,
      roast_date: '2026-03-26',
      roast_level: 'Light',
      green_kg: 5.00,
      roasted_kg: 6.00 // invalid!
    });
    assert(
      'CHECK Constraint: roasted_kg > green_kg rejected',
      invalidWeightRoast.status === 400 && /roasted weight/i.test(invalidWeightRoast.data.error),
      invalidWeightRoast.data.error
    );

    // 6. Cupping Sessions endpoints
    const sessions = await request('GET', '/api/sessions');
    assert('GET /api/sessions (List sessions)', sessions.status === 200 && Array.isArray(sessions.data));

    const newSession = await request('POST', '/api/sessions', {
      session_date: '2026-03-27',
      notes: 'Automated test tasting session'
    });
    assert('POST /api/sessions (Create session)', newSession.status === 201 && newSession.data.session_id > 0);

    const sessionId = newSession.data.session_id;

    // Add sample
    const newSample = await request('POST', `/api/sessions/${sessionId}/samples`, {
      roast_id: validRoast.data.roast_id,
      blind_code: 'T1'
    });
    assert('POST /api/sessions/:id/samples (Add sample with blind code)', newSample.status === 201 && newSample.data.sample_id > 0);

    const sampleId = newSample.data.sample_id;

    // Session details + summary (sp_session_summary)
    const sessionDetails = await request('GET', `/api/sessions/${sessionId}`);
    assert('GET /api/sessions/:id (Summary sp_session_summary)', sessionDetails.status === 200 && Array.isArray(sessionDetails.data.summary));

    // Submit valid score sheet
    const scoreSheet = await request('POST', `/api/samples/${sampleId}/scores`, {
      cupper_name: 'Tester_One',
      fragrance_aroma: 8.00,
      flavor: 8.25,
      aftertaste: 8.00,
      acidity: 8.00,
      body: 8.00,
      balance: 8.00,
      uniformity: 10.00,
      clean_cup: 10.00,
      sweetness: 10.00,
      overall: 8.25,
      defect_deduction: 0.00
    });
    assert('POST /api/samples/:id/scores (Valid score sheet)', scoreSheet.status === 201 && scoreSheet.data.score.total_score > 0);

    // Duplicate score sheet for same sample + cupper (UNIQUE constraint uq_sample_cupper)
    const duplicateScore = await request('POST', `/api/samples/${sampleId}/scores`, {
      cupper_name: 'Tester_One',
      fragrance_aroma: 7.50,
      flavor: 7.50,
      aftertaste: 7.50,
      acidity: 7.50,
      body: 7.50,
      balance: 7.50,
      uniformity: 10.00,
      clean_cup: 10.00,
      sweetness: 10.00,
      overall: 7.50,
      defect_deduction: 0.00
    });
    assert(
      'UNIQUE Constraint: Duplicate cupper score rejected (uq_sample_cupper)',
      duplicateScore.status === 400 && /already submitted/i.test(duplicateScore.data.error),
      duplicateScore.data.error
    );

    // Blank cupper name -> Trigger trg_score_cupper_name
    const blankCupperScore = await request('POST', `/api/samples/${sampleId}/scores`, {
      cupper_name: '   ',
      fragrance_aroma: 8.00,
      flavor: 8.00,
      aftertaste: 8.00,
      acidity: 8.00,
      body: 8.00,
      balance: 8.00,
      uniformity: 10.00,
      clean_cup: 10.00,
      sweetness: 10.00,
      overall: 8.00,
      defect_deduction: 0.00
    });
    assert(
      'Trigger Check: Blank cupper name rejected (trg_score_cupper_name)',
      blankCupperScore.status === 400 && /blank/i.test(blankCupperScore.data.error),
      blankCupperScore.data.error
    );

    // 7. Leaderboard
    const leaderboard = await request('GET', '/api/leaderboard');
    assert('GET /api/leaderboard (v_lot_leaderboard + process + cuppers)', leaderboard.status === 200 && Array.isArray(leaderboard.data.rankedLots));

    console.log('\n====================================================');
    console.log(` Test Results: ${passed} Passed, ${failed} Failed`);
    console.log('====================================================\n');
  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    server.close();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
