import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Worker global so we can control what the "worker" responds with
// without needing an actual JS file to serve.
// ---------------------------------------------------------------------------

type WorkerMessageHandler = (event: MessageEvent<{ nonce: string }>) => void;

class MockWorker {
  onmessage: WorkerMessageHandler | null = null;
  onerror: (() => void) | null = null;
  lastPostedMessage: unknown = null;

  static instances: MockWorker[] = [];

  constructor(_scriptUrl: string) {
    MockWorker.instances.push(this);
  }

  postMessage(msg: unknown) {
    this.lastPostedMessage = msg;
    // Defer so the Promise executor has time to attach onmessage.
    queueMicrotask(() => {
      // Default behaviour: respond with a nonce derived from the challenge.
      const payload = msg as { challenge: string; difficulty: number };
      const nonce = `solved-${payload.challenge}-${payload.difficulty}`;
      this.onmessage?.(new MessageEvent("message", { data: { nonce } }));
    });
  }

  terminate() {}
}

vi.stubGlobal("Worker", MockWorker);

import { solveChallenge } from "../pow";

describe("solveChallenge", () => {
  beforeEach(() => {
    MockWorker.instances = [];
    vi.useFakeTimers();
  });

  it("resolves with the nonce returned by the worker", async () => {
    // Run real timers for the microtask queue so queueMicrotask fires, then
    // restore fake timers. The simplest approach is to use real timers here.
    vi.useRealTimers();
    const nonce = await solveChallenge("abc123", 4);
    expect(nonce).toBe("solved-abc123-4");
  });

  it("posts the challenge and difficulty to the worker", async () => {
    vi.useRealTimers();
    await solveChallenge("xyz", 8);
    const worker = MockWorker.instances[MockWorker.instances.length - 1];
    expect(worker.lastPostedMessage).toEqual({ challenge: "xyz", difficulty: 8 });
  });

  it("rejects with a timeout error when the worker does not respond in time", async () => {
    // Provide a worker that never responds.
    class SilentWorker extends MockWorker {
      postMessage(_msg: unknown) {
        this.lastPostedMessage = _msg;
        // intentionally do not call onmessage
      }
    }
    vi.stubGlobal("Worker", SilentWorker);

    vi.useFakeTimers();
    const promise = solveChallenge("challenge", 4, 1000);
    // Advance time past the timeout.
    vi.advanceTimersByTime(1500);
    await expect(promise).rejects.toThrow("PoW timeout");

    // Restore real Worker mock for subsequent tests.
    vi.stubGlobal("Worker", MockWorker);
  });

  it("rejects when the worker fires an onerror event", async () => {
    class ErrorWorker extends MockWorker {
      postMessage(_msg: unknown) {
        this.lastPostedMessage = _msg;
        queueMicrotask(() => {
          this.onerror?.();
        });
      }
    }
    vi.stubGlobal("Worker", ErrorWorker);

    vi.useRealTimers();
    await expect(solveChallenge("fail", 4)).rejects.toThrow("PoW worker error");

    vi.stubGlobal("Worker", MockWorker);
  });
});
