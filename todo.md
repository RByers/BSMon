# TODO

## Logger test cleanups
- Unify log parsing logic by moving `parseLogOutput` to top level
- Simplify MockPentairServer class (remove unnecessary complexity in `sendStatusToClient`)
- Create assertion helpers like `expectRegisterAverages(parts, expectedValue)`
- Reduce test setup duplication in heater tests with better helper functions
