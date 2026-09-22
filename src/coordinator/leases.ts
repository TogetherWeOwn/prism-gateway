/** Coordinator boundary: admission leases for lab exchanges. */
import type { GateDecision } from "../types.js";
import type { LabConfig } from "../config.js";

export interface Lease {
  requestId: string;
  attemptId: string;
  model: string;
  configVersion: string;
  expiresAt: string;
}

/**
 * Issue an execution lease. Denied unless the environment explicitly
 * enables inference — which no checked-in config does.
 */
export function requestLease(config: LabConfig, model: string): Lease {
  if (!config.inferenceEnabled) {
    throw new Error(
      `coordinator: inference denied in ${config.environment} (inferenceEnabled=false)`,
    );
  }
  const now = Date.now();
  return {
    requestId: `lab-req-${now}`,
    attemptId: `lab-attempt-${now}-1`,
    model,
    configVersion: "lab-v0",
    expiresAt: new Date(now + 60_000).toISOString(),
  };
}

export function gateStatus(config: LabConfig): GateDecision {
  if (config.inferenceEnabled) {
    return { allowed: true, reason: "explicitly configured" };
  }
  return { allowed: false, reason: `denied by default in ${config.environment}` };
}
