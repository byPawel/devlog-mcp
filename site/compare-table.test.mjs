// Zero-dependency assertion script for the "How it compares" table in site/index.html.
// Verifies the multi-agent + concurrent-access columns exist and carry honest values.
// Run: node site/compare-table.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf-8');

// --- Isolate the .cmp table ----------------------------------------------
const tableMatch = html.match(/<table class="cmp">([\s\S]*?)<\/table>/);
assert.ok(tableMatch, 'expected a <table class="cmp"> in index.html');
const table = tableMatch[1];

// --- Extract thead header cells ------------------------------------------
const theadMatch = table.match(/<thead>([\s\S]*?)<\/thead>/);
assert.ok(theadMatch, 'expected a <thead> in the .cmp table');
const headerCells = [...theadMatch[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(
  (m) => m[1].trim(),
);

// (a) exactly 6 header columns
assert.equal(
  headerCells.length,
  6,
  `expected 6 <th> header cells, got ${headerCells.length}: ${JSON.stringify(headerCells)}`,
);

// (b) second-to-last header is the multi-agent column
assert.equal(
  headerCells[headerCells.length - 2],
  'Native multi-agent',
  `expected 5th header 'Native multi-agent', got '${headerCells[headerCells.length - 2]}'`,
);

// (c) last header is the concurrency column
assert.equal(
  headerCells[headerCells.length - 1],
  'Concurrent access',
  `expected 6th header 'Concurrent access', got '${headerCells[headerCells.length - 1]}'`,
);

// --- Extract the dokoro me-row -------------------------------------------
const meRowMatch = table.match(/<tr class="me-row">([\s\S]*?)<\/tr>/);
assert.ok(meRowMatch, 'expected a <tr class="me-row"> (dokoro row)');
const meCells = [...meRowMatch[1].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((m) => ({
  attrs: m[1],
  text: m[2].trim(),
}));

// (d) dokoro row has 6 <td> cells
assert.equal(
  meCells.length,
  6,
  `expected 6 <td> cells in me-row, got ${meCells.length}`,
);

// (e) 5th cell: multi-agent, class yes, mentions per-agent feedback
const multiAgentCell = meCells[4];
assert.match(
  multiAgentCell.attrs,
  /class="yes"/,
  'expected 5th me-row cell to have class="yes"',
);
assert.match(
  multiAgentCell.text,
  /per-agent feedback/,
  `expected 5th me-row cell to mention 'per-agent feedback', got '${multiAgentCell.text}'`,
);

// (f) 6th cell: concurrency, class yes, mentions WAL
const concurrencyCell = meCells[5];
assert.match(
  concurrencyCell.attrs,
  /class="yes"/,
  'expected 6th me-row cell to have class="yes"',
);
assert.match(
  concurrencyCell.text,
  /WAL/,
  `expected 6th me-row cell to mention 'WAL', got '${concurrencyCell.text}'`,
);

// --- Every body row must keep the table rectangular (6 cells) ------------
const tbodyMatch = table.match(/<tbody>([\s\S]*?)<\/tbody>/);
assert.ok(tbodyMatch, 'expected a <tbody> in the .cmp table');
const bodyRows = [...tbodyMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
for (const [i, row] of bodyRows.entries()) {
  const cellCount = [...row[1].matchAll(/<td[^>]*>/g)].length;
  assert.equal(
    cellCount,
    6,
    `body row ${i} has ${cellCount} <td> cells, expected 6 (table must stay rectangular)`,
  );
}

console.log(`PASS compare-table: 6 columns, ${bodyRows.length} rectangular body rows`);
