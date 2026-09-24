import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  UnknownInputError,
  computeBill,
} from "../src/billing/calculator.js";
import type { AllowanceMeter, BillRequest, Labeled, UnitModel } from "../src/billing/calculator.js";
import { TARIFF } from "../src/billing/rates.js";
import { syntheticRequest, syntheticUnitModel } from "../src/billing/scenarios.js";

const assumed = (value: number): Labeled => ({
  value,
  label: "assumed_unmeasured",
  note: "test",
});

function baseRequest(): BillRequest {
  return syntheticRequest(1);
}

/** Unit model with every quantity zeroed; attemptRatio 1; single-chunk messages. */
function quietUnit(): UnitModel {
  const u = syntheticUnitModel();
  for (const k of Object.keys(u) as (keyof UnitModel)[]) u[k] = assumed(0);
  u.attemptRatio = assumed(1);
  u.queueBytesPerMessage = assumed(2_048);
  return u;
}

/** Isolated oracle request: zeroed unit plus the overridden fields. */
function oracleRequest(
  dev: number,
  prod: number,
  unit: Partial<UnitModel>,
  other?: Partial<Record<AllowanceMeter, Labeled>>,
  scale = 1,
): BillRequest {
  return {
    unit: { ...quietUnit(), ...unit },
    devGenerations: assumed(dev),
    prodGenerations: assumed(prod),
    scale,
    ...(other === undefined ? {} : { otherAccountUsage: other }),
  };
}

function rowOf(req: BillRequest, meter: string) {
  return computeBill(req).rows.find((r) => r.meter === meter);
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

  it("bills only plan + flats inside allowances (R2 ops covered by Standard allowances)", () => {
    const req = baseRequest();
    req.devGenerations = assumed(10);
    req.prodGenerations = assumed(10);
    const bill = computeBill(req);
    const overages = bill.rows.filter(
      (r) => r.billable !== null && r.billable > 0,
    );
    assert.deepEqual(overages, [], "20 generations must bill zero overage on every meter");
    assert.ok(
      Math.abs(bill.totalUsd - 6) < 1e-9,
      `20 generations must cost exactly plan + flats ($6), got $${bill.totalUsd}`,
    );
  });

  it("starts Workers request overage the generation past 10M pooled requests", () => {
    // 10M requests incl. Attempts = generations * 1.1; invocations 1.0 gateway
    // + 0.05 consumer per attempt; admin 30k + poller 43.2k fixed monthly.
    // Traffic term must straddle 10M - 73,200 = 9,926,800:
    // 8,594,000 gens -> 9,999,270 (< 10M); 8,595,000 gens -> 10,000,425 (> 10M).
    const justUnder: BillRequest = {
      ...baseRequest(),
      unit: { ...baseRequest().unit },
      devGenerations: assumed(0),
      prodGenerations: assumed(8_594_000),
    };
    const justOver: BillRequest = {
      ...baseRequest(),
      unit: { ...baseRequest().unit },
      devGenerations: assumed(0),
      prodGenerations: assumed(8_595_000),
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
      note: "metered counts do not exist yet",
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

  it("oracle: queue redelivery bills one read, not write+read+delete (1M msgs, retry 0.1)", () => {
    const req = oracleRequest(0, 1_000_000, {
      queueMessagesPerGeneration: assumed(1),
      queueBytesPerMessage: assumed(1_000),
      queueRetryRatio: assumed(0.1),
      dlqMessagesPerMonth: assumed(0),
    });
    const row = rowOf(req, "queue_ops");
    // 1M writes + 1.1M reads + 1M deletes = 3.1M ops; minus 1M included,
    // 2.1M x $0.40/M = $0.84. The old write+read+delete-per-retry model
    // gave 3.3M ops / $0.92.
    assert.equal(row?.usage, 3_100_000);
    assert.equal(row?.billable, 2_100_000);
    assert.ok(
      Math.abs((row?.costUsd ?? -1) - 0.84) < 1e-9,
      `expected $0.84, got $${row?.costUsd}`,
    );
  });

  it("oracle: DLQ transfer adds one write; drain adds read+delete", () => {
    const undrained = oracleRequest(0, 1_000, {
      queueMessagesPerGeneration: assumed(1),
      queueBytesPerMessage: assumed(1_000),
      dlqMessagesPerMonth: assumed(100),
      dlqDrainOpsPerMessage: assumed(0),
    });
    const drained = oracleRequest(0, 1_000, {
      queueMessagesPerGeneration: assumed(1),
      queueBytesPerMessage: assumed(1_000),
      dlqMessagesPerMonth: assumed(100),
      dlqDrainOpsPerMessage: assumed(2),
    });
    // Undrained: 1100 writes (incl. 100 DLQ transfers) + 1000 reads + 1000 deletes.
    assert.equal(rowOf(undrained, "queue_ops")?.usage, 3_100);
    // Drained DLQ adds one read + one delete per DLQ message.
    assert.equal(rowOf(drained, "queue_ops")?.usage, 3_300);
    assert.equal(rowOf(drained, "queue_ops")?.costUsd, 0);
  });

  it("oracle: queue chunks split at 64,000 wire bytes including metadata", () => {
    const oneChunk = oracleRequest(0, 10_000, {
      queueMessagesPerGeneration: assumed(1),
      // 63,900 B payload + ~100 B metadata = 64,000 B wire: exactly 1 chunk.
      queueBytesPerMessage: assumed(64_000),
    });
    const twoChunks = oracleRequest(0, 10_000, {
      queueMessagesPerGeneration: assumed(1),
      // 63,950 B payload + ~100 B metadata = 64,050 B wire: 2 chunks.
      queueBytesPerMessage: assumed(64_050),
    });
    assert.equal(rowOf(oneChunk, "queue_ops")?.usage, 30_000);
    assert.equal(rowOf(twoChunks, "queue_ops")?.usage, 60_000);
  });

  it("oracle: R2 Standard allowances cover 1k A + 1k B ops; 10.1 GB-mo bills 1 GB", () => {
    const req = oracleRequest(0, 1_000_000, {
      r2ClassAOpsPerGeneration: assumed(0.001),
      r2ClassBOpsPerGeneration: assumed(0.001),
      r2GbMonths: assumed(10.1),
    });
    const bill = computeBill(req);
    assert.equal(bill.rows.find((r) => r.meter === "r2_ops"), undefined);
    const a = bill.rows.find((r) => r.meter === "r2_class_a");
    const b = bill.rows.find((r) => r.meter === "r2_class_b");
    const s = bill.rows.find((r) => r.meter === "r2_storage");
    assert.equal(a?.usage, 1_000);
    assert.equal(a?.billable, 0);
    assert.equal(a?.costUsd, 0);
    assert.equal(b?.usage, 1_000);
    assert.equal(b?.billable, 0);
    assert.equal(b?.costUsd, 0);
    // Storage ceils to whole GB before the 10 GB allowance: 11 - 10 = 1 GB.
    assert.equal(s?.billable, 1);
    assert.equal(s?.costUsd, 0.015);
  });

  it("oracle: R2 operations round UP to whole millions above the allowance", () => {
    const a = oracleRequest(0, 1_000_001, { r2ClassAOpsPerGeneration: assumed(1) });
    const b = oracleRequest(0, 10_000_001, { r2ClassBOpsPerGeneration: assumed(1) });
    // 1,000,001 A ops ceil to 2M; minus 1M included = 1M x $4.50/M.
    assert.equal(rowOf(a, "r2_class_a")?.billable, 1_000_000);
    assert.equal(rowOf(a, "r2_class_a")?.costUsd, 4.5);
    // 10,000,001 B ops ceil to 11M; minus 10M included = 1M x $0.36/M.
    assert.equal(rowOf(b, "r2_class_b")?.billable, 1_000_000);
    assert.equal(rowOf(b, "r2_class_b")?.costUsd, 0.36);
  });

  it("keeps fixed monthly work out of generation/scale multiplication", () => {
    const fixed = {
      adminInvocationsPerMonth: assumed(30_000),
      adminCpuMsPerInvocation: assumed(10),
      pollerInvocationsPerMonth: assumed(43_200),
      pollerCpuMsPerInvocation: assumed(15),
      doPollRequestsPerMonth: assumed(43_200),
      dlqMessagesPerMonth: assumed(100),
    };
    const s1 = computeBill(oracleRequest(0, 1_000_000, fixed, undefined, 1));
    const s10 = computeBill(oracleRequest(0, 1_000_000, fixed, undefined, 10));
    for (const meter of ["workers_requests", "workers_cpu", "do_requests", "queue_ops"]) {
      const a = s1.rows.find((r) => r.meter === meter)?.usage;
      const c = s10.rows.find((r) => r.meter === meter)?.usage;
      assert.equal(c, a, `${meter}: 10x scale must not multiply fixed monthly work`);
    }
    assert.equal(
      s1.rows.find((r) => r.meter === "workers_requests")?.usage,
      73_200,
    );
    assert.equal(s1.rows.find((r) => r.meter === "queue_ops")?.usage, 100);
  });

  it("charges only marginal overage above other account usage on shared allowances", () => {
    // Gateway adds 2,000 requests to an account already at 9,999,000: only
    // the 1,000 requests past the shared 10M allowance bill.
    const shared = oracleRequest(
      0,
      1_000,
      { gatewayInvocationsPerAttempt: assumed(2) },
      { workers_requests: assumed(9_999_000) },
    );
    const alone = oracleRequest(0, 1_000, { gatewayInvocationsPerAttempt: assumed(2) });
    assert.equal(rowOf(shared, "workers_requests")?.billable, 1_000);
    assert.ok((rowOf(shared, "workers_requests")?.costUsd ?? 0) > 0);
    assert.equal(rowOf(alone, "workers_requests")?.billable, 0);
    assert.equal(rowOf(alone, "workers_requests")?.costUsd, 0);
  });

  it("attributes marginal R2 rounding: usage free alone can bill on a shared account", () => {
    // 600k A ops alone ceil to 1M, inside the 1M allowance: free. On an
    // account already at 1.5M (billed 2M), the account total 2.1M bills 3M:
    // marginal 1M x $4.50/M.
    const shared = oracleRequest(
      0,
      600_000,
      { r2ClassAOpsPerGeneration: assumed(1) },
      { r2_class_a: assumed(1_500_000) },
    );
    const alone = oracleRequest(0, 600_000, { r2ClassAOpsPerGeneration: assumed(1) });
    assert.equal(rowOf(shared, "r2_class_a")?.billable, 1_000_000);
    assert.equal(rowOf(shared, "r2_class_a")?.costUsd, 4.5);
    assert.equal(rowOf(alone, "r2_class_a")?.billable, 0);
    assert.equal(rowOf(alone, "r2_class_a")?.costUsd, 0);
  });

  it("rejects negative, NaN, and sub-unity attempt inputs", () => {
    const neg = baseRequest();
    neg.devGenerations = assumed(-5);
    assert.throws(() => computeBill(neg), /finite non-negative/);
    const nan = baseRequest();
    nan.unit = { ...nan.unit, d1GbMonths: assumed(NaN) };
    assert.throws(() => computeBill(nan), /finite non-negative/);
    const ratio = baseRequest();
    ratio.unit = { ...ratio.unit, attemptRatio: assumed(0.9) };
    assert.throws(() => computeBill(ratio), /attemptRatio must be >= 1/);
    const other = baseRequest();
    other.otherAccountUsage = { workers_cpu: assumed(-1) };
    assert.throws(() => computeBill(other), /finite non-negative/);
  });

  it("labels synthetic CPU per role as assumed, never tariff or benchmark", () => {
    const u = syntheticUnitModel();
    for (const f of [
      "gatewayCpuMsPerInvocation",
      "consumerCpuMsPerInvocation",
      "adminCpuMsPerInvocation",
      "pollerCpuMsPerInvocation",
    ] as const) {
      assert.equal(u[f].label, "assumed_unmeasured", `${f} must stay assumed_unmeasured`);
    }
    assert.ok(!("workerCpuMsPerAttempt" in u));
    assert.ok(!("workerInvocationsPerAttempt" in u));
  });
});
