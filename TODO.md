# TODO

* Remove the raw status endpoint, but preserve the button for having a pretty-prented version of the json status.
* Update the status endpoint to better organize the json. put all pentair values inside a pentair object and all uptimes in a single "uptimeseconds" object (with short property names like "pentair"). Rename "system" to "blusentinel". Add a new "system" object at the beginning and move logIntervalMinutes and currentTime into it.
* Remove the heartbeat/ping behavior from the pentair client but preserve the auto-reconnection behavior. Update the reconnection behavior to follow the simpler pattern in bsclient which also ensures that we are resillient to the device being down on server start.
* Consult
* Replace the fake controller infrastructure with a mock blusentinel class which implements the modbus TCP protocol, as we did for pentair. Update tests to use this, taking care to address any timing issues the same way we did for the pentair tests. This should simplify the bsclient code, removing lines of code there, in exchange for adding a new class in the tests. Pull register definitions from the bsclient code instead of duplicating them (refactoring if necessary).
* Update the README.md to better reflect the current system and link to ARCHITECTURE.md. Add new app screenshots and mention the use of agentic coding, especially in building the UI and test suite.

## Additional test coverage 
* Extend the pentair client tests to cover the ping behavior to keep the connection alive.
* Review the BSclient testing, is using a mock bsclient good enough or should I be using the fake controller? Or perhaps we should create a mock bs server (just like the pentair one) that exposes just a TCP server. Perhaps these can be used for test development as well.

## Log reader updates
* Make tapping on the uptime card show a graph over time for al three lines.
* Make tapping on any other card show a graph of that data over time according to the current historical mode.


## Logger test cleanups
* Make all tests setup and teardown the pentair server config. This should resolve the redundancy between the pentair connection tests and heater on tests and perhaps even let us avoid having extra before/after config for these tests at all.
* Tests use a mixing of overriding real functions vs. passing in mocks (like the fake now and mockFs). What is considered best practice and should we unify on one pattern or the other?
