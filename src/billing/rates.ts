/**
 * Published tariff table for the Phase-0 full-bill calculator.
 *
 * Generic rate constants only — no fleet traffic, no account data, no
 * credentials. Every rate carries its official source URL and the date it
 * was transcribed. Re-verify against the live pricing pages before any
 * budget sign-off: transcription in this run is not a certified tariff audit.
 */

export interface RateSource {
  url: string;
  /** Date the rate was transcribed, YYYY-MM-DD. */
  transcribed: string;
  note: string;
}

export const RATE_SOURCES: Record<string, RateSource> = {
  workers: {
    url: "https://developers.cloudflare.com/workers/platform/pricing/",
    transcribed: "2026-09-22",
    note: "Paid plan $5/mo incl. 10M requests + 30M CPU-ms; overage $0.30/M requests, $0.02/M CPU-ms.",
  },
  durableObjects: {
    url: "https://developers.cloudflare.com/durable-objects/platform/pricing/",
    transcribed: "2026-09-22",
    note: "1M requests + 400k GB-s incl.; overage $0.15/M requests, $12.50 per whole M GB-s of excess. DO SQLite billed separately.",
  },
  durableObjectsSqlite: {
    url: "https://developers.cloudflare.com/durable-objects/platform/pricing/",
    transcribed: "2026-09-22",
    note: "25B row reads / 50M row writes / 5 GB-mo incl.; overage $0.001/M reads, $1/M writes, $0.20/GB-mo.",
  },
  queues: {
    url: "https://developers.cloudflare.com/queues/platform/pricing/",
    transcribed: "2026-09-22",
    note: "1M ops incl.; overage $0.40/M ops. Billed per 64 KB chunk incl. metadata; standard ops = write + read + delete.",
  },
  d1: {
    url: "https://developers.cloudflare.com/d1/platform/pricing/",
    transcribed: "2026-09-22",
    note: "25B rows read / 50M rows written / 5 GB-mo incl.; overage $0.001/M reads, $1/M writes, $0.75/GB-mo.",
  },
  r2: {
    url: "https://developers.cloudflare.com/r2/platform/pricing/",
    transcribed: "2026-09-22",
    note: "10 GB-mo incl.; overage $0.015/GB-mo. Standard Class A $4.50/M ops, Class B $0.36/M ops.",
  },
};

export const TARIFF = {
  workersPlanUsd: 5,
  workersRequestsIncluded: 10_000_000,
  workersRequestsOveragePerM: 0.3,
  workersCpuMsIncluded: 30_000_000,
  workersCpuOveragePerM: 0.02,
  doRequestsIncluded: 1_000_000,
  doRequestsOveragePerM: 0.15,
  doGbSecondsIncluded: 400_000,
  doGbSecondsBlockUsd: 12.5,
  doGbSecondsBlockSize: 1_000_000,
  doSqliteReadsIncluded: 25_000_000_000,
  doSqliteReadsOveragePerM: 0.001,
  doSqliteWritesIncluded: 50_000_000,
  doSqliteWritesOveragePerM: 1,
  doSqliteGbMonthsIncluded: 5,
  doSqliteGbMonthOverage: 0.2,
  queueOpsIncluded: 1_000_000,
  queueOpsOveragePerM: 0.4,
  /** Queue billing quantum in bytes, metadata included. */
  queueChunkBytes: 64_000,
  /** Standard billable operations per delivered message: write + read + delete. */
  queueOpsPerMessage: 3,
  d1ReadsIncluded: 25_000_000_000,
  d1ReadsOveragePerM: 0.001,
  d1WritesIncluded: 50_000_000,
  d1WritesOveragePerM: 1,
  d1GbMonthsIncluded: 5,
  d1GbMonthOverage: 0.75,
  r2GbMonthsIncluded: 10,
  r2GbMonthOverage: 0.015,
  r2ClassAOveragePerM: 4.5,
  r2ClassBOveragePerM: 0.36,
} as const;
