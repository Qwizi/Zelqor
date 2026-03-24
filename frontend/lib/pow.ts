/** Solve a proof-of-work challenge using a Web Worker. */
export function solveChallenge(challenge: string, difficulty: number, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker("/pow-worker.js");
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("PoW timeout"));
    }, timeoutMs);

    worker.onmessage = (e: MessageEvent<{ nonce: string }>) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(e.data.nonce);
    };

    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error("PoW worker error"));
    };

    worker.postMessage({ challenge, difficulty });
  });
}
