import { EventEmitter } from "node:events";

export interface SyncLogEvent {
  type: "log";
  runId: string;
  entry: {
    kind: "log" | "upsert";
    level: "info" | "error";
    message: string;
    table_name: string | null;
    row_count: number | null;
    data: Record<string, unknown> | null;
    created_at: string;
  };
}

export interface SyncCompleteEvent {
  type: "complete";
  runId: string;
  result: Record<string, unknown>;
}

export type SyncEvent = SyncLogEvent | SyncCompleteEvent;

/**
 * Singleton event bus for broadcasting sync log entries and completion to
 * WebSocket clients. The sync logger emits events here alongside DB writes;
 * WS handlers subscribe via `on(`run:${runId}`, callback)`.
 */
class SyncEventBus extends EventEmitter {
  private static _instance: SyncEventBus | null = null;

  private constructor() {
    super();
    this.setMaxListeners(50);
  }

  static getInstance(): SyncEventBus {
    if (!SyncEventBus._instance) {
      SyncEventBus._instance = new SyncEventBus();
    }
    return SyncEventBus._instance;
  }

  /** Emit a log entry for a specific sync run. */
  emitLog(
    runId: string,
    entry: SyncLogEvent["entry"]
  ): void {
    const event: SyncLogEvent = { type: "log", runId, entry };
    this.emit(`run:${runId}`, event);
  }

  /** Emit a completion event for a specific sync run. */
  emitComplete(runId: string, result: Record<string, unknown>): void {
    const event: SyncCompleteEvent = { type: "complete", runId, result };
    this.emit(`run:${runId}`, event);
  }

  /** Subscribe to all events for a specific sync run. */
  onRun(runId: string, listener: (event: SyncEvent) => void): void {
    this.on(`run:${runId}`, listener);
  }

  /** Unsubscribe from a specific sync run. */
  offRun(runId: string, listener: (event: SyncEvent) => void): void {
    this.off(`run:${runId}`, listener);
  }

  /** Remove all listeners for a specific sync run (cleanup after completion). */
  removeRunListeners(runId: string): void {
    this.removeAllListeners(`run:${runId}`);
  }
}

export const syncEventBus = SyncEventBus.getInstance();
