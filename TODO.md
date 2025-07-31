# TODO

* Add bsmon servwr uptime to the ststus endpoint
* Change the uptimes card to have three rows, bsmon, blusentinel and pentair. The left column should keep the percentage stat we have now, but the right column should have tines like "Up 4d" or "Down 2m". For bsmon itself just say "down" when down since we have no good way to know when the server went down. When "down" make it red.
* Update the README.md to better reflect the current system and link to ARCHITECTURE.md. Add new app screenshots and mention the use of agentic coding, especially in building the UI and test suite.
* Remove the raw status endpoint, but preserve the button for having a pretty-prented version of the json status. Add anything missing from the raw status into the json status.
* Add better error handling to the client in the case of connections to the server failing. The UI should update to show an alarm saying connections to the server have failed.

## Additional test coverage 
* Extend the pentair client tests to cover the ping and heartbeat behavior to keep the connection alive.
* Review the BSclient testing, is using a mock bsclient good enough or should I be using the fake controller? Or perhaps we should create a mock bs server (just like the pentair one) that exposes just a TCP server. Perhaps these can be used for test development as well.

## Log reader updates
* Make tapping on the uptime card show a graph over time for al three lines.
* Make tapping on any other card show a graph of that data over time according to the current historical mode.

## UI explorations
* Look at putting blu sentinel data in one container and pentair data in another. Attach the uptime to the outer container somehow rather than giving it it's own card.

## Logger test cleanups
* Make all tests setup and teardown the pentair server config. This should resolve the redundancy between the pentair connection tests and heater on tests and perhaps even let us avoid having extra before/after config for these tests at all.
* Tests use a mixing of overriding real functions vs. passing in mocks (like the fake now and mockFs). What is considered best practice and should we unify on one pattern or the other?
