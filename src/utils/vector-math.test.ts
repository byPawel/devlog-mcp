import { cosineSimilarity, floatArrayToBlob, blobToFloatArray } from './vector-math.js';

it('cosineSimilarity is 1 for identical vectors, 0 for orthogonal', () => {
  expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
});

it('blob round-trips a float array', () => {
  const v = [0.1, -0.5, 3.14];
  const round = blobToFloatArray(floatArrayToBlob(v));
  expect(round[0]).toBeCloseTo(0.1);
  expect(round[2]).toBeCloseTo(3.14);
});

it('cosineSimilarity returns 0 on length mismatch or zero vector', () => {
  expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
});
