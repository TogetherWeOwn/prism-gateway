/**
 * Pinned synthetic scenario inputs for the Phase-0 full-bill calculator.
 *
 * SYNTHETIC ONLY: these figures are planning illustrations, NOT measured
 * fleet traffic. They exist so the meter math, boundary behavior and pooling
 * logic are tested reproducibly until measured counts exist. Every quantity
 * is labeled assumed_unmeasured; unknown actual traffic and CPU stay
 * unmeasured here, never zeroed, never relabeled as tariff or benchmark.
 */
import type { BillRequest, Labeled, UnitModel } from "./calculator.js";

const assumed = (value: number, note: string): Labeled => ({
  value,
  label: "assumed_unmeasured",
  note,
});

/** Placeholder generation counts. 1M/mo planning figure; dev share token. */
export const SYNTHETIC_GENERATIONS = {
  dev: assumed(50_000, "synthetic dev-test share; replace with metered dev counts"),
  prod: assumed(950_000, "synthetic 1M/mo planning figure; replace with metered counts"),
};

export function syntheticUnitModel(): UnitModel {
  return {
    gatewayInvocationsPerAttempt: assumed(1, "one gateway invocation per upstream attempt"),
    gatewayCpuMsPerInvocation: assumed(14, "synthetic gateway CPU target; unmeasured, not a tariff or benchmark"),
    consumerInvocationsPerAttempt: assumed(0.05, "one consumer invocation drains ~20 attempts; unmeasured batching"),
    consumerCpuMsPerInvocation: assumed(120, "synthetic consumer CPU target; unmeasured, not a tariff or benchmark"),
    adminInvocationsPerMonth: assumed(30_000, "synthetic fixed admin cadence; not scaled by generations"),
    adminCpuMsPerInvocation: assumed(10, "synthetic admin CPU target; unmeasured"),
    pollerInvocationsPerMonth: assumed(43_200, "synthetic 1/min fixed poll cadence; not scaled by generations"),
    pollerCpuMsPerInvocation: assumed(15, "synthetic poller CPU target; unmeasured"),
    doRequestsPerAttempt: assumed(3, "admission + renewal-amortized + settlement"),
    doPollRequestsPerMonth: assumed(43_200, "synthetic fixed poll RPC cadence; unmeasured"),
    doGbSecondsPerAttempt: assumed(0.01125, "30ms active on 128MB per DO request"),
    doSqliteReadsPerGeneration: assumed(6, "incl. index reads; unmeasured"),
    doSqliteWritesPerGeneration: assumed(4, "incl. indexes + outbox lifecycle; unmeasured"),
    queueMessagesPerGeneration: assumed(1, "one packed message per generation after batching"),
    queueBytesPerMessage: assumed(2_048, "2KB wire incl. metadata; measure real event size"),
    queueRetryRatio: assumed(0.02, "2% redelivery; each adds one read; unmeasured"),
    dlqMessagesPerMonth: assumed(100, "token dead-letter volume; unmeasured"),
    dlqDrainOpsPerMessage: assumed(0, "DLQ assumed undrained: transfer write only, no drain read+delete"),
    d1ReadsPerGeneration: assumed(2, "indexed projections; unmeasured"),
    d1WritesPerGeneration: assumed(3, "request/attempt rows + indexes; unmeasured"),
    attemptRatio: assumed(1.1, "10% pre-commit retry overhead; unmeasured"),
    doSqliteGbMonths: assumed(1, "retention/compaction bytes; unmeasured"),
    d1GbMonths: assumed(2, "retention window bytes; unmeasured"),
    r2GbMonths: assumed(2, "diagnostics off; unmeasured"),
    r2ClassAOpsPerGeneration: assumed(0.001, "rare encrypted exports; unmeasured"),
    r2ClassBOpsPerGeneration: assumed(0.001, "rare reads; unmeasured"),
    loggingFlatUsd: assumed(0.8, "Logpush->R2 planning figure; unmeasured"),
    domainFlatUsd: assumed(0.2, "allocated domain amortized; unmeasured"),
  };
}

export function syntheticRequest(scale: number): BillRequest {
  return {
    unit: syntheticUnitModel(),
    devGenerations: SYNTHETIC_GENERATIONS.dev,
    prodGenerations: SYNTHETIC_GENERATIONS.prod,
    scale,
    // tax omitted -> reported UNKNOWN, excluded from total.
  };
}

export const SCENARIO_SCALES = [1, 3, 10] as const;
