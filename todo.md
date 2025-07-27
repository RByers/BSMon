# TODO

## Logger test cleanups
* Make all tests setup and teardown the pentair server config. This should resolve the redundancy between the pentair connection tests and heater on tests and perhaps even let us avoid having extra before/after config for these tests at all.
* Tests use a mixing of overriding real functions vs. passing in mocks (like the fake now and mockFs). What is considered best practice and should we unify on one pattern or the other?