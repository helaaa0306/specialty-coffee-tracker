#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || '3306';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : '';
const DB_NAME = process.env.DB_NAME || 'coffee_tracker';

console.log('------------------------------------------------------------');
console.log(' Specialty Coffee Tracker - Database Setup');
console.log('------------------------------------------------------------');
console.log(`Target: ${DB_USER}@${DB_HOST}:${DB_PORT} [Database: ${DB_NAME}]`);

// Detect MySQL executable
function findMysqlBinary() {
  if (process.env.MYSQL_PATH && fs.existsSync(process.env.MYSQL_PATH)) {
    return process.env.MYSQL_PATH;
  }

  // Check if mysql command is in system PATH
  const checkCmd = spawnSync('mysql', ['--version'], { stdio: 'pipe' });
  if (checkCmd.status === 0) {
    return 'mysql';
  }

  // Fallback candidates on Windows and Unix
  const candidates = [
    'C:\\Program Files\\MySQL\\MySQL Server 26.7\\bin\\mysql.exe',
    'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe',
    'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe',
    'C:\\Program Files (x86)\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe',
    'C:\\xampp\\mysql\\bin\\mysql.exe',
    'C:\\laragon\\bin\\mysql\\current\\bin\\mysql.exe',
    '/usr/bin/mysql',
    '/usr/local/bin/mysql',
    '/opt/homebrew/bin/mysql'
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return 'mysql';
}

const mysqlBin = findMysqlBinary();
console.log(`Using MySQL CLI binary: ${mysqlBin}`);

const sqlFiles = [
  path.resolve(__dirname, '../database/01_schema_and_data.sql'),
  path.resolve(__dirname, '../database/02_queries_phase2.sql'),
  path.resolve(__dirname, '../database/03_programming_phase3.sql')
];

let allSuccess = true;

for (const filePath of sqlFiles) {
  const fileName = path.basename(filePath);
  console.log(`\nExecuting ${fileName}...`);

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    allSuccess = false;
    break;
  }

  const sqlContent = fs.readFileSync(filePath, 'utf8');

  // Build CLI arguments
  const args = [
    `--host=${DB_HOST}`,
    `--port=${DB_PORT}`,
    `--user=${DB_USER}`,
    '--default-character-set=utf8mb4'
  ];

  if (DB_PASSWORD) {
    args.push(`--password=${DB_PASSWORD}`);
  }

  // For 02 and 03, specify the database explicitly if needed, but the scripts have 'USE coffee_tracker;'
  const result = spawnSync(mysqlBin, args, {
    input: sqlContent,
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });

  if (result.status !== 0) {
    console.error(`Failed executing ${fileName}:`);
    if (result.stderr) console.error(result.stderr.trim());
    if (result.error) console.error(result.error.message);
    allSuccess = false;
    break;
  } else {
    console.log(`✓ ${fileName} executed successfully.`);
  }
}

console.log('\n------------------------------------------------------------');
if (allSuccess) {
  console.log('✓ Database setup completed successfully!');
  console.log('  All tables, sample data, views, functions, triggers,');
  console.log('  and stored procedures are initialized.');
  console.log('------------------------------------------------------------\n');
  process.exit(0);
} else {
  console.error('✗ Database setup failed.');
  console.error('  Please verify your credentials in .env or run the SQL files in order');
  console.error('  using MySQL Workbench or MySQL Command Line Client:');
  console.error('    1. database/01_schema_and_data.sql');
  console.error('    2. database/02_queries_phase2.sql');
  console.error('    3. database/03_programming_phase3.sql');
  console.error('------------------------------------------------------------\n');
  process.exit(1);
}
