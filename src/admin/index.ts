/**
 * Admin Worker entry point (lab stub).
 * Management is denied until explicitly configured.
 */
import { loadConfig } from "../config.js";
import type { GateDecision } from "../types.js";

export function adminStatus(environment: string): GateDecision {
  const config = loadConfig(environment);
  if (!config.managementEnabled) {
    return { allowed: false, reason: `admin: management denied in ${environment}` };
  }
  return { allowed: true, reason: "explicitly configured" };
}
