# TODO

## Client-side heater duty cycle functionality (deferred)
* Create static/logreader.js module with functions to:
  - Fetch log data from /api/logs/24h endpoint  
  - Parse CSV response on client side
  - Calculate heater duty cycle (HeaterOnSeconds / PentairSeconds over 24h period)
* Add functions to static/client.js to call duty cycle calculation and add to the heater card in the UI
* Add client-side unit tests for CSV parsing and duty cycle calculation  
* Update ARCHITECTURE.md to document new client-side log processing module

## Log reader updates

## Logger test cleanups
* Make all tests setup and teardown the pentair server config. This should resolve the redundancy between the pentair connection tests and heater on tests and perhaps even let us avoid having extra before/after config for these tests at all.
* Tests use a mixing of overriding real functions vs. passing in mocks (like the fake now and mockFs). What is considered best practice and should we unify on one pattern or the other?
