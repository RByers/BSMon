# TODO


## Log reader updates
* Update the server to set headers such that the client fetch will cache the last 24 hour data for the logging interval (eg. 15 minutes).
* Add pentair uptime to the UI under a new system card. This should be calculated from the pentair total time seconds divided by the time between the log timestamps.
* Explore how to add blu sentinal uptime to the UI
* Explore how to add bsmon server uptime to the UI

## UI explorations
* Look at putting blu sentinel data in one container and pentair data in another. Attach the uptime to the outer container somehow rather than giving it it's own card.

## Logger test cleanups
* Make all tests setup and teardown the pentair server config. This should resolve the redundancy between the pentair connection tests and heater on tests and perhaps even let us avoid having extra before/after config for these tests at all.
* Tests use a mixing of overriding real functions vs. passing in mocks (like the fake now and mockFs). What is considered best practice and should we unify on one pattern or the other?
