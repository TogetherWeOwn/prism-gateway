/**
 * Gateway Worker entry point (lab stub).
 * Denies inference until explicitly configured; runs one synthetic
 * offline exchange for tests only.
 */
import { BoundedSseParser } from "../protocol/sse.js";
import { SYNTHETIC_SSE_CHUNKS } from "../fixtures/synthetic.js";
import { loadConfig } from "../config.js";
import type { ExchangeResult, GateDecision } from "../types.js";

export function gatewayStatus(environment: string): GateDecision {
  const config = loadConfig(environment);
  if (!config.inferenceEnabled) {
    return { allowed: false, reason: `gateway: inference denied in ${environment}` };
  }
  return { allowed: true, reason: "explicitly configured" };
}

/** Offline synthetic HTTP/SSE exchange used by the lab test. No network. */
export function syntheticExchange(): ExchangeResult {
  const parser = new BoundedSseParser();
  const events: string[] = [];
  for (const chunk of SYNTHETIC_SSE_CHUNKS) {
    for (const event of parser.feed(chunk)) {
      events.push(event.data);
    }
  }
  if (!parser.finished) throw new Error("gateway: synthetic stream did not terminate");
  const now = new Date().toISOString();
  return {
    requestId: "lab-synthetic-1",
    status: 200,
    sseEvents: events,
    usage: {
      eventId: "lab-usage-1",
      requestId: "lab-synthetic-1",
      provider: "synthetic",
      source: "locally_measured",
      tokensIn: 0,
      tokensOut: 0,
      observedAt: now,
    },
  };
}
