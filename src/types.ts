/**
 * Prism Gateway Phase-0 lab — shared types.
 * Offline lab only: no network calls, no credentials, no production behavior.
 */

/** How inference/management requests are gated. Defaults deny. */
export interface GateDecision {
  allowed: boolean;
  reason: string;
}

/** A bounded synthetic usage event produced by the lab exchange. */
export interface UsageEvent {
  eventId: string;
  requestId: string;
  provider: string;
  /** Locally measured only — never presented as provider-reported quota. */
  source: "locally_measured";
  tokensIn: number;
  tokensOut: number;
  observedAt: string;
}

/** Result of one synthetic lab exchange. */
export interface ExchangeResult {
  requestId: string;
  status: number;
  sseEvents: string[];
  usage: UsageEvent;
}
