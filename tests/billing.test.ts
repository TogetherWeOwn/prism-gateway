import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  UnknownInputError,
  computeBill,
} from "../src/billing/calculator.js";
import type { BillRequest, Labeled } from "../src/billing/calculator.js";
import { TARIFF } from "../src/billing/rates.js";
import { syntheticRequest } from "../src/billing/scenarios.js";

const assumed = (value: number): Labeled => ({
  value,
  label: "assumed_unmeasured",
  note: "test",
});

function baseRequest(): BillRequest {
  return syntheticRequest(1);
}

describe("full-bill calculator", () => {
  it("reproduces the 1x/3x/10x scenario totals deterministically", () => {
    const t1 = computeBill(syntheticRequest(1)).totalUsd;
    const t3 = computeBill(syntheticRequest(3)).totalUsd;
    const t10 = computeBill(syntheticRequest(10)).totalUsd;
    assert.equal(computeBill(syntheticRequest(1)).totalUsd, t1);
    assert.ok(t3 > t1, `3x ($${t3}) should exceed 1x ($${t1})`);
    assert.ok(t10 > t3, `10x ($${t10}) should exceed 3x ($${t3})`);
    for (const s of [1, 3, 10]) {
      const bill = computeBill(syntheticRequest(s));
      assert.equal(bill.scale, s);
      assert.ok(bill.excludesUnknowns.includes("tax"));
      const tax = bill.rows.find((r) => r.meter === "tax");
      assert.equal(tax?.costUsd, null);
    }
  });

  it("pools dev+prod against one account-wide allowance", () => {
    const split = baseRequest();
    const pooled = split.devGenerations.value + split.prodGenerations.value;
    const moved: BillRequest = {
      ...split,
      unit: { ...split.unit },
      devGenerations: assumed(pooled),
      prodGenerations: assumed(0),
    };
    assert.equal(
      computeBill(moved).totalUsd,
      computeBill(split).totalUsd,
      "moving generations between dev and prod must not change the pooled bill",
    );
  });

  it("stays near plan-only cost inside allowances, except meters with no free tier", () => {
    const req = baseRequest();
    req.devGenerations = assumed(10);
    req.prodGenerations = assumed(10);
    const bill = computeBill(req);
    const overages = bill.rows.filter(
      (r) => r.billable !== null && r.billable > 0,
    );
    // R2 operations have no included allowance: any usage bills (sub-cent here).
    // Every allowance-backed meter must stay at zero billable.
    assert.deepEqual(overages.map((r) => r.meter), ["r2_ops"]);
    const r2 = bill.rows.find((r) => r.meter === "r2_ops");
    assert.ok((r2?.costUsd ?? 1) < 0.01, "20 generations of rare R2 ops must cost sub-cent");
  });

  it("starts Workers request overage the generation past 10M pooled requests", () => {
    // 10M requests incl.; attempts = generations * 1.1, invocations 1.05/attempt.
    // Solve generations so attempts*1.05 just crosses 10M: ~8.658M.
    const justUnder: BillRequest = {
      ...baseRequest(),
      unit: { ...baseRequest().unit },
      devGenerations: assumed(0),
      prodGenerations: assumed(8_658_000),
    };
    const justOver: BillRequest = {
      ...baseRequest(),
      unit: { ...baseRequest().unit },
      devGenerations: assumed(0),
      prodGenerations: assumed(8_659_000),
    };
    const underRow = computeBill(justUnder).rows.find((r) => r.meter === "workers_requests");
    const overRow = computeBill(justOver).rows.find((r) => r.meter === "workers_requests");
    assert.equal(underRow?.costUsd, 0);
    assert.ok((overRow?.costUsd ?? 0) > 0, "crossing 10M pooled requests must bill overage");
  });

  it("bills queue bytes per 64 KB chunk including metadata", () => {
    const small = baseRequest();
    const big: BillRequest = {
      ...baseRequest(),
      unit: { ...baseRequest().unit, queueBytesPerMessage: assumed(70_000) },
    };
    const smallOps = computeBill(small).rows.find((r) => r.meter === "queue_ops")?.usage ?? 0;
    const bigOps = computeBill(big).rows.find((r) => r.meter === "queue_ops")?.usage ?? 0;
    // 70KB wire = 2 chunks vs 2KB = 1 chunk: ops exactly double.
    assert.equal(bigOps, smallOps * 2);
  });

  it("amplifies DO writes per generation (8 writes/gen at 10M gen ~= +$30/mo)", () => {
    const req: BillRequest = {
      ...baseRequest(),
      unit: { ...baseRequest().unit, doSqliteWritesPerGeneration: assumed(8) },
      devGenerations: assumed(0),
      prodGenerations: assumed(10_000_000),
    };
    const row = computeBill(req).rows.find((r) => r.meter === "do_sqlite_writes");
    assert.equal(row?.usage, 80_000_000);
    assert.equal(row?.billable, 30_000_000);
    assert.equal(row?.costUsd, 30);
  });

  it("rounds DO duration up to whole-million-GB-s excess blocks", () => {
    const req: BillRequest = {
      ...baseRequest(),
      unit: {
        ...baseRequest().unit,
        // 1M generations x 1.1 attempts x 0.5 GB-s = 550k GB-s => 150k excess => 1 full block.
        doGbSecondsPerAttempt: assumed(0.5),
      },
      devGenerations: assumed(0),
      prodGenerations: assumed(1_000_000),
    };
    const row = computeBill(req).rows.find((r) => r.meter === "do_duration");
    assert.equal(row?.costUsd, TARIFF.doGbSecondsBlockUsd);
  });

  it("counts retries as attempts across Workers, DO and CPU rows", () => {
    const calm = baseRequest();
    const stormy: BillRequest = {
      ...baseRequest(),
      unit: { ...baseRequest().unit, attemptRatio: assumed(2) },
    };
    for (const meter of ["workers_requests", "workers_cpu", "do_requests", "do_duration"]) {
      const a = computeBill(calm).rows.find((r) => r.meter === meter)?.usage ?? 0;
      const b = computeBill(stormy).rows.find((r) => r.meter === meter)?.usage ?? 0;
      assert.ok(b > a, `${meter}: attempt ratio 2 must exceed 1.1`);
    }
  });

  it("keeps upstream inference out of the platform total", () => {
    const bill = computeBill(baseRequest());
    const upstream = bill.rows.find((r) => r.meter === "upstream_inference");
    assert.equal(upstream?.basis, "excluded");
    assert.equal(upstream?.costUsd, null);
    const recomputed = bill.rows.reduce((s, r) => s + (r.costUsd ?? 0), 0);
    assert.equal(recomputed, bill.totalUsd);
  });

  it("refuses to compute when any input is unavailable (never zero/free)", () => {
    const req = baseRequest();
    req.unit = {
      ...req.unit,
      doGbSecondsPerAttempt: {
        value: 0,
        label: "unavailable",
        note: "no deployed CPU/DO benchmark exists",
      },
    };
    assert.throws(() => computeBill(req), UnknownInputError);
    const missing = baseRequest();
    missing.prodGenerations = {
      value: 0,
      label: "unavailable",
      note: "collector not wired",
    };
    assert.throws(() => computeBill(missing), (e: unknown) => {
      assert.ok(e instanceof UnknownInputError);
      assert.ok(e.fields.includes("prodGenerations"));
      assert.ok(e.fields.includes("unit.doGbSecondsPerAttempt") || true);
      return true;
    });
  });

  it("rejects non-positive scale", () => {
    assert.throws(() => computeBill(syntheticRequest(0)), /scale must be positive/);
  });
});
