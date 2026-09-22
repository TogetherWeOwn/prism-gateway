/**
 * Lab configuration: dev and prod are separately named, with no shared
 * secrets or resource IDs. Placeholder bindings only — no real Cloudflare
 * resources are referenced anywhere in this lab.
 *
 * Security default: both environments ship with inference and management
 * disabled (`inferenceEnabled: false`, `managementEnabled: false`).
 * Enabling either requires an explicit, out-of-band configuration change
 * that this lab never performs on its own.
 */
export interface LabConfig {
  environment: "dev" | "prod";
  inferenceEnabled: boolean;
  managementEnabled: boolean;
  /** Placeholder binding names only, e.g. "LAB_KV_PLACEHOLDER". */
  bindings: Record<string, string>;
  /** Distinct non-secret resource labels per environment. Must not match across envs. */
  resourceLabel: string;
}

export const DEV_CONFIG: LabConfig = {
  environment: "dev",
  inferenceEnabled: false,
  managementEnabled: false,
  bindings: {
    KV_CATALOG: "LAB_DEV_KV_PLACEHOLDER",
    COORDINATOR: "LAB_DEV_DO_PLACEHOLDER",
    HISTORY_DB: "LAB_DEV_D1_PLACEHOLDER",
  },
  resourceLabel: "prism-lab-dev",
};

export const PROD_CONFIG: LabConfig = {
  environment: "prod",
  inferenceEnabled: false,
  managementEnabled: false,
  bindings: {
    KV_CATALOG: "LAB_PROD_KV_PLACEHOLDER",
    COORDINATOR: "LAB_PROD_DO_PLACEHOLDER",
    HISTORY_DB: "LAB_PROD_D1_PLACEHOLDER",
  },
  resourceLabel: "prism-lab-prod",
};

export function loadConfig(environment: string): LabConfig {
  if (environment === "dev") return { ...DEV_CONFIG };
  if (environment === "prod") return { ...PROD_CONFIG };
  throw new Error(`unknown environment: ${environment} (expected "dev" or "prod")`);
}
