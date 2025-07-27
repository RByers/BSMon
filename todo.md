# TODO

## Logger test cleanups
- Suppress console.error from test output when it's expected - invalid HTMODE
- Create assertion helpers like `expectRegisterAverages(parts, expectedValue)`
- Review the use of 'FAIL' register values, is that testing something that can actually happen in the code? Instead we should probably ensure that log entries are only written when there are valid values available for all columns.
- Move the mock pentair server logic to the top so that it can be used by other tests in the future too.
- Attempt to simplify triple setImmediate in MockPentairServer.sendStatus to single setImmediate or process.nextTick. We had problems before with tests being flaky without this, if triple setImmediate calls are actually required, try to understand why it's 3 and not 2 or 4 and whether that makes our test system brittle.
