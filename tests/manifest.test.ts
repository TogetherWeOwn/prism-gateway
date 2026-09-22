import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MANIFEST } from "../src/evidence/manifest.js";
import { DEV_CONFIG, PROD_CONFIG } from "../src/config.js";

const REQUIRED_PROVIDERS = [
  "openai-codex",
  "claude",
  "meta",
  "devin",
  "opencode-go",
  "z.ai",
  "kimi",
  "xai",
];

describe("compatibility/evidence manifest", () => {
  it("names all eight mandatory providers", () => {
    const names = MANIFEST.providers.map((p) => p.provider).sort();
    assert.deepEqual(names, [...REQUIRED_PROVIDERS].sort());
    assert.equal(MANIFEST.version, 1);
  });

  it("keeps client-dialect and parity gates visible", () => {
    for (const gate of [
      "gemini-generate",
      "gemini-stream",
      "codex-compact",
      "codex-reasoning-replay",
      "claude-tool-alias-parity",
    ]) {
      assert.ok(
        (MANIFEST.clientDialectGates as string[]).includes(gate),
        `missing gate ${gate}`,
      );
    }
  });

  it("rejects a supported row lacking deployed proof", () => {
    for (const row of MANIFEST.providers) {
      if (row.advertised === "supported") {
        assert.equal(row.deployedProof, "proven", `${row.provider}: supported without deployed proof`);
        assert.equal(row.quotaProof, "proven", `${row.provider}: supported without quota proof`);
      }
    }
  });

  it("rejects quota proof without deployed proof", () => {
    for (const row of MANIFEST.providers) {
      if (row.quotaProof === "proven") {
        assert.equal(row.deployedProof, "proven", `${row.provider}: quota proven but deployment unproven`);
      }
    }
  });

  it("initial lab state advertises nothing as supported", () => {
    const supported = MANIFEST.providers.filter((p) => p.advertised === "supported");
    assert.equal(supported.length, 0);
  });
});

describe("dev/prod configuration separation", () => {
  it("uses distinct resource labels and no shared bindings", () => {
    assert.notEqual(DEV_CONFIG.resourceLabel, PROD_CONFIG.resourceLabel);
    const devValues = new Set(Object.values(DEV_CONFIG.bindings));
    for (const value of Object.values(PROD_CONFIG.bindings)) {
      assert.ok(!devValues.has(value), `shared binding value: ${value}`);
    }
    assert.equal(DEV_CONFIG.inferenceEnabled, false);
    assert.equal(PROD_CONFIG.inferenceEnabled, false);
  });
});
