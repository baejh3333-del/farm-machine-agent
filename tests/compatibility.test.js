import test from 'node:test';
import assert from 'node:assert/strict';
import { findCompatibleRentals, rentalDays } from '../src/data/compatibility.js';
import { buildMockListings } from '../server/listing-seed.js';
const options = { mode: 'set', operation: 'mulch', start: '2026-11-20', end: '2026-11-22', today: '2026-11-07' };
const listings = buildMockListings();

test('세트는 두 매물이 모두 가능한 기간에 제조사 확인 조합만 추천한다', () => {
  const { results } = findCompatibleRentals(listings, options);
  assert.ok(results.length);
  for (const item of results) {
    assert.equal(item.power.modelId, 'asia-amc900');
    assert.equal(item.implement.modelId, 'asia-fm120n');
    assert.equal(item.totalPrice, (item.power.price + item.implement.price) * 3);
  }
  const powerId = results[0].power.id;
  const implementId = results[0].implement.id;
  const blocked = listings.map((item) => item.id === powerId || item.id === implementId ? { ...item, booked: [{ start: '2026-11-22', end: '2026-11-23' }] } : item);
  assert.ok(findCompatibleRentals(blocked, options).results.every((item) => item.power.id !== powerId && item.implement.id !== implementId));
  assert.equal(findCompatibleRentals(listings.map((item) => ({ ...item, condition: 'repair' })), options).results.length, 0);
});
test('보유 모델에 따라 세 가지 상태를 보여주고 호환만 필터링한다', () => {
  const owned = { ...options, mode: 'owned', modelId: 'daedong-dk550', operation: '' };
  const { results } = findCompatibleRentals(listings, owned);
  assert.ok(results.some((item) => item.verdict.status === 'incompatible'));
  assert.ok(results.some((item) => item.verdict.status === 'check'));
  assert.equal(findCompatibleRentals(listings, { ...owned, onlyCompatible: true }).results.length, 0);
  const compatible = findCompatibleRentals(listings, { ...owned, modelId: 'asia-amc900', onlyCompatible: true }).results;
  assert.ok(compatible.length);
  assert.ok(compatible.every((item) => !item.power && item.verdict.status === 'compatible' && item.totalPrice === item.implement.price * 3));
});
test('미확인 트랙터 조합은 세트 추천에서 제외한다', () => {
  assert.equal(findCompatibleRentals(listings, { ...options, operation: 'seed' }).results.length, 0);
  assert.ok(findCompatibleRentals(listings, { ...options, mode: 'owned', modelId: '' }).error);
});
test('잘못된 날짜·과거 기간을 거르고 포함 일수를 계산한다', () => {
  assert.equal(rentalDays('2026-11-20', '2026-11-20'), 1);
  assert.equal(rentalDays('2026-11-22', '2026-11-20'), 0);
  assert.equal(rentalDays('2026-02-30', '2026-03-04'), 0);
  assert.ok(findCompatibleRentals(listings, { ...options, start: '2026-11-06' }).error);
});
