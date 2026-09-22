/**
 * Versioned compatibility/evidence manifest — Phase 0, revision 1.
 *
 * Every mandatory provider row starts UNPROVEN: no deployed-Worker
 * evidence exists yet. A test in tests/manifest.test.ts rejects any row
 * marked supported/proven without deployed proof, so a row can only turn
 * green together with its evidence.
 */
export const MANIFEST_VERSION = 1;

export type EvidenceStatus = "proven" | "unproven";

export interface ProviderRow {
  provider: string;
  auth: string[];
  dialect: string[];
  transport: string[];
  sourceStatus: string;
  fixtureStatus: string;
  deployedProof: EvidenceStatus;
  quotaProof: EvidenceStatus;
  /** Public status: only "supported" when deployedProof AND quotaProof are proven. */
  advertised: "supported" | "unproven";
  notes: string;
}

const unproven = (
  provider: string,
  auth: string[],
  dialect: string[],
  transport: string[],
  notes: string,
): ProviderRow => ({
  provider,
  auth,
  dialect,
  transport,
  sourceStatus: "recorded-in-plan",
  fixtureStatus: "pending",
  deployedProof: "unproven",
  quotaProof: "unproven",
  advertised: "unproven",
  notes,
});

export const PROVIDERS: ProviderRow[] = [
  unproven("openai-codex", ["api-key", "oauth"], ["chat-completions", "responses", "codex-aliases"], ["https", "sse"], "Codex compact/reasoning parity gate: visible, untested."),
  unproven("claude", ["api-key", "oauth"], ["messages", "count-tokens"], ["https", "sse"], "Tool-alias (Claude-cloak) parity gate: visible, untested."),
  unproven("meta", ["device-flow", "dca-to-key"], ["responses"], ["https", "sse"], "DCA enrollment → minted inference key; trailing subscription_usage tail unproven on Workers."),
  unproven("devin", ["oauth", "connect"], ["connect-rpc", "responses"], ["https", "sse"], "Connect/protobuf framing + GetUserStatus quota path unproven on Workers."),
  unproven("opencode-go", ["api-key", "usage-bearer"], ["provider-native"], ["https", "sse"], "Direct HTTPS inference + zen usage endpoint unproven on Workers."),
  unproven("z.ai", ["api-key", "subscription"], ["chat-completions", "responses"], ["https", "sse"], "Subscription windows/cooldown unproven."),
  unproven("kimi", ["api-key", "subscription"], ["claude-native", "responses", "chat-completions"], ["https", "sse"], "Account/plan windows unproven."),
  unproven("xai", ["api-key"], ["responses"], ["https", "sse"], "Billing/rate-limit fields unproven; no invented subscription percentages."),
];

export const CLIENT_DIALECT_GATES = [
  "gemini-generate",
  "gemini-stream",
  "codex-compact",
  "codex-reasoning-replay",
  "claude-tool-alias-parity",
] as const;

export const MANIFEST = {
  version: MANIFEST_VERSION,
  generatedAt: "2026-09-22",
  providers: PROVIDERS,
  clientDialectGates: [...CLIENT_DIALECT_GATES],
};
