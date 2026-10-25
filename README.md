# Specialty Coffee Cupping & Bean Tracker

A comprehensive, full-stack database management system (DBMS) built for specialty coffee micro-roasteries. It provides end-to-end traceability from origin farm harvests and green coffee inventory to production roasting batches and SCA-standard blind sensory cupping evaluations.

---

## 1. Tech Stack

- **Backend**: Node.js 18+, Express, `mysql2` (promise-based connection pool), `dotenv`, `cors`.
- **Frontend**: Vanilla HTML5, semantic CSS3 (custom espresso/cream/caramel design system), Vanilla JavaScript (served directly from `/public`, zero build step, no framework overhead).
- **Database**: MySQL 8.0.16+ (InnoDB engine, strict SQL mode, stored procedures, triggers, deterministic functions, views, window functions, generated columns, and row-level locking).

---

## 2. Prerequisites

1. **Node.js**: v18.0.0 or higher ([Download Node.js](https://nodejs.org/)).
2. **MySQL Server**: v8.0.16 or higher (MySQL 8.0, 8.4 LTS, or 26.x Innovation) running on port `3306`.
3. **MySQL CLI** or **MySQL Workbench** (for running SQL migrations with `DELIMITER` support).

---

## 3. Step-by-Step Setup & Running

### Step 1: Clone the Repository
```bash
git clone <your-repo-url>
cd specialty-coffee-tracker
```

### Step 2: Install Node.js Dependencies
```bash
npm install
```

### Step 3: Configure Environment Variables
Copy `.env.example` to create your local `.env`:
```bash
cp .env.example .env
```
Open `.env` and set your MySQL credentials:
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=coffee_tracker
PORT=3000
```

### Step 4: Run Database Migrations
Execute the automated database setup script:
```bash
npm run db:setup
```
This script automatically detects your MySQL CLI binary (including Windows standard install paths), connects to your database, and executes the three SQL files in strict order:
1. `database/01_schema_and_data.sql` (Creates database `coffee_tracker`, tables, constraints, generated columns, and seed data)
2. `database/02_queries_phase2.sql` (Executes Phase II analytical joins, aggregates, and subqueries)
3. `database/03_programming_phase3.sql` (Creates audit table, views, function, triggers, and stored procedures)

#### Manual Alternative (MySQL Workbench / MySQL Command Line Client)
If you prefer running migrations manually in MySQL Workbench or the `mysql` CLI:
```bash
mysql -u root -p < database/01_schema_and_data.sql
mysql -u root -p coffee_tracker < database/02_queries_phase2.sql
mysql -u root -p coffee_tracker < database/03_programming_phase3.sql
```

### Step 5: Start the Web Application
```bash
# Production mode
npm start

# Or development mode with auto-reload
npm run dev
```

### Step 6: Access the Application
Open your browser and navigate to:
```
http://localhost:3000
```

---

## 4. REST API Reference

All API responses are in JSON format. Input validation is performed on both the server and the database engine.

| Method | Endpoint | Description | Request Body / Parameters |
|---|---|---|---|
| `GET` | `/api/health` | System health check and database connectivity | None |
| `GET` | `/api/farms` | List all coffee farms ordered by name | None |
| `POST` | `/api/farms` | Register a new origin farm | `{ farm_name, country, region?, altitude_masl? }` |
| `GET` | `/api/lots` | List all lots with origin and stock from `v_lot_stock` | None |
| `POST` | `/api/lots` | Register a new green coffee lot | `{ farm_id, lot_code, supplier_name?, variety?, process, harvest_year?, purchase_date?, quantity_kg, price_per_kg? }` |
| `GET` | `/api/lots/:id` | Full lot report (`sp_lot_report`) + roast log + score traceability | None (`:id` = lot ID) |
| `GET` | `/api/roasts` | List roast history with lot code, farm, and weight-loss % | None |
| `POST` | `/api/roasts` | Record a roast batch via `CALL sp_add_roast(?,?,?,?,?)` | `{ lot_id, roast_date, roast_level, green_kg, roasted_kg }` |
| `GET` | `/api/sessions` | List all cupping session tables with sample counts | None |
| `POST` | `/api/sessions` | Create a new cupping session | `{ session_date, notes? }` |
| `GET` | `/api/sessions/:id` | Session samples + ranking summary (`sp_session_summary`) + score sheets | None (`:id` = session ID) |
| `POST` | `/api/sessions/:id/samples` | Add a roast sample to a session with a blind code | `{ roast_id, blind_code }` |
| `POST` | `/api/samples/:id/scores` | Record a 10-attribute cupper score sheet | `{ cupper_name, fragrance_aroma, flavor, aftertaste, acidity, body, balance, uniformity, clean_cup, sweetness, overall, defect_deduction }` |
| `GET` | `/api/leaderboard` | View `v_lot_leaderboard` + avg score by process + cupper stats | None |
| `GET` | `/api/stats` | Roastery counts (lots, stock kg, roasts, avg score) | None |

---

## 5. Database Logic (Procedures, Triggers, Views, Functions)

The application strictly leverages the database logic defined in `03_programming_phase3.sql` instead of re-implementing rules in JavaScript:

### Stored Procedures
- **`sp_add_roast(p_lot_id, p_date, p_level, p_green, p_roasted)`**:
  - Implements concurrency control with `START TRANSACTION` and row-level locking (`SELECT lot_id FROM lot WHERE lot_id = p_lot_id FOR UPDATE`).
  - Ensures two concurrent roast operations cannot over-allocate remaining stock.
  - Inserts into `roast_log` (triggering stock check) and returns `LAST_INSERT_ID()` along with remaining green kilograms.
- **`sp_session_summary(p_session_id)`**:
  - Aggregates sample scores for a specific cupping table session.
  - Returns `blind_code`, `lot_code`, `roast_level`, sheets evaluated, and average total score ordered by rank.
- **`sp_lot_report(p_lot_id)`**:
  - Produces a single-row report for a green lot containing origin farm, country, botanical variety, process, initial quantity, remaining stock, and historical average cupping score across all roasts and sessions.

### Triggers
- **`trg_roast_stock_check`** (`BEFORE INSERT ON roast_log`):
  - Calls `fn_lot_stock(NEW.lot_id)`.
  - If `NEW.green_kg > fn_lot_stock`, raises `SQLSTATE '45000'` with the message:
    `'Roast exceeds remaining green coffee stock for this lot'`.
- **`trg_lot_price_audit`** (`AFTER UPDATE ON lot`):
  - Audits price adjustments by logging `old_price`, `new_price`, and timestamp into `lot_price_log`.
- **`trg_score_cupper_name`** (`BEFORE INSERT ON cupping_score`):
  - Enforces that cupper names are not empty or blank spaces; raises `SQLSTATE '45000'` with:
    `'Cupper name cannot be blank'`.

### Stored Function
- **`fn_lot_stock(p_lot_id)`**:
  - Computes green coffee remaining: `quantity_kg - COALESCE(SUM(green_kg), 0)`.

### Views
- **`v_lot_stock`**:
  - Aggregates total green coffee roasted and calculates `stock_remaining_kg`. Flags lots with less than 10 kg remaining with `stock_status = 'LOW'`.
- **`v_lot_leaderboard`**:
  - Ranks coffee lots across all sessions using MySQL 8 window function:
    `RANK() OVER (ORDER BY AVG(sc.total_score) DESC) AS rank_no`.
- **`v_score_traceability`**:
  - Provides full traceability joining score sheet &rarr; sample blind code &rarr; cupping session &rarr; roast batch &rarr; green lot &rarr; farm of origin.

---

## 6. How to Test the Database Rules

The application traps all database-level errors (triggers, CHECK constraints, and unique keys) and translates them into clean HTTP 400 responses displayed in visible in-page alert banners.

Here are 4 concrete verification tests:

### Test 1: Over-Stock Roast (Trigger `trg_roast_stock_check`)
- **Action**: On the **Roast Log** page (`roasts.html`), select lot `ET-KO-2526-01` (Lot ID 5), which only has 3.00 kg remaining. Enter `5.00` kg for Green Coffee Input and `4.30` kg for Roasted Coffee. Click **Submit Roast**.
- **Database Trigger**: `trg_roast_stock_check` fires and detects `5.00 > fn_lot_stock(5)`.
- **Expected Error Banner**:
  ```
  Roast exceeds remaining green coffee stock for this lot
  ```

### Test 2: Roasted Weight Greater Than Green (CHECK `chk_roast_roasted`)
- **Action**: On the **Roast Log** page (`roasts.html`), select lot `IN-BB-2526-01` (Lot ID 1). Enter `10.00` kg for Green Coffee and `12.00` kg for Roasted Coffee. Click **Submit Roast**.
- **Database Constraint**: `CONSTRAINT chk_roast_roasted CHECK (roasted_kg > 0 AND roasted_kg <= green_kg)` is violated.
- **Expected Error Banner**:
  ```
  Roasted weight must be less than or equal to green coffee weight.
  ```

### Test 3: Duplicate Cupper Score on Same Sample (UNIQUE `uq_sample_cupper`)
- **Action**: On the **Cupping** page (`cupping.html`), open Session 1. Select Sample `A1` and enter cupper name `Aarav` (who has already evaluated Sample A1 in seed data). Submit the score sheet.
- **Database Constraint**: `CONSTRAINT uq_sample_cupper UNIQUE (sample_id, cupper_name)` is violated.
- **Expected Error Banner**:
  ```
  This cupper has already submitted a score sheet for this sample.
  ```

### Test 4: Blank Cupper Name (Trigger `trg_score_cupper_name`)
- **Action**: On the **Cupping** page (`cupping.html`), open any session, pick a sample, and enter only blank spaces `"   "` in the Cupper Name field. Click **Submit Cupping Score Sheet**.
- **Database Trigger**: `trg_score_cupper_name` fires `IF TRIM(NEW.cupper_name) = '' THEN SIGNAL SQLSTATE '45000'`.
- **Expected Error Banner**:
  ```
  Cupper name cannot be blank.
  ```

---

## 7. Git & GitHub Setup

To connect this local repository to your remote GitHub repository:

```bash
# Add your GitHub remote repository
git remote add origin https://github.com/YOUR_USERNAME/specialty-coffee-tracker.git

# Verify branch is main
git branch -M main

# Push to GitHub (do not run until you are ready)
git push -u origin main
```
