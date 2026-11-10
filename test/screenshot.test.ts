import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeScreenshot } from '../src/screenshot.ts';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

test('decodes a valid base64 PNG', () => {
  const out = decodeScreenshot(png.toString('base64'));
  assert.deepEqual(Array.from(out!), Array.from(png));
});

test('rejects non-string and empty input', () => {
  assert.equal(decodeScreenshot(undefined), undefined);
  assert.equal(decodeScreenshot(42), undefined);
  assert.equal(decodeScreenshot(''), undefined);
});

test('rejects data that is not base64', () => {
  assert.equal(decodeScreenshot('not base64!!'), undefined);
});

test('rejects base64 without a PNG signature', () => {
  assert.equal(decodeScreenshot(Buffer.from('hello world, not a png').toString('base64')), undefined);
});

test('rejects payloads over the size cap', () => {
  assert.equal(decodeScreenshot(png.toString('base64'), 8), undefined);
});
