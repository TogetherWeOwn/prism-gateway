/**
 * Consumer Worker entry point (lab stub).
 * Projects usage events into an in-memory ledger for the lab test.
 */
import type { UsageEvent } from "../types.js";

export class UsageLedger {
  private events: UsageEvent[] = [];

  record(event: UsageEvent): void {
    if (event.source !== "locally_measured") {
      throw new Error("consumer: only locally_measured lab events accepted");
    }
    if (this.events.some((e) => e.eventId === event.eventId)) return; // dedup
    this.events.push(event);
  }

  get size(): number {
    return this.events.length;
  }
}
