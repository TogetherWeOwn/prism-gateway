/**
 * Scenario CLI: `npm run bill -- [scale]` prints the reproducible platform
 * bill for one scale (default: all three pinned scenarios 1x/3x/10x).
 * Synthetic inputs; see src/billing/scenarios.ts.
 */
import { computeBill } from "./calculator.js";
import { SCENARIO_SCALES, syntheticRequest } from "./scenarios.js";

function fmt(n: number | null): string {
  if (n === null) return "n/a";
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(4);
}

function printBill(scale: number): void {
  const bill = computeBill(syntheticRequest(scale));
  console.log(`=== scenario ${scale}x (pooled generations: ${fmt(bill.pooledGenerations)}) ===`);
  console.log("meter                 usage        included       billable       USD    basis");
  for (const r of bill.rows) {
    console.log(
      `${r.meter.padEnd(20)} ${fmt(r.usage).padStart(12)} ${fmt(r.included).padStart(12)} ${fmt(r.billable).padStart(12)} ${(r.costUsd === null ? "n/a" : r.costUsd.toFixed(2)).padStart(8)}  ${r.basis}`,
    );
  }
  console.log(`TOTAL: $${bill.totalUsd.toFixed(2)}/mo`);
  if (bill.excludesUnknowns.length > 0) {
    console.log(`excluded unknowns (NOT zero): ${bill.excludesUnknowns.join(", ")}`);
  }
  console.log(bill.upstreamNote);
  console.log("");
}

const arg = process.argv[2];
if (arg !== undefined) {
  const scale = Number(arg);
  if (!Number.isFinite(scale) || scale <= 0) {
    console.error(`usage: npm run bill -- [scale>0]; got ${JSON.stringify(arg)}`);
    process.exit(1);
  }
  printBill(scale);
} else {
  for (const s of SCENARIO_SCALES) printBill(s);
}
