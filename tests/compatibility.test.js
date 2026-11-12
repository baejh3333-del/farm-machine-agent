import test from 'node:test';
import assert from 'node:assert/strict';
import { findCompatibleRentals, rentalDays } from '../src/data/compatibility.js';
import { buildMockListings } from '../server/listing-seed.js';
import { GARAGE_KEY, readGarage, updateGarage } from '../src/data/garage-store.js';
import { createGarage } from '../src/garage.js';
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
test('두 탭이 동시에 등록해도 보유 농기계가 모두 남는다', async () => {
  const data = new Map();
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  const add = (garage, id, modelId) => ({ owned: [...garage.owned, { id, modelId, name: id }], selectedId: id });
  let secondWrite;
  await updateGarage(storage, (garage) => {
    secondWrite = updateGarage(storage, (latest) => add(latest, 'b', 'daedong-dk550'));
    return add(garage, 'a', 'asia-amc900');
  });
  const second = await secondWrite;
  assert.deepEqual(second.owned.map((item) => item.id), ['a', 'b']);
  assert.equal(readGarage(storage).selectedId, 'b');
  const removed = await updateGarage(storage, (garage) => ({ ...garage, owned: garage.owned.filter((item) => item.id !== 'b') }));
  assert.deepEqual([removed.owned.length, removed.selectedId], [1, 'a']);
  assert.equal((await updateGarage(storage, (garage) => ({ ...garage, selectedId: 'gone' }))).selectedId, 'a');
  data.set(GARAGE_KEY, '{broken');
  assert.deepEqual(readGarage(storage), { owned: [], selectedId: '' });
});

test('시간 동기화 후 날짜 최솟값을 갱신하고 반납일은 시작일 이후로 제한한다', () => {
  const elements = new Map();
  const root = {
    addEventListener() {},
    querySelectorAll() { return []; },
    querySelector(id) {
      if (!elements.has(id)) elements.set(id, { value: '', addEventListener() {} });
      return elements.get(id);
    },
  };
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener() {} };
  try {
    let now = '2026-11-13';
    const garage = createGarage({ root, today: () => now });
    const start = elements.get('#compatStart');
    const end = elements.get('#compatEnd');
    assert.deepEqual([start.min, end.min], ['2026-11-13', '2026-11-13']);
    now = '2026-11-12';
    garage.refresh();
    assert.deepEqual([start.min, end.min], ['2026-11-12', '2026-11-12']);
    start.value = '2026-11-15';
    garage.refresh();
    assert.equal(end.min, '2026-11-15');
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
