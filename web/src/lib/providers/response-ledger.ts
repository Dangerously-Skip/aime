/**
 * Which API response each piece of streamed output came from — so a response
 * the SDK later RETRACTS can be taken back off the screen.
 *
 * Agent SDK 0.3 can re-run a refused reply on a fallback model. When it does,
 * it names the messages it threw away — `retracted_message_uuids` on the
 * `model_refusal_fallback` system message, and `supersedes` on the first frame
 * of the replacement — and tells consumers to evict them. We never did: the
 * refused partial stayed on screen above the fallback's answer, read as the
 * assistant contradicting itself, and went back to the model as history.
 *
 * The client never sees SDK uuids; it sees a stream of text and tool calls
 * appended to one reply. So each of those chunks is tagged with a SEGMENT — one
 * per API response — and a retraction is translated from "these uuids" into
 * "these segments and these tool calls", which the transcript can remove by
 * position. Segment ids carry a per-query prefix because the chat route runs
 * several queries per user turn (resume legs) and their counters would collide.
 *
 * Separate from the provider so the bookkeeping can be tested without a stream.
 */

export interface Retraction {
  /** Segments whose text and tool calls must come off the reply. */
  segments: string[];
  /** Tool calls to remove — those made in the retracted segments, plus tombstoned results. */
  toolUseIds: string[];
  /** The text each retracted segment streamed, in order — for server-side copies of the reply. */
  texts: string[];
}

export class ResponseLedger {
  private seq = 0;
  private currentId: string | null = null;
  private current: string | null = null;
  private readonly uuidSegment = new Map<string, string>();
  private readonly uuidTools = new Map<string, string[]>();
  private readonly segmentTools = new Map<string, string[]>();
  private readonly segmentText = new Map<string, string>();
  private readonly retractedSegments = new Set<string>();
  private readonly retractedTools = new Set<string>();

  constructor(private readonly leg: string) {}

  /**
   * The segment for a message with this API id. A different id opens a new
   * segment; the same id (the CLI sends one frame per content block, all
   * sharing the response's id) stays in it. No id at all stays in the current
   * one rather than splitting a response in two.
   */
  open(messageId: unknown): string {
    const id = typeof messageId === 'string' && messageId ? messageId : null;
    if (this.current && (id === null || id === this.currentId)) return this.current;
    return this.next(id);
  }

  /**
   * A response is starting (`message_start`). Always a new segment — unless it
   * carries the id of the one already open — because a start is by definition
   * a new response even when an id is missing.
   */
  begin(messageId: unknown): string {
    const id = typeof messageId === 'string' && messageId ? messageId : null;
    if (id !== null && id === this.currentId && this.current) return this.current;
    return this.next(id);
  }

  private next(id: string | null): string {
    this.seq += 1;
    this.currentId = id;
    this.current = `${this.leg}:${this.seq}`;
    return this.current;
  }

  /** The segment output is currently being attributed to. */
  get segment(): string {
    return this.current ?? this.open(null);
  }

  noteText(segment: string, text: string): void {
    this.segmentText.set(segment, (this.segmentText.get(segment) ?? '') + text);
  }

  noteTool(segment: string, toolUseId: string): void {
    const list = this.segmentTools.get(segment) ?? [];
    list.push(toolUseId);
    this.segmentTools.set(segment, list);
  }

  /** An assistant frame's uuid, and the segment it was delivered in. */
  noteFrame(uuid: unknown, segment: string): void {
    if (typeof uuid === 'string' && uuid) this.uuidSegment.set(uuid, segment);
  }

  /** A tool-result frame's uuid and the calls it answered — a retraction can name these too. */
  noteToolResults(uuid: unknown, toolUseIds: string[]): void {
    if (typeof uuid === 'string' && uuid && toolUseIds.length) this.uuidTools.set(uuid, toolUseIds);
  }

  /**
   * Translate retracted uuids into what to remove. Idempotent — the SDK can
   * name the same messages twice (on `supersedes` and again on the notice) —
   * and unknown uuids are ignored, as the SDK specifies. `except` protects the
   * segment of the frame doing the superseding. Null when nothing new.
   */
  retract(uuids: unknown, except?: string): Retraction | null {
    if (!Array.isArray(uuids)) return null;
    const segments: string[] = [];
    const tools: string[] = [];
    for (const u of uuids) {
      if (typeof u !== 'string') continue;
      const seg = this.uuidSegment.get(u);
      if (seg && seg !== except && !this.retractedSegments.has(seg) && !segments.includes(seg)) segments.push(seg);
      for (const id of this.uuidTools.get(u) ?? []) if (!tools.includes(id)) tools.push(id);
    }
    for (const seg of segments) for (const id of this.segmentTools.get(seg) ?? []) if (!tools.includes(id)) tools.push(id);
    const toolUseIds = tools.filter((id) => !this.retractedTools.has(id));
    if (segments.length === 0 && toolUseIds.length === 0) return null;
    // In the order they were streamed, so a server-side copy can find each one.
    segments.sort((a, b) => this.order(a) - this.order(b));
    for (const s of segments) this.retractedSegments.add(s);
    for (const id of toolUseIds) this.retractedTools.add(id);
    return { segments, toolUseIds, texts: segments.map((s) => this.segmentText.get(s) ?? '') };
  }

  private order(segment: string): number {
    return Number(segment.slice(segment.lastIndexOf(':') + 1));
  }
}
