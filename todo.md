# TODO

## Logger test cleanups
- Consolidate mock setup patterns with `setupNewLogFile()` and `setupExistingLogFile()` helpers
- Extract constants (CSV column count, register names array, column indices)
- Unify log parsing logic by moving `parseLogOutput` to top level
- Simplify MockPentairServer class (remove unnecessary complexity in `sendStatusToClient`)
- Create assertion helpers like `expectRegisterAverages(parts, expectedValue)`
- Reduce test setup duplication in heater tests with better helper functions
