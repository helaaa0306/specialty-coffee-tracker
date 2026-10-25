/**
 * Specialty Coffee Tracker - SQL Console Client
 * Terminal emulator with MySQL CLI ergonomics, table formatting, and built-in commands.
 */

(function () {
  'use strict';

  // State
  let allowWrites = false;
  let history = [];
  let historyIndex = -1;
  let draftInput = '';
  let metaData = null;

  // DOM Elements
  let terminalLog;
  let terminalInput;
  let writeToggle;
  let resetBtn;
  let modeBadge;

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

  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    terminalLog = document.getElementById('terminal-log');
    terminalInput = document.getElementById('terminal-input');
    writeToggle = document.getElementById('allow-writes-toggle');
    resetBtn = document.getElementById('reset-db-btn');
    modeBadge = document.getElementById('terminal-mode-badge');

    loadHistory();
    setupWriteToggle();
    setupInputHandlers();
    loadConsoleMeta();

    // Focus input on terminal body click
    document.querySelector('.terminal-body').addEventListener('click', (e) => {
      if (window.getSelection().toString().length === 0) {
        terminalInput.focus();
      }
    });

    terminalInput.focus();
  });

  // History management via localStorage
  function loadHistory() {
    try {
      const saved = localStorage.getItem('coffee_sql_console_history');
      if (saved) {
        history = JSON.parse(saved);
        if (!Array.isArray(history)) history = [];
      }
    } catch (e) {
      history = [];
    }
  }

  function saveCommandToHistory(cmd) {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    // Remove duplicate consecutive entries
    if (history.length > 0 && history[history.length - 1] === trimmed) {
      return;
    }
    history.push(trimmed);
    if (history.length > 50) {
      history = history.slice(-50);
    }
    try {
      localStorage.setItem('coffee_sql_console_history', JSON.stringify(history));
    } catch (e) {}
  }

  // Toggle writes configuration
  function setupWriteToggle() {
    const saved = localStorage.getItem('coffee_console_allow_writes');
    allowWrites = saved === 'true';
    if (writeToggle) {
      writeToggle.checked = allowWrites;
      updateWriteModeUI();

      writeToggle.addEventListener('change', () => {
        allowWrites = writeToggle.checked;
        localStorage.setItem('coffee_console_allow_writes', String(allowWrites));
        updateWriteModeUI();
        appendSystemMessage(
          allowWrites
            ? '⚡ Writes ENABLED. Commands: INSERT, UPDATE, DELETE, CALL are now allowed.'
            : '🔒 Read-only mode active. Commands: SELECT, SHOW, DESCRIBE, EXPLAIN, WITH.'
        );
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', handleResetData);
    }
  }

  function updateWriteModeUI() {
    if (modeBadge) {
      modeBadge.textContent = allowWrites ? 'WRITES ENABLED' : 'READ-ONLY';
      modeBadge.className = allowWrites ? 'badge badge-low' : 'badge badge-ok';
      modeBadge.style.fontSize = '0.7rem';
    }
    if (resetBtn) {
      resetBtn.disabled = !allowWrites;
      resetBtn.style.opacity = allowWrites ? '1' : '0.5';
      resetBtn.style.cursor = allowWrites ? 'pointer' : 'not-allowed';
    }
  }

  // Keyboard navigation and MySQL CLI multiline behavior
  function setupInputHandlers() {
    terminalInput.addEventListener('keydown', (e) => {
      // Ctrl + L: Clear terminal screen
      if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        clearScreen();
        return;
      }

      // Up arrow: History previous
      if (e.key === 'ArrowUp') {
        const isCursorAtStart = terminalInput.selectionStart === 0 && terminalInput.selectionEnd === 0;
        const isSingleLine = !terminalInput.value.includes('\n');

        if (isCursorAtStart || isSingleLine) {
          e.preventDefault();
          if (history.length === 0) return;

          if (historyIndex === -1) {
            draftInput = terminalInput.value;
            historyIndex = history.length - 1;
          } else if (historyIndex > 0) {
            historyIndex--;
          }
          terminalInput.value = history[historyIndex];
          autoResizeInput();
        }
        return;
      }

      // Down arrow: History next
      if (e.key === 'ArrowDown') {
        const isCursorAtEnd = terminalInput.selectionStart === terminalInput.value.length;
        const isSingleLine = !terminalInput.value.includes('\n');

        if (isCursorAtEnd || isSingleLine) {
          e.preventDefault();
          if (historyIndex !== -1) {
            if (historyIndex < history.length - 1) {
              historyIndex++;
              terminalInput.value = history[historyIndex];
            } else {
              historyIndex = -1;
              terminalInput.value = draftInput;
            }
            autoResizeInput();
          }
        }
        return;
      }

      // Enter key: Run statement if ends with ';' or if built-in command
      if (e.key === 'Enter') {
        if (e.shiftKey) {
          // Allow manual newline insertion
          return;
        }

        const currentVal = terminalInput.value.trim();
        const lower = currentVal.toLowerCase();

        // Built-in commands run without requiring semicolon
        const isBuiltin = [
          'help', 'clear', 'tables', 'views', 'procedures', 'triggers'
        ].includes(lower) || lower.startsWith('describe ') || lower.startsWith('desc ') || lower.startsWith('sample ');

        if (currentVal.endsWith(';') || isBuiltin) {
          e.preventDefault();
          executeConsoleInput(terminalInput.value);
          terminalInput.value = '';
          historyIndex = -1;
          draftInput = '';
          autoResizeInput();
        } else {
          // Continue statement on next line (mysql client continuation prompt)
          // Default behavior inserts newline
        }
      }
    });

    terminalInput.addEventListener('input', autoResizeInput);
  }

  function autoResizeInput() {
    terminalInput.style.height = 'auto';
    terminalInput.style.height = Math.min(200, Math.max(24, terminalInput.scrollHeight)) + 'px';
  }

  // Format clean ASCII tables (identical to mysql client)
  function formatAsciiTable(columns, rows) {
    if (!columns || !columns.length) return '';

    const colWidths = {};
    columns.forEach(col => {
      colWidths[col] = String(col).length;
    });

    rows.forEach(row => {
      columns.forEach(col => {
        let val = row[col];
        if (val === null || val === undefined) val = 'NULL';
        else if (typeof val === 'object') val = JSON.stringify(val);
        else val = String(val);
        colWidths[col] = Math.max(colWidths[col], val.length);
      });
    });

    // Border line: +-----+-------+
    let border = '+';
    columns.forEach(col => {
      border += '-'.repeat(colWidths[col] + 2) + '+';
    });

    // Header line: | col | col2  |
    let header = '|';
    columns.forEach(col => {
      header += ' ' + String(col).padEnd(colWidths[col]) + ' |';
    });

    // Rows
    const rowLines = rows.map(row => {
      let line = '|';
      columns.forEach(col => {
        let val = row[col];
        let isNull = false;
        if (val === null || val === undefined) {
          val = 'NULL';
          isNull = true;
        } else if (typeof val === 'object') {
          val = JSON.stringify(val);
        } else {
          val = String(val);
        }
        const isNum = !isNaN(Number(val)) && !isNull;
        const padded = isNum ? val.padStart(colWidths[col]) : val.padEnd(colWidths[col]);
        line += ' ' + padded + ' |';
      });
      return line;
    });

    return [border, header, border, ...rowLines, border].join('\n');
  }

  // Execute input
  async function executeConsoleInput(inputRaw) {
    const trimmed = inputRaw.trim();
    if (!trimmed) return;

    saveCommandToHistory(trimmed);

    // Create entry element
    const entry = document.createElement('div');
    entry.className = 'terminal-entry';

    const cmdLine = document.createElement('div');
    cmdLine.className = 'terminal-command-line';
    cmdLine.innerHTML = `<span class="terminal-prompt-label">mysql&gt;</span> <span>${escapeHtml(trimmed)}</span>`;
    entry.appendChild(cmdLine);
    terminalLog.appendChild(entry);
    scrollToBottom();

    // Check built-in commands first
    const lower = trimmed.toLowerCase().replace(/;+$/, '').trim();

    if (lower === 'clear') {
      clearScreen();
      return;
    }

    if (lower === 'help') {
      renderHelp(entry);
      scrollToBottom();
      return;
    }

    if (lower === 'tables') {
      renderTablesList(entry);
      scrollToBottom();
      return;
    }

    if (lower === 'views') {
      renderViewsList(entry);
      scrollToBottom();
      return;
    }

    if (lower === 'procedures') {
      renderProceduresList(entry);
      scrollToBottom();
      return;
    }

    if (lower === 'triggers') {
      renderTriggersList(entry);
      scrollToBottom();
      return;
    }

    if (lower.startsWith('describe ') || lower.startsWith('desc ')) {
      const parts = trimmed.replace(/;+$/, '').split(/\s+/);
      const targetTable = parts[1];
      if (!targetTable || !ALLOWED_OBJECTS.includes(targetTable.toLowerCase())) {
        renderError(entry, 1146, '42S02', `Table or view '${targetTable || ''}' does not exist or is not in the allowlist.`);
        scrollToBottom();
        return;
      }
      await runRemoteSql(`DESCRIBE ${targetTable};`, entry);
      return;
    }

    if (lower.startsWith('sample ')) {
      const parts = trimmed.replace(/;+$/, '').split(/\s+/);
      const targetTable = parts[1];
      if (!targetTable || !ALLOWED_OBJECTS.includes(targetTable.toLowerCase())) {
        renderError(entry, 1146, '42S02', `Table '${targetTable || ''}' does not exist or is not in allowlist. Allowed: ${ALLOWED_OBJECTS.join(', ')}`);
        scrollToBottom();
        return;
      }
      await runRemoteSql(`SELECT * FROM ${targetTable} LIMIT 10;`, entry);
      return;
    }

    // Remote SQL execution
    await runRemoteSql(trimmed, entry);
  }

  async function runRemoteSql(sql, entryEl) {
    try {
      const res = await fetch('/api/console/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, allowWrites })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.error) {
        const err = data.error || { code: res.status, sqlState: 'HY000', message: 'Request failed' };
        renderError(entryEl, err.code, err.sqlState, err.message);
      } else {
        renderQueryResult(entryEl, data);
      }
    } catch (netErr) {
      renderError(entryEl, 2002, 'HY000', `Connection error: ${netErr.message}`);
    }
    scrollToBottom();
  }

  function renderQueryResult(container, data) {
    const { columns, rows, rowCount, affectedRows, truncated, timeMs, isCall, resultSets } = data;

    if (isCall && resultSets && resultSets.length) {
      resultSets.forEach(rs => {
        if (rs.columns && rs.columns.length) {
          const pre = document.createElement('pre');
          pre.className = 'terminal-result-table';
          pre.textContent = formatAsciiTable(rs.columns, rs.rows);
          container.appendChild(pre);

          const stat = document.createElement('div');
          stat.className = 'terminal-status-line';
          stat.textContent = `${rs.rows.length} row${rs.rows.length === 1 ? '' : 's'} in set`;
          container.appendChild(stat);
        } else if (rs.affectedRows !== undefined) {
          const stat = document.createElement('div');
          stat.className = 'terminal-status-line';
          stat.textContent = `Query OK, ${rs.affectedRows} row${rs.affectedRows === 1 ? '' : 's'} affected`;
          container.appendChild(stat);
        }
      });

      const finalStatus = document.createElement('div');
      finalStatus.className = 'terminal-status-line';
      finalStatus.style.fontWeight = 'bold';
      finalStatus.textContent = `Procedure call completed (${(timeMs || 0).toFixed(2)} ms)${truncated ? ' [Results capped at 500 rows]' : ''}`;
      container.appendChild(finalStatus);
      return;
    }

    if (columns && columns.length) {
      if (rows && rows.length > 0) {
        const pre = document.createElement('pre');
        pre.className = 'terminal-result-table';
        pre.textContent = formatAsciiTable(columns, rows);
        container.appendChild(pre);
      } else {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'terminal-status-line';
        emptyMsg.textContent = 'Empty set';
        container.appendChild(emptyMsg);
      }

      const status = document.createElement('div');
      status.className = 'terminal-status-line';
      const count = rowCount !== undefined ? rowCount : rows.length;
      status.textContent = `${count} row${count === 1 ? '' : 's'} in set (${(timeMs || 0).toFixed(2)} ms)${truncated ? ' [Output truncated at 500 rows]' : ''}`;
      container.appendChild(status);
    } else {
      const status = document.createElement('div');
      status.className = 'terminal-status-line';
      status.textContent = `Query OK, ${affectedRows || 0} row${affectedRows === 1 ? '' : 's'} affected (${(timeMs || 0).toFixed(2)} ms)`;
      container.appendChild(status);
    }
  }

  function renderError(container, code, sqlState, message) {
    const errLine = document.createElement('div');
    errLine.className = 'terminal-error-line';
    errLine.textContent = `ERROR ${code || 1000} (${sqlState || 'HY000'}): ${message}`;
    container.appendChild(errLine);
  }

  function appendSystemMessage(msg) {
    const item = document.createElement('div');
    item.className = 'terminal-status-line';
    item.style.color = 'var(--color-caramel)';
    item.style.padding = '0.35rem 0';
    item.textContent = `[System] ${msg}`;
    terminalLog.appendChild(item);
    scrollToBottom();
  }

  function clearScreen() {
    terminalLog.innerHTML = '';
  }

  function scrollToBottom() {
    const body = document.querySelector('.terminal-body');
    if (body) {
      body.scrollTop = body.scrollHeight;
    }
  }

  // Built-in help and lists
  function renderHelp(container) {
    const text = [
      'Specialty Coffee Tracker SQL Console (MySQL 8.0+)',
      '========================================================================',
      'Built-in Commands:',
      '  help              Display this guide',
      '  clear             Clear screen (or press Ctrl + L)',
      '  tables            List database tables',
      '  views             List database views',
      '  procedures        List stored procedures',
      '  triggers          List database triggers',
      '  describe <table>  Show table schema and columns (e.g. describe lot)',
      '  sample <table>    Preview first 10 rows (e.g. sample farm)',
      '',
      'Terminal Keyboard Shortcuts:',
      '  Enter             Execute query (must end with ;) or run built-in command',
      '  Shift + Enter     Add a new line without executing',
      '  Up / Down Arrow   Cycle through previous 50 commands',
      '  Ctrl + L          Clear terminal screen',
      '',
      'Security Rules:',
      '  - Read-only allows SELECT, SHOW, DESCRIBE, EXPLAIN, WITH.',
      '  - Enable "Allow writes" toggle to execute INSERT, UPDATE, DELETE, CALL.',
      '  - Administrative DDL operations (DROP, ALTER, TRUNCATE, CREATE) are rejected.',
      '========================================================================'
    ].join('\n');

    const pre = document.createElement('pre');
    pre.className = 'terminal-result-text';
    pre.textContent = text;
    container.appendChild(pre);
  }

  function renderTablesList(container) {
    const tables = [
      { Table_Name: 'farm', Type: 'BASE TABLE', Purpose: 'Origin estates & farms' },
      { Table_Name: 'lot', Type: 'BASE TABLE', Purpose: 'Green coffee lots & varieties' },
      { Table_Name: 'roast_log', Type: 'BASE TABLE', Purpose: 'Production roasting batches' },
      { Table_Name: 'cupping_session', Type: 'BASE TABLE', Purpose: 'Cupping table sessions' },
      { Table_Name: 'cupping_sample', Type: 'BASE TABLE', Purpose: 'Blind-coded coffee samples' },
      { Table_Name: 'cupping_score', Type: 'BASE TABLE', Purpose: '10-attribute score sheets' },
      { Table_Name: 'lot_price_log', Type: 'BASE TABLE', Purpose: 'Audit log for lot price updates' }
    ];
    const pre = document.createElement('pre');
    pre.className = 'terminal-result-table';
    pre.textContent = formatAsciiTable(['Table_Name', 'Type', 'Purpose'], tables);
    container.appendChild(pre);
  }

  function renderViewsList(container) {
    const views = [
      { View_Name: 'v_lot_stock', Purpose: 'Stock remaining per lot & LOW badge alert' },
      { View_Name: 'v_lot_leaderboard', Purpose: 'Lots ranked by avg score via RANK() window fn' },
      { View_Name: 'v_score_traceability', Purpose: 'Full traceability: score -> sample -> roast -> farm' }
    ];
    const pre = document.createElement('pre');
    pre.className = 'terminal-result-table';
    pre.textContent = formatAsciiTable(['View_Name', 'Purpose'], views);
    container.appendChild(pre);
  }

  function renderProceduresList(container) {
    const procs = [
      { Procedure_Name: 'sp_add_roast', Params: '(lot_id, date, level, green_kg, roasted_kg)', Purpose: 'Add roast with row lock & stock trigger' },
      { Procedure_Name: 'sp_session_summary', Params: '(session_id)', Purpose: 'Ranked sample leaderboard for a cupping session' },
      { Procedure_Name: 'sp_lot_report', Params: '(lot_id)', Purpose: 'Single-row report with origin, stock & score' }
    ];
    const pre = document.createElement('pre');
    pre.className = 'terminal-result-table';
    pre.textContent = formatAsciiTable(['Procedure_Name', 'Params', 'Purpose'], procs);
    container.appendChild(pre);
  }

  function renderTriggersList(container) {
    const trgs = [
      { Trigger_Name: 'trg_roast_stock_check', Event: 'BEFORE INSERT ON roast_log', Purpose: 'Signals 45000 if roast exceeds lot stock' },
      { Trigger_Name: 'trg_lot_price_audit', Event: 'AFTER UPDATE ON lot', Purpose: 'Logs old & new price into lot_price_log' },
      { Trigger_Name: 'trg_score_cupper_name', Event: 'BEFORE INSERT ON cupping_score', Purpose: 'Signals 45000 if cupper name is blank' }
    ];
    const pre = document.createElement('pre');
    pre.className = 'terminal-result-table';
    pre.textContent = formatAsciiTable(['Trigger_Name', 'Event', 'Purpose'], trgs);
    container.appendChild(pre);
  }

  // Load metadata and populate sidebar
  async function loadConsoleMeta() {
    try {
      const res = await fetch('/api/console/meta');
      metaData = await res.json();

      // Render Tables & Views
      renderSidebarSchema(metaData);
      // Render Sample Queries
      renderSidebarSampleQueries(metaData.sampleQueries);
    } catch (err) {
      console.error('Failed to load console meta:', err);
    }
  }

  function renderSidebarSchema(meta) {
    const container = document.getElementById('sidebar-schema-list');
    if (!container) return;

    let html = '';
    html += '<div style="margin-bottom: 0.75rem;">';
    html += '<div style="font-size:0.75rem; color: var(--color-text-muted); text-transform:uppercase; margin-bottom: 0.25rem;">Tables (Click to describe)</div>';
    meta.tables.forEach(t => {
      html += `<div class="sidebar-item" data-action="describe" data-target="${t.name}">
        <span>${t.name}</span>
        <span style="font-size:0.7rem; color:var(--color-text-muted);">table</span>
      </div>`;
    });
    html += '</div>';

    html += '<div>';
    html += '<div style="font-size:0.75rem; color: var(--color-text-muted); text-transform:uppercase; margin-bottom: 0.25rem;">Views (Click to describe)</div>';
    meta.views.forEach(v => {
      html += `<div class="sidebar-item" data-action="describe" data-target="${v.name}">
        <span>${v.name}</span>
        <span style="font-size:0.7rem; color:var(--color-caramel);">view</span>
      </div>`;
    });
    html += '</div>';

    container.innerHTML = html;

    // Attach click listeners to describe items
    container.querySelectorAll('.sidebar-item').forEach(el => {
      el.addEventListener('click', () => {
        const target = el.getAttribute('data-target');
        terminalInput.value = `DESCRIBE ${target};`;
        terminalInput.focus();
        executeConsoleInput(terminalInput.value);
        terminalInput.value = '';
        autoResizeInput();
      });
    });
  }

  function renderSidebarSampleQueries(groups) {
    const container = document.getElementById('sidebar-queries-list');
    if (!container || !groups) return;

    let html = '';
    for (const [groupName, queries] of Object.entries(groups)) {
      html += `<div class="sidebar-group">
        <div class="query-group-header">
          <span>${escapeHtml(groupName)}</span>
          <span style="font-size: 0.75rem; font-weight: 500; color: var(--color-text-muted);">${queries.length}</span>
        </div>
        <div class="query-group-body">`;

      queries.forEach((q, idx) => {
        html += `<div class="query-item" data-group="${escapeHtml(groupName)}" data-idx="${idx}">
          <strong>${escapeHtml(q.name)}</strong>
        </div>`;
      });

      html += `</div></div>`;
    }

    container.innerHTML = html;

    // Click loads query into input without running
    container.querySelectorAll('.query-item').forEach(el => {
      el.addEventListener('click', () => {
        const group = el.getAttribute('data-group');
        const idx = parseInt(el.getAttribute('data-idx'), 10);
        const queryObj = groups[group][idx];
        if (queryObj && queryObj.sql) {
          terminalInput.value = queryObj.sql.trim();
          autoResizeInput();
          terminalInput.focus();
          // Scroll input into view
          terminalInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    });
  }

  // Reset sample data button
  async function handleResetData() {
    if (!allowWrites) return;

    const confirmed = confirm(
      '⚠️ Reset Database Sample Data?\n\nThis will re-run the 3 SQL scripts (01_schema_and_data, 02_queries_phase2, 03_programming_phase3) to restore fresh seed data.\n\nAre you sure you want to proceed?'
    );

    if (!confirmed) return;

    appendSystemMessage('Running database reset script via db:setup...');

    try {
      const res = await fetch('/api/console/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowWrites: true })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.error) {
        appendSystemMessage(`❌ Reset failed: ${data.error ? data.error.message : 'Unknown error'}`);
      } else {
        appendSystemMessage(`✓ Database reset completed successfully! Sample lots, roasts, sessions, and scores restored.`);
      }
    } catch (err) {
      appendSystemMessage(`❌ Reset error: ${err.message}`);
    }
  }

  // Quick action buttons in terminal toolbar
  window.clearConsole = function () {
    clearScreen();
    terminalInput.focus();
  };

  window.showConsoleHelp = function () {
    executeConsoleInput('help');
    terminalInput.focus();
  };

  window.escapeHtml = function (str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

})();
