/** Cosine similarity in [-1, 1]. Returns 0 on length mismatch or zero-norm. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Pack a float array into a Float64 BLOB (mirrors embedding_cache storage). */
export function floatArrayToBlob(vec: number[]): Buffer {
  return Buffer.from(new Float64Array(vec).buffer);
}

/** Unpack a Float64 BLOB back into a number[]. */
export function blobToFloatArray(blob: Buffer): number[] {
  const f = new Float64Array(blob.buffer, blob.byteOffset, Math.floor(blob.byteLength / 8));
  return Array.from(f);
}
