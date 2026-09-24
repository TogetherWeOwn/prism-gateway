/**
 * Reproducible full-bill calculator — Phase 0 evidence slice.
 *
 * Generic meter math only: no fleet traffic, no account data, no credentials.
 * Inputs are SYNTHETIC placeholders until measured counts exist; every
 * input carries a provenance label and the calculator refuses to silently
 * treat an unknown input as zero (see collectUnknown / UnknownInputError).
 *
 * Allowance pooling: dev and prod share one Cloudflare account, so overage
 * is computed on the AGGREGATE usage, never per environment. Other usage on
 * the same account (BillRequest.otherAccountUsage) consumes the same shared
 * allowances first; this bill attributes only the MARGINAL overage the
 * gateway adds on top of that baseline, including tariff rounding.
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

/** Meters whose tariff allowance is shared with other usage on the account. */
export type AllowanceMeter =
  | "workers_requests"
  | "workers_cpu"
  | "do_requests"
  | "do_duration"
  | "do_sqlite_reads"
  | "do_sqlite_writes"
  | "do_sqlite_storage"
  | "queue_ops"
  | "d1_reads"
  | "d1_writes"
  | "d1_storage"
  | "r2_storage"
  | "r2_class_a"
  | "r2_class_b";

/**
 * Per-attempt / per-generation / per-month unit model. Rates are
 * documented_tariff; quantities are assumed until measured.
 *
 * Scaling discipline: per-attempt and per-generation fields scale with
 * traffic; per-month fields are FIXED cadence work (polling, admin) that is
 * never multiplied by generations or attempts.
 */
export interface UnitModel {
  /** Gateway Worker invocations per upstream attempt (>= 0; usually 1). */
  gatewayInvocationsPerAttempt: Labeled;
  /** Gateway CPU-ms per gateway invocation. */
  gatewayCpuMsPerInvocation: Labeled;
  /** Consumer Worker invocations per attempt (fractional: one invocation drains a batch). */
  consumerInvocationsPerAttempt: Labeled;
  /** Consumer CPU-ms per consumer invocation. */
  consumerCpuMsPerInvocation: Labeled;
  /** Admin Worker invocations per month. FIXED: not multiplied by generations. */
  adminInvocationsPerMonth: Labeled;
  /** Admin CPU-ms per admin invocation. */
  adminCpuMsPerInvocation: Labeled;
  /** Poller Worker invocations per month. FIXED cadence, not multiplied by generations. */
  pollerInvocationsPerMonth: Labeled;
  /** Poller CPU-ms per poller invocation. */
  pollerCpuMsPerInvocation: Labeled;
  /** DO RPCs per attempt: admission + renewal-amortized + settlement. */
  doRequestsPerAttempt: Labeled;
  /** DO RPCs per month from poller sweeps/outbox drains. FIXED. */
  doPollRequestsPerMonth: Labeled;
  doGbSecondsPerAttempt: Labeled;
  /** Physical row reads per generation, INCLUDING index reads. */
  doSqliteReadsPerGeneration: Labeled;
  /** Physical row writes per generation: rows + indexes + lease/outbox lifecycle. */
  doSqliteWritesPerGeneration: Labeled;
  /** Effective queue messages per generation AFTER batch packing (B), before chunking. */
  queueMessagesPerGeneration: Labeled;
  /** Wire bytes per message INCLUDING metadata (billed per 64 KB chunk). */
  queueBytesPerMessage: Labeled;
  /**
   * Average extra deliveries (redelivery reads) per message (0 = none).
   * Each redelivery bills ONE read, not another write+delete.
   */
  queueRetryRatio: Labeled;
  /** Messages per month exhausted to the DLQ (flat monthly count, same chunk size). */
  dlqMessagesPerMonth: Labeled;
  /**
   * Extra DLQ ops per DLQ message beyond the tariff-fixed transfer write:
   * one read + one delete when the DLQ is drained/redriven, else 0.
   */
  dlqDrainOpsPerMessage: Labeled;
  /** Physical D1 row reads per generation, INCLUDING index reads. */
  d1ReadsPerGeneration: Labeled;
  /** Physical D1 row writes per generation: rows + indexes; deletes bill as writes. */
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
  /**
   * Other usage on the same account, in raw meter units, consuming the
   * shared allowances BEFORE the gateway. Omitted meters mean "no other
   * usage assumed" — stated here, not silently zeroed inside the math.
   */
  otherAccountUsage?: Partial<Record<AllowanceMeter, Labeled>>;
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

function collectUnknown(
  unit: UnitModel,
  dev: Labeled,
  prod: Labeled,
  other?: Partial<Record<AllowanceMeter, Labeled>>,
): string[] {
  const missing: string[] = [];
  const check = (l: Labeled, name: string): void => {
    if (l.label === "unavailable") missing.push(name);
  };
  for (const [name, l] of Object.entries(unit)) check(l as Labeled, `unit.${name}`);
  check(dev, "devGenerations");
  check(prod, "prodGenerations");
  if (other !== undefined) {
    for (const [name, l] of Object.entries(other)) {
      if (l !== undefined) check(l, `otherAccountUsage.${name}`);
    }
  }
  return missing;
}

function assertFiniteNonNegative(l: Labeled, name: string): void {
  if (!Number.isFinite(l.value) || l.value < 0) {
    throw new Error(`billing: ${name} must be a finite non-negative number, got ${l.value}`);
  }
}

/**
 * Marginal billable usage attributable to the gateway: billed(account total)
 * minus billed(other-usage baseline), with usage rounded UP to whole billing
 * units before the allowance applies. For linear meters (unit 1) this equals
 * max(0, usage - max(0, included - other)); for rounded meters (R2) it is the
 * true marginal cost of pushing the account into the next billed unit.
 */
function billableUsage(usage: number, other: number, included: number, unit: number): number {
  const billed = (x: number): number => Math.max(0, Math.ceil(x / unit) * unit - included);
  return billed(usage + other) - billed(other);
}

/** Marginal whole blocks of DO duration excess attributable to the gateway. */
function billableBlocks(usage: number, other: number, included: number, block: number): number {
  const blocks = (x: number): number => Math.ceil(Math.max(0, x - included) / block);
  return blocks(usage + other) - blocks(other);
}

export function computeBill(req: BillRequest): BillResult {
  const missing = collectUnknown(req.unit, req.devGenerations, req.prodGenerations, req.otherAccountUsage);
  if (missing.length > 0) throw new UnknownInputError(missing);
  if (req.scale <= 0) throw new Error(`billing: scale must be positive, got ${req.scale}`);

  const u = req.unit;
  const v = (l: Labeled): number => l.value;
  for (const [name, l] of Object.entries(u)) assertFiniteNonNegative(l as Labeled, `unit.${name}`);
  assertFiniteNonNegative(req.devGenerations, "devGenerations");
  assertFiniteNonNegative(req.prodGenerations, "prodGenerations");
  if (v(u.attemptRatio) < 1) {
    throw new Error(`billing: unit.attemptRatio must be >= 1, got ${v(u.attemptRatio)}`);
  }
  if (req.otherAccountUsage !== undefined) {
    for (const [name, l] of Object.entries(req.otherAccountUsage)) {
      if (l !== undefined) assertFiniteNonNegative(l, `otherAccountUsage.${name}`);
    }
  }
  const other = (m: AllowanceMeter): number => req.otherAccountUsage?.[m]?.value ?? 0;
  const sharedNote = (m: AllowanceMeter, unitName: string): string =>
    other(m) > 0 ? ` shared allowance after ${other(m).toLocaleString("en-US")} other-account ${unitName}.` : "";

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

  // Per-role Worker requests: gateway + consumer scale with attempts;
  // admin + poller are fixed monthly work, never multiplied by generations.
  const gwInv = attempts * v(u.gatewayInvocationsPerAttempt);
  const consInv = attempts * v(u.consumerInvocationsPerAttempt);
  const adminInv = v(u.adminInvocationsPerMonth);
  const pollInv = v(u.pollerInvocationsPerMonth);
  const workerRequests = gwInv + consInv + adminInv + pollInv;
  const workerReqBillable = billableUsage(
    workerRequests,
    other("workers_requests"),
    TARIFF.workersRequestsIncluded,
    1,
  );
  rows.push({
    meter: "workers_requests",
    usage: workerRequests,
    included: TARIFF.workersRequestsIncluded,
    billable: workerReqBillable,
    costUsd: (workerReqBillable / 1_000_000) * TARIFF.workersRequestsOveragePerM,
    basis: "documented_tariff",
    note:
      `gateway ${Math.round(gwInv).toLocaleString("en-US")} + consumer ${Math.round(consInv).toLocaleString("en-US")} ` +
      `+ admin ${adminInv.toLocaleString("en-US")} + poller ${pollInv.toLocaleString("en-US")}; ` +
      `admin/poller fixed monthly, not scaled by generations.${sharedNote("workers_requests", "requests")}`,
  });

  const workerCpuMs =
    gwInv * v(u.gatewayCpuMsPerInvocation) +
    consInv * v(u.consumerCpuMsPerInvocation) +
    adminInv * v(u.adminCpuMsPerInvocation) +
    pollInv * v(u.pollerCpuMsPerInvocation);
  const workerCpuBillable = billableUsage(
    workerCpuMs,
    other("workers_cpu"),
    TARIFF.workersCpuMsIncluded,
    1,
  );
  rows.push({
    meter: "workers_cpu",
    usage: workerCpuMs,
    included: TARIFF.workersCpuMsIncluded,
    billable: workerCpuBillable,
    costUsd: (workerCpuBillable / 1_000_000) * TARIFF.workersCpuOveragePerM,
    basis: "documented_tariff",
    note: `Per-role CPU-ms summed (gateway + consumer + admin + poller); fixed roles not scaled.${sharedNote("workers_cpu", "CPU-ms")}`,
  });

  const doRequests = attempts * v(u.doRequestsPerAttempt) + v(u.doPollRequestsPerMonth);
  const doReqBillable = billableUsage(
    doRequests,
    other("do_requests"),
    TARIFF.doRequestsIncluded,
    1,
  );
  rows.push({
    meter: "do_requests",
    usage: doRequests,
    included: TARIFF.doRequestsIncluded,
    billable: doReqBillable,
    costUsd: (doReqBillable / 1_000_000) * TARIFF.doRequestsOveragePerM,
    basis: "documented_tariff",
    note:
      `Admission + renewal + settlement + poll/outbox RPCs; retries count as attempts; ` +
      `${v(u.doPollRequestsPerMonth).toLocaleString("en-US")} fixed monthly poll RPCs.${sharedNote("do_requests", "requests")}`,
  });

  // DO duration bills whole-million-GB-s blocks of EXCESS after the allowance.
  const doGbSec = attempts * v(u.doGbSecondsPerAttempt);
  const doBlocks = billableBlocks(
    doGbSec,
    other("do_duration"),
    TARIFF.doGbSecondsIncluded,
    TARIFF.doGbSecondsBlockSize,
  );
  const doExcess = Math.max(0, doGbSec + other("do_duration") - TARIFF.doGbSecondsIncluded);
  rows.push({
    meter: "do_duration",
    usage: doGbSec,
    included: TARIFF.doGbSecondsIncluded,
    billable: doExcess,
    costUsd: doBlocks * TARIFF.doGbSecondsBlockUsd,
    basis: "documented_tariff",
    note:
      `ceil(excess / 1M GB-s) blocks x $${TARIFF.doGbSecondsBlockUsd}; any excess fraction bills a full block; ` +
      `marginal blocks over other-account baseline.${sharedNote("do_duration", "GB-s")}`,
  });

  const doReads = pooledGenerations * v(u.doSqliteReadsPerGeneration);
  const doReadsBillable = billableUsage(
    doReads,
    other("do_sqlite_reads"),
    TARIFF.doSqliteReadsIncluded,
    1,
  );
  const doWrites = pooledGenerations * v(u.doSqliteWritesPerGeneration);
  const doWritesBillable = billableUsage(
    doWrites,
    other("do_sqlite_writes"),
    TARIFF.doSqliteWritesIncluded,
    1,
  );
  rows.push({
    meter: "do_sqlite_reads",
    usage: doReads,
    included: TARIFF.doSqliteReadsIncluded,
    billable: doReadsBillable,
    costUsd: (doReadsBillable / 1_000_000) * TARIFF.doSqliteReadsOveragePerM,
    basis: "documented_tariff",
    note: `Physical row reads incl. index reads; retention window sets doSqliteGbMonths.${sharedNote("do_sqlite_reads", "reads")}`,
  });
  rows.push({
    meter: "do_sqlite_writes",
    usage: doWrites,
    included: TARIFF.doSqliteWritesIncluded,
    billable: doWritesBillable,
    costUsd: (doWritesBillable / 1_000_000) * TARIFF.doSqliteWritesOveragePerM,
    basis: "documented_tariff",
    note: `Physical writes: rows + indexes + lease/outbox lifecycle; deletes bill as writes; 8 writes/gen at 10M gen = +$30/mo before polls.${sharedNote("do_sqlite_writes", "writes")}`,
  });
  const doStorageBillable = billableUsage(
    v(u.doSqliteGbMonths),
    other("do_sqlite_storage"),
    TARIFF.doSqliteGbMonthsIncluded,
    1,
  );
  rows.push({
    meter: "do_sqlite_storage",
    usage: v(u.doSqliteGbMonths),
    included: TARIFF.doSqliteGbMonthsIncluded,
    billable: doStorageBillable,
    costUsd: doStorageBillable * TARIFF.doSqliteGbMonthOverage,
    basis: "documented_tariff",
    note: `Retention/compaction bytes; separate meter from D1.${sharedNote("do_sqlite_storage", "GB-mo")}`,
  });

  // Queues: explicit attempt/DLQ lifecycle per 64 KB chunk incl. metadata.
  // Standard delivery = 1 write + 1 read + 1 delete; each redelivery adds ONE
  // read only; each DLQ transfer adds ONE write; DLQ drain adds read+delete.
  const chunksPerMessage = Math.max(1, Math.ceil(v(u.queueBytesPerMessage) / TARIFF.queueChunkBytes));
  const baseMessages = pooledGenerations * v(u.queueMessagesPerGeneration);
  const redeliveryReads = baseMessages * v(u.queueRetryRatio);
  const dlqMsgs = v(u.dlqMessagesPerMonth);
  const queueWrites = baseMessages + dlqMsgs;
  const queueReads = baseMessages + redeliveryReads;
  const queueDeletes = baseMessages;
  const dlqDrainOps = dlqMsgs * v(u.dlqDrainOpsPerMessage);
  const queueOps =
    (queueWrites + queueReads + queueDeletes + dlqDrainOps) * chunksPerMessage;
  const queueBillable = billableUsage(
    queueOps,
    other("queue_ops"),
    TARIFF.queueOpsIncluded,
    1,
  );
  rows.push({
    meter: "queue_ops",
    usage: queueOps,
    included: TARIFF.queueOpsIncluded,
    billable: queueBillable,
    costUsd: (queueBillable / 1_000_000) * TARIFF.queueOpsOveragePerM,
    basis: "documented_tariff",
    note:
      `Per chunk: ${Math.round(queueWrites).toLocaleString("en-US")} writes (incl. ${Math.round(dlqMsgs).toLocaleString("en-US")} DLQ transfers) + ` +
      `${Math.round(queueReads).toLocaleString("en-US")} reads (incl. ${Math.round(redeliveryReads).toLocaleString("en-US")} redeliveries) + ` +
      `${Math.round(queueDeletes).toLocaleString("en-US")} deletes + ${Math.round(dlqDrainOps).toLocaleString("en-US")} DLQ drain, x ` +
      `${chunksPerMessage} chunk(s) for ${v(u.queueBytesPerMessage)}B/64KB.${sharedNote("queue_ops", "ops")}`,
  });

  const d1Reads = pooledGenerations * v(u.d1ReadsPerGeneration);
  const d1ReadsBillable = billableUsage(d1Reads, other("d1_reads"), TARIFF.d1ReadsIncluded, 1);
  const d1Writes = pooledGenerations * v(u.d1WritesPerGeneration);
  const d1WritesBillable = billableUsage(d1Writes, other("d1_writes"), TARIFF.d1WritesIncluded, 1);
  rows.push({
    meter: "d1_reads",
    usage: d1Reads,
    included: TARIFF.d1ReadsIncluded,
    billable: d1ReadsBillable,
    costUsd: (d1ReadsBillable / 1_000_000) * TARIFF.d1ReadsOveragePerM,
    basis: "documented_tariff",
    note: `Physical row reads incl. index reads; indexed projections inside retention.${sharedNote("d1_reads", "reads")}`,
  });
  rows.push({
    meter: "d1_writes",
    usage: d1Writes,
    included: TARIFF.d1WritesIncluded,
    billable: d1WritesBillable,
    costUsd: (d1WritesBillable / 1_000_000) * TARIFF.d1WritesOveragePerM,
    basis: "documented_tariff",
    note: `Row writes incl. indexes; deletes bill as writes; write overage starts past ~16M gen/mo at 3 writes/gen.${sharedNote("d1_writes", "writes")}`,
  });
  const d1StorageBillable = billableUsage(
    v(u.d1GbMonths),
    other("d1_storage"),
    TARIFF.d1GbMonthsIncluded,
    1,
  );
  rows.push({
    meter: "d1_storage",
    usage: v(u.d1GbMonths),
    included: TARIFF.d1GbMonthsIncluded,
    billable: d1StorageBillable,
    costUsd: d1StorageBillable * TARIFF.d1GbMonthOverage,
    basis: "documented_tariff",
    note: `Retention window bytes; project storage bill before widening retention.${sharedNote("d1_storage", "GB-mo")}`,
  });

  // R2 Standard: account-wide allowances (10 GB-mo, 1M A, 10M B ops), usage
  // rounded UP to whole GB / whole millions of ops BEFORE the allowance.
  const r2StorageBillable = billableUsage(
    v(u.r2GbMonths),
    other("r2_storage"),
    TARIFF.r2GbMonthsIncluded,
    1,
  );
  rows.push({
    meter: "r2_storage",
    usage: v(u.r2GbMonths),
    included: TARIFF.r2GbMonthsIncluded,
    billable: r2StorageBillable,
    costUsd: r2StorageBillable * TARIFF.r2GbMonthOverage,
    basis: "documented_tariff",
    note: `Standard class: usage ceils to whole GB-mo, then 10 GB-mo allowance. Encrypted archives/exports; bodies off by default.${sharedNote("r2_storage", "GB-mo")}`,
  });
  const r2A = pooledGenerations * v(u.r2ClassAOpsPerGeneration);
  const r2B = pooledGenerations * v(u.r2ClassBOpsPerGeneration);
  const r2ABillable = billableUsage(r2A, other("r2_class_a"), TARIFF.r2ClassAIncluded, 1_000_000);
  const r2BBillable = billableUsage(r2B, other("r2_class_b"), TARIFF.r2ClassBIncluded, 1_000_000);
  rows.push({
    meter: "r2_class_a",
    usage: r2A,
    included: TARIFF.r2ClassAIncluded,
    billable: r2ABillable,
    costUsd: (r2ABillable / 1_000_000) * TARIFF.r2ClassAOveragePerM,
    basis: "documented_tariff",
    note: `Standard Class A: usage ceils to whole millions of ops, then 1M allowance. PUT/list billed here; deletes free.${sharedNote("r2_class_a", "ops")}`,
  });
  rows.push({
    meter: "r2_class_b",
    usage: r2B,
    included: TARIFF.r2ClassBIncluded,
    billable: r2BBillable,
    costUsd: (r2BBillable / 1_000_000) * TARIFF.r2ClassBOveragePerM,
    basis: "documented_tariff",
    note: `Standard Class B: usage ceils to whole millions of ops, then 10M allowance. GET billed here; deletes free.${sharedNote("r2_class_b", "ops")}`,
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
