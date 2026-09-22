/**
 * Bounded incremental SSE parser for the lab.
 *
 * Rules:
 * - Accepts arbitrary byte-chunk splits (feeds raw strings; a UTF-8 split
 *   across JS string halves is reassembled by buffering the tail).
 * - Rejects any single event field exceeding MAX_FIELD_BYTES.
 * - Rejects total buffered payload exceeding MAX_BUFFER_BYTES (1 MiB).
 * - Only `data:` fields are surfaced; comments (`:`) are ignored.
 * - A `[DONE]` data payload terminates the stream.
 */
export const MAX_FIELD_BYTES = 64 * 1024;
export const MAX_BUFFER_BYTES = 1024 * 1024;

export interface ParsedEvent {
  event?: string;
  data: string;
}

export class BoundedSseParser {
  private buffer = "";
  private bufferedBytes = 0;
  private done = false;

  feed(chunk: string): ParsedEvent[] {
    if (this.done) throw new Error("parser: feed after stream end");
    this.buffer += chunk;
    this.bufferedBytes += Buffer.byteLength(chunk, "utf8");
    if (this.bufferedBytes > MAX_BUFFER_BYTES) {
      throw new Error(`parser: buffer exceeded ${MAX_BUFFER_BYTES} bytes`);
    }
    const out: ParsedEvent[] = [];
    let boundary = this.buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const event = this.parseBlock(block);
      if (event) {
        out.push(event);
        if (event.data === "[DONE]") {
          this.done = true;
          this.buffer = "";
          break;
        }
      }
      boundary = this.buffer.indexOf("\n\n");
    }
    return out;
  }

  private parseBlock(block: string): ParsedEvent | null {
    let event: string | undefined;
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue; // comment / heartbeat
      const colon = line.indexOf(":");
      if (colon === -1) continue;
      const field = line.slice(0, colon);
      let value = line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (Buffer.byteLength(value, "utf8") > MAX_FIELD_BYTES) {
        throw new Error(`parser: event field exceeded ${MAX_FIELD_BYTES} bytes`);
      }
      if (field === "event") event = value;
      else if (field === "data") dataLines.push(value);
    }
    if (dataLines.length === 0) return null;
    const result: ParsedEvent = { data: dataLines.join("\n") };
    if (event !== undefined) result.event = event;
    return result;
  }

  get finished(): boolean {
    return this.done;
  }
}
