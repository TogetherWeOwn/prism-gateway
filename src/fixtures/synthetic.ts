/**
 * Redacted synthetic fixtures for the lab. All payloads are invented,
 * contain no customer prompts, keys, or account IDs, and are labeled
 * as offline fixtures — never as deployed-Worker proof.
 */

/** One chunk of a synthetic SSE exchange, split at an awkward byte offset. */
export const SYNTHETIC_SSE_CHUNKS: string[] = [
  'data: {"id":"lab-evt-1","delta":"Hel',
  'lo, lab ',
  'world"}\n\ndata: {"id":"lab-evt-2","delta":" — synthetic fixture"}\n\n: heartbeat-ignored\n\ndata: [DONE]\n\n',
];

/** Expected parsed payloads for the chunks above. */
export const SYNTHETIC_SSE_EXPECTED: string[] = [
  '{"id":"lab-evt-1","delta":"Hello, lab world"}',
  '{"id":"lab-evt-2","delta":" — synthetic fixture"}',
  "[DONE]",
];

export const FIXTURE_PROVENANCE = {
  kind: "synthetic_offline_fixture",
  deployedProof: false,
  note: "Invented lab data. Must never be presented as a deployed-Worker result.",
} as const;
