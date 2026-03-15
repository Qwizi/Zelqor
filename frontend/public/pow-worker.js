// Proof-of-work Web Worker — finds nonce where SHA-256(challenge + nonce) has N leading zero bits
self.onmessage = async (e) => {
  const { challenge, difficulty } = e.data;
  let nonce = 0;

  while (true) {
    const data = new TextEncoder().encode(challenge + nonce);
    const hash = await crypto.subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(hash);

    if (countLeadingZeroBits(bytes) >= difficulty) {
      self.postMessage({ nonce: String(nonce) });
      return;
    }
    nonce++;
  }
};

function countLeadingZeroBits(bytes) {
  let count = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      count += 8;
    } else {
      count += Math.clz32(byte) - 24;
      break;
    }
  }
  return count;
}
