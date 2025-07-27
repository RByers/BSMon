# TODO

## Logger test cleanups
- Reduce splitting and parsing of log lines, instead using the getLastDataRow helper consistently where useful
- Simplify 'handles heater remaining on across log period boundary' test to use common logfile logic
- Simplify MockPentairServer class (remove unnecessary complexity in `sendStatusToClient`)
- Create assertion helpers like `expectRegisterAverages(parts, expectedValue)`
- Reduce test setup duplication in heater tests with better helper functions
