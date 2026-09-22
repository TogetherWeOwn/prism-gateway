import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { syntheticExchange, gatewayStatus } from "../src/gateway/index.js";
import { adminStatus } from "../src/admin/index.js";
import { UsageLedger } from "../src/consumer/index.js";
import { BoundedSseParser } from "../src/protocol/sse.js";
import {
  SYNTHETIC_SSE_CHUNKS,
  SYNTHETIC_SSE_EXPECTED,
} from "../src/fixtures/synthetic.js";

describe("synthetic HTTP/SSE exchange", () => {
  it("parses split chunks and terminates on [DONE]", () => {
    const result = syntheticExchange();
    assert.equal(result.status, 200);
    assert.deepEqual(result.sseEvents, SYNTHETIC_SSE_EXPECTED);
  });

  it("parses byte-at-a-time feeds identically", () => {
    const joined = SYNTHETIC_SSE_CHUNKS.join("");
    const parser = new BoundedSseParser();
    const events: string[] = [];
    for (const char of joined) {
      for (const event of parser.feed(char)) events.push(event.data);
    }
    assert.deepEqual(events, SYNTHETIC_SSE_EXPECTED);
    assert.equal(parser.finished, true);
  });

  it("rejects an oversized field", () => {
    const parser = new BoundedSseParser();
    assert.throws(() => parser.feed(`data: ${"x".repeat(70 * 1024)}\n\n`), /exceeded/);
  });

  it("rejects feed after stream end", () => {
    const parser = new BoundedSseParser();
    parser.feed("data: [DONE]\n\n");
    assert.throws(() => parser.feed("data: late\n\n"), /after stream end/);
  });

  it("projects usage into the ledger with dedup", () => {
    const result = syntheticExchange();
    const ledger = new UsageLedger();
    ledger.record(result.usage);
    ledger.record(result.usage);
    assert.equal(ledger.size, 1);
    assert.equal(result.usage.source, "locally_measured");
  });
});

describe("deny-by-default gates", () => {
  for (const env of ["dev", "prod"]) {
    it(`gateway denies inference in ${env}`, () => {
      const decision = gatewayStatus(env);
      assert.equal(decision.allowed, false);
    });
    it(`admin denies management in ${env}`, () => {
      const decision = adminStatus(env);
      assert.equal(decision.allowed, false);
    });
  }
});
