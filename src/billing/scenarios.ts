/**
 * Pinned synthetic scenario inputs for the Phase-0 full-bill calculator.
 *
 * SYNTHETIC ONLY: these figures are planning illustrations from the issued
 * plan table, NOT measured fleet traffic. They exist so the meter math,
 * boundary behavior and pooling logic are tested reproducibly while the
 * usage collector (blocked) cannot supply real counts. Every quantity is
 * labeled assumed_unmeasured; rates are documented_tariff; tax is unavailable.
 */
import type { BillRequest, Labeled, UnitModel } from "./calculator.js";

const assumed = (value: number, note: string): Labeled => ({
  value,
  label: "assumed_unmeasured",
  note,
});

const tariff = (value: number, note: string): Labeled => ({
  value,
  label: "documented_tariff",
  note,
});

/** Placeholder generation counts. 1M/mo planning figure; dev share token. */
export const SYNTHETIC_GENERATIONS = {
  dev: assumed(50_000, "synthetic dev-test share; replace with metered dev counts"),
  prod: assumed(950_000, "synthetic 1M/mo planning figure; replace with metered CLIProxy counts"),
};

export function syntheticUnitModel(): UnitModel {
  return {
    workerInvocationsPerAttempt: assumed(1.05, "gateway + amortized consumer/admin share"),
    workerCpuMsPerAttempt: tariff(20, "profiling target from plan, not a deployed benchmark"),
    doRequestsPerAttempt: assumed(3, "admission + renewal-amortized + settlement"),
    doGbSecondsPerAttempt: assumed(0.01125, "30ms active on 128MB per DO request"),
    doSqliteReadsPerGeneration: assumed(6, "incl. index reads; unmeasured"),
    doSqliteWritesPerGeneration: assumed(4, "incl. indexes + outbox lifecycle; unmeasured"),
    queueMessagesPerGeneration: assumed(1, "one packed message per generation after batching"),
    queueBytesPerMessage: assumed(2_048, "2KB wire incl. metadata; measure real event size"),
    queueRetryRatio: assumed(0.02, "2% redelivery; unmeasured"),
    dlqMessagesPerMonth: assumed(100, "token dead-letter volume; unmeasured"),
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
