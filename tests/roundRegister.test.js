const { roundRegister } = require('../server');

test('roundRegister rounds to specified decimals', () => {
  expect(roundRegister(3.14159, { round: 2 })).toBe('3.14');
  expect(roundRegister(2.718, { round: 1 })).toBe('2.7');
});

test('roundRegister returns string if no round', () => {
  expect(roundRegister(42, {})).toBe('42');
}); 