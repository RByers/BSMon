// Mock the settings module
jest.mock('../settings.json', () => require('./settings-test.json'), { virtual: true });

const { bitsVal } = require('../server');

test('bitsVal returns value if no bits', () => {
  expect(bitsVal(5)).toBe(5);
});

test('bitsVal returns "0" if val is falsy', () => {
  expect(bitsVal(0, ['A', 'B'])).toBe('0');
});

test('bitsVal returns correct bit names', () => {
  const bits = ['A', 'B', 'C', 'D'];
  // 5 = 0101b, so bits 0 and 2
  expect(bitsVal(5, bits)).toBe('A, C');
  // 10 = 1010b, so bits 1 and 3
  expect(bitsVal(10, bits)).toBe('B, D');
}); 