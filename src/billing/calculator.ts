/**
 * Reproducible full-bill calculator — Phase 0 evidence slice.
 *
 * Generic meter math only: no fleet traffic, no account data, no credentials.
 * Inputs are SYNTHETIC placeholders until the usage collector lands; every
 * input carries a provenance label and the calculator refuses to silently
 * treat an unknown input as zero (see assertAllKnown / UnknownInputError).
 *
 * Allowance pooling: dev and prod share one Cloudflare account, so overage
 * is computed on the AGGREGATE usage, never per environment.
 *
 * Upstream inference spend is owner-paid and EXCLUDED from this platform
 * bill; it appears as an explicit excluded row, never folded into the total.
 */
import { TARIFF } from "./rates.js";

export type InputLabel =
  | "measured"
  | "documented_tariff"
  | "assumed_unmeasured"
  | "unavailable";

export interface Labeled {
  value: number;
  label: InputLabel;
  note: string;
}

export class UnknownInputError extends Error {
  readonly fields: string[];
  constructor(fields: string[]) {
    super(
      `billing: refusing to compute — unknown inputs must stay explicit, not zero/free: ${fields.join(", ")}`,
    );
    this.name = "UnknownInputError";
    this.fields = fields;
  }
}

/** Per-attempt / per-generation unit model. All rates are documented_tariff; quantities are assumed until measured. */
export interface UnitModel {
  workerInvocationsPerAttempt: Labeled;
  workerCpuMsPerAttempt: Labeled;
  doRequestsPerAttempt: Labeled;
  doGbSecondsPerAttempt: Labeled;
  doSqliteReadsPerGeneration: Labeled;
  doSqliteWritesPerGeneration: Labeled;
  /** Effective queue messages per generation AFTER batch packing (B), before chunking. */
  queueMessagesPerGeneration: Labeled;
  /** Wire bytes per message INCLUDING metadata (billed per 64 KB chunk). */
  queueBytesPerMessage: Labeled;
  /** Extra deliveries per message from retries (0 = none). Redeliveries bill again. */
  queueRetryRatio: Labeled;
  /** Dead-letter writes per month (flat monthly count, same chunk size). */
  dlqMessagesPerMonth: Labeled;
  d1ReadsPerGeneration: Labeled;
  d1WritesPerGeneration: Labeled;
  /** Upstream attempts per successful generation (>= 1; retries add attempts). */
  attemptRatio: Labeled;
  doSqliteGbMonths: Labeled;
  d1GbMonths: Labeled;
  r2GbMonths: Labeled;
  r2ClassAOpsPerGeneration: Labeled;
  r2ClassBOpsPerGeneration: Labeled;
  loggingFlatUsd: Labeled;
  domainFlatUsd: Labeled;
}

export interface BillRequest {
  unit: UnitModel;
  devGenerations: Labeled;
  prodGenerations: Labeled;
  /** Scenario multiplier applied to generation counts (1, 3, 10). */
  scale: number;
  /** Optional tax line. Omitted/unavailable tax is reported UNKNOWN, never $0. */
  taxUsd?: Labeled;
}

export interface BillRow {
  meter: string;
  usage: number | null;
  included: number | null;
  billable: number | null;
  costUsd: number | null;
  basis: InputLabel | "excluded" | "unknown";
  note: string;
}

export interface BillResult {
  scale: number;
  pooledGenerations: number;
  rows: BillRow[];
  totalUsd: number;
  excludesUnknowns: string[];
  upstreamNote: string;
}

function collectUnknown(unit: UnitModel, dev: Labeled, prod: Labeled): string[] {
  const missing: string[] = [];
  const check = (l: Labeled, name: string): void => {
    if (l.label === "unavailable") missing.push(name);
  };
  for (const [name, l] of Object.entries(unit)) check(l as Labeled, `unit.${name}`);
  check(dev, "devGenerations");
  check(prod, "prodGenerations");
  return missing;
}

const overage = (usage: number, included: number): number => Math.max(0, usage - included);

export function computeBill(req: BillRequest): BillResult {
  const missing = collectUnknown(req.unit, req.devGenerations, req.prodGenerations);
  if (missing.length > 0) throw new UnknownInputError(missing);
  if (req.scale <= 0) throw new Error(`billing: scale must be positive, got ${req.scale}`);

  const u = req.unit;
  const v = (l: Labeled): number => l.value;
  // Account-wide pooling: dev + prod share one allowance pool.
  const pooledGenerations = (v(req.devGenerations) + v(req.prodGenerations)) * req.scale;
  const attempts = pooledGenerations * v(u.attemptRatio);

  const rows: BillRow[] = [];
  const excludesUnknowns: string[] = [];

  // Workers plan is a flat account-level line.
  rows.push({
    meter: "workers_plan",
    usage: null,
    included: null,
    billable: null,
    costUsd: TARIFF.workersPlanUsd,
    basis: "documented_tariff",
    note: "Paid plan, account-wide; dev/prod do not each get a plan.",
  });

  const workerRequests = attempts * v(u.workerInvocationsPerAttempt);
  const workerReqBillable = overage(workerRequests, TARIFF.workersRequestsIncluded);
  rows.push({
    meter: "workers_requests",
    usage: workerRequests,
    included: TARIFF.workersRequestsIncluded,
    billable: workerReqBillable,
    costUsd: (workerReqBillable / 1_000_000) * TARIFF.workersRequestsOveragePerM,
    basis: "documented_tariff",
    note: "Gateway + consumer + admin + poller invocations pooled account-wide.",
  });

  const workerCpuMs = attempts * v(u.workerCpuMsPerAttempt);
  const workerCpuBillable = overage(workerCpuMs, TARIFF.workersCpuMsIncluded);
  rows.push({
    meter: "workers_cpu",
    usage: workerCpuMs,
    included: TARIFF.workersCpuMsIncluded,
    billable: workerCpuBillable,
    costUsd: (workerCpuBillable / 1_000_000) * TARIFF.workersCpuOveragePerM,
    basis: "documented_tariff",
    note: "Total Gateway + consumer + admin + poller CPU-ms; mean across the mix, not median.",
  });

  const doRequests = attempts * v(u.doRequestsPerAttempt);
  const doReqBillable = overage(doRequests, TARIFF.doRequestsIncluded);
  rows.push({
    meter: "do_requests",
    usage: doRequests,
    included: TARIFF.doRequestsIncluded,
    billable: doReqBillable,
    costUsd: (doReqBillable / 1_000_000) * TARIFF.doRequestsOveragePerM,
    basis: "documented_tariff",
    note: "Admission + renewal + settlement + poll/outbox RPCs; retries count as attempts.",
  });

  // DO duration bills whole-million-GB-s blocks of EXCESS after the allowance.
  const doGbSec = attempts * v(u.doGbSecondsPerAttempt);
  const doExcess = overage(doGbSec, TARIFF.doGbSecondsIncluded);
  const doBlocks = Math.ceil(doExcess / TARIFF.doGbSecondsBlockSize);
  rows.push({
    meter: "do_duration",
    usage: doGbSec,
    included: TARIFF.doGbSecondsIncluded,
    billable: doExcess,
    costUsd: doBlocks * TARIFF.doGbSecondsBlockUsd,
    basis: "documented_tariff",
    note: `ceil(excess / 1M GB-s) blocks x $${TARIFF.doGbSecondsBlockUsd}; any excess fraction bills a full block.`,
  });

  const doReads = pooledGenerations * v(u.doSqliteReadsPerGeneration);
  const doReadsBillable = overage(doReads, TARIFF.doSqliteReadsIncluded);
  const doWrites = pooledGenerations * v(u.doSqliteWritesPerGeneration);
  const doWritesBillable = overage(doWrites, TARIFF.doSqliteWritesIncluded);
  rows.push({
    meter: "do_sqlite_reads",
    usage: doReads,
    included: TARIFF.doSqliteReadsIncluded,
    billable: doReadsBillable,
    costUsd: (doReadsBillable / 1_000_000) * TARIFF.doSqliteReadsOveragePerM,
    basis: "documented_tariff",
    note: "Includes index reads; measure write amplification, do not assume batching erases it.",
  });
  rows.push({
    meter: "do_sqlite_writes",
    usage: doWrites,
    included: TARIFF.doSqliteWritesIncluded,
    billable: doWritesBillable,
    costUsd: (doWritesBillable / 1_000_000) * TARIFF.doSqliteWritesOveragePerM,
    basis: "documented_tariff",
    note: "Includes indexes, lease/outbox lifecycle; 8 writes/gen at 10M gen = +$30/mo before polls.",
  });
  const doStorageBillable = overage(v(u.doSqliteGbMonths), TARIFF.doSqliteGbMonthsIncluded);
  rows.push({
    meter: "do_sqlite_storage",
    usage: v(u.doSqliteGbMonths),
    included: TARIFF.doSqliteGbMonthsIncluded,
    billable: doStorageBillable,
    costUsd: doStorageBillable * TARIFF.doSqliteGbMonthOverage,
    basis: "documented_tariff",
    note: "Retention/compaction bytes; separate meter from D1.",
  });

  // Queues: 3 ops (write+read+delete) per delivery, per 64 KB chunk incl. metadata.
  const chunksPerMessage = Math.max(1, Math.ceil(v(u.queueBytesPerMessage) / TARIFF.queueChunkBytes));
  const deliveries =
    pooledGenerations * v(u.queueMessagesPerGeneration) * (1 + v(u.queueRetryRatio)) +
    v(u.dlqMessagesPerMonth);
  const queueOps = TARIFF.queueOpsPerMessage * deliveries * chunksPerMessage;
  const queueBillable = overage(queueOps, TARIFF.queueOpsIncluded);
  rows.push({
    meter: "queue_ops",
    usage: queueOps,
    included: TARIFF.queueOpsIncluded,
    billable: queueBillable,
    costUsd: (queueBillable / 1_000_000) * TARIFF.queueOpsOveragePerM,
    basis: "documented_tariff",
    note: `3 x deliveries x ceil(${v(u.queueBytesPerMessage)}B/64KB=${chunksPerMessage} chunk(s)); retries + DLQ bill again.`,
  });

  const d1Reads = pooledGenerations * v(u.d1ReadsPerGeneration);
  const d1ReadsBillable = overage(d1Reads, TARIFF.d1ReadsIncluded);
  const d1Writes = pooledGenerations * v(u.d1WritesPerGeneration);
  const d1WritesBillable = overage(d1Writes, TARIFF.d1WritesIncluded);
  rows.push({
    meter: "d1_reads",
    usage: d1Reads,
    included: TARIFF.d1ReadsIncluded,
    billable: d1ReadsBillable,
    costUsd: (d1ReadsBillable / 1_000_000) * TARIFF.d1ReadsOveragePerM,
    basis: "documented_tariff",
    note: "Indexed projections inside retention; sampled charts do not replace the ledger.",
  });
  rows.push({
    meter: "d1_writes",
    usage: d1Writes,
    included: TARIFF.d1WritesIncluded,
    billable: d1WritesBillable,
    costUsd: (d1WritesBillable / 1_000_000) * TARIFF.d1WritesOveragePerM,
    basis: "documented_tariff",
    note: "Row writes incl. indexes; write overage starts past ~16M gen/mo at 3 writes/gen.",
  });
  const d1StorageBillable = overage(v(u.d1GbMonths), TARIFF.d1GbMonthsIncluded);
  rows.push({
    meter: "d1_storage",
    usage: v(u.d1GbMonths),
    included: TARIFF.d1GbMonthsIncluded,
    billable: d1StorageBillable,
    costUsd: d1StorageBillable * TARIFF.d1GbMonthOverage,
    basis: "documented_tariff",
    note: "Retention window bytes; project storage bill before widening retention.",
  });

  const r2StorageBillable = overage(v(u.r2GbMonths), TARIFF.r2GbMonthsIncluded);
  rows.push({
    meter: "r2_storage",
    usage: v(u.r2GbMonths),
    included: TARIFF.r2GbMonthsIncluded,
    billable: r2StorageBillable,
    costUsd: r2StorageBillable * TARIFF.r2GbMonthOverage,
    basis: "documented_tariff",
    note: "Encrypted archives/exports; bodies off by default.",
  });
  const r2A = pooledGenerations * v(u.r2ClassAOpsPerGeneration);
  const r2B = pooledGenerations * v(u.r2ClassBOpsPerGeneration);
  rows.push({
    meter: "r2_ops",
    usage: r2A + r2B,
    included: null,
    billable: r2A + r2B,
    costUsd:
      (r2A / 1_000_000) * TARIFF.r2ClassAOveragePerM +
      (r2B / 1_000_000) * TARIFF.r2ClassBOveragePerM,
    basis: "documented_tariff",
    note: "PUT/GET/list/delete counted separately; no free tier for operations.",
  });

  rows.push({
    meter: "logging",
    usage: null,
    included: null,
    billable: null,
    costUsd: v(u.loggingFlatUsd),
    basis: u.loggingFlatUsd.label,
    note: "Logpush->R2 + ingestion; flat planning figure until measured.",
  });
  rows.push({
    meter: "domain",
    usage: null,
    included: null,
    billable: null,
    costUsd: v(u.domainFlatUsd),
    basis: u.domainFlatUsd.label,
    note: "Allocated domain cost; an existing subdomain does not make it $0.",
  });

  if (req.taxUsd === undefined || req.taxUsd.label === "unavailable") {
    excludesUnknowns.push("tax");
    rows.push({
      meter: "tax",
      usage: null,
      included: null,
      billable: null,
      costUsd: null,
      basis: "unknown",
      note: "Tax jurisdiction/rate unmeasured — UNKNOWN, excluded from total, never $0.",
    });
  } else {
    rows.push({
      meter: "tax",
      usage: null,
      included: null,
      billable: null,
      costUsd: v(req.taxUsd),
      basis: req.taxUsd.label,
      note: req.taxUsd.note,
    });
  }

  rows.push({
    meter: "upstream_inference",
    usage: null,
    included: null,
    billable: null,
    costUsd: null,
    basis: "excluded",
    note: "Owner-paid provider subscriptions; NOT part of the Cloudflare platform bill.",
  });

  const totalUsd = rows.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  return {
    scale: req.scale,
    pooledGenerations,
    rows,
    totalUsd,
    excludesUnknowns,
    upstreamNote:
      "Upstream inference spend is owner-paid and excluded. This total is a PLATFORM bill estimate on synthetic inputs — not a measured bill, not a <=$10 certification.",
  };
}
