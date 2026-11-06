import test from 'node:test';
import assert from 'node:assert/strict';
import { readRentalDates } from '../src/ai/rental-dates.js';
const now = new Date(2026, 10, 6);
test('short dates and separators', () => {
  for (const input of ['11 20', '11/20', '11-20', '11월 20일', '11.20'])
    assert.deepEqual(readRentalDates(input, now), ['2026-11-20']);
});
test('cross-year ranges', () => {
  assert.deepEqual(readRentalDates('12 30 ~ 1 3', now), ['2026-12-30','2027-01-03']);
  assert.deepEqual(readRentalDates('1 10', now), ['2027-01-10']);
  assert.deepEqual(readRentalDates('11 20 ~ 11 22', now), ['2026-11-20','2026-11-22']);
});
test('explicit years stay explicit', () => {
  assert.deepEqual(readRentalDates('2026-11-20 ~ 2026-11-22', now), ['2026-11-20','2026-11-22']);
  assert.deepEqual(readRentalDates('2026-12-30 ~ 1 3', now), ['2026-12-30','2027-01-03']);
});
test('invalid dates are rejected', () => {
  assert.deepEqual(readRentalDates('2 30', now), ['']);
  assert.deepEqual(readRentalDates('2026-02-29', now), ['']);
  assert.deepEqual(readRentalDates('2026-11-22 ~ 2026-11-20', now), ['2026-11-22','2026-11-20']);
});
test('year is based on submission day', () => {
  assert.deepEqual(readRentalDates('1 3', new Date(2027, 0, 1)), ['2027-01-03']);
  assert.deepEqual(readRentalDates('1 3', new Date(2026, 11, 31)), ['2027-01-03']);
});
