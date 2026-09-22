/** Session boundary: stateful-transport bookkeeping for the lab (no live connections). */
import type { GateDecision } from "../types.js";
import type { LabConfig } from "../config.js";

export interface SessionRecord {
  sessionId: string;
  tenant: string;
  createdAt: string;
}

/**
 * Sessions exist only as records in the lab. Creating one requires
 * explicitly enabled inference; otherwise the request is denied.
 */
export function openSession(
  config: LabConfig,
  tenant: string,
): SessionRecord | GateDecision {
  if (!config.inferenceEnabled) {
    return { allowed: false, reason: `session denied by default in ${config.environment}` };
  }
  return {
    sessionId: `lab-session-${Date.now()}`,
    tenant,
    createdAt: new Date().toISOString(),
  };
}
