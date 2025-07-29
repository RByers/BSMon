# TODO

* Add 24h average Cl and Ph outputs to the UI
* Update the README.md to better reflect the current system and link to ARCHITECTURE.md. Add new app screenshots and mention the use of agentic coding, especially in building the UI and test suite.
* Figure out why I am getting "empty response" loading the page from some clients (SW / caching issue?).

## Additional test coverage 
* Extend the pentair client tests to cover the ping and heartbeat behavior to keep the connection alive.
* Review the BSclient testing, is using a mock bsclient good enough or should I be using the fake controller? Or perhaps we should create a mock bs server (just like the pentair one) that exposes just a TCP server. Perhaps these can be used for test development as well.

## Log reader updates
* Update the server to set headers such that the client fetch will cache the last 24 hour data for the logging interval (eg. 15 minutes). But restarting the server should invalidate the cache somehow so I don't get confused during development. Should I use eTags for that?
* Provide the logging interval setting from the server to the client via the status endpoint
* Compute missing logging data by comparing log timestamps to the logging interval setting and use that to generate a bsmon service uptime figure added to the uptime card.
* Make tapping on the uptime card show a graph over time for al three lines.
* Provide a UI switch to toggle between 24h, 7d and 30d historical modes and update the log endpoint to support all three. 
* Make tapping on any other card show a graph of that data over time according to the current historical mode.

## UI explorations
* Look at putting blu sentinel data in one container and pentair data in another. Attach the uptime to the outer container somehow rather than giving it it's own card.

## Logger test cleanups
* Make all tests setup and teardown the pentair server config. This should resolve the redundancy between the pentair connection tests and heater on tests and perhaps even let us avoid having extra before/after config for these tests at all.
* Tests use a mixing of overriding real functions vs. passing in mocks (like the fake now and mockFs). What is considered best practice and should we unify on one pattern or the other?
