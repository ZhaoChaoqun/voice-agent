/** Little-endian PCM conversion shared by browser playback and unit tests. */

// Voice Live's PCM transport and the capture worklet use mono 24 kHz samples.
export const SAMPLE_RATE = 24_000;

/** Decode base64 signed PCM16 into normalized audio samples. */
export function decodePcm(encoded: string): Float32Array {
  const binary = atob(encoded);
  if (binary.length % 2 !== 0) throw new Error("Invalid PCM16 byte count");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(bytes.length / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 32768;
  }
  return samples;
}

/** Encode PCM bytes without overflowing the call stack on large chunks. */
export function encodePcm(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
