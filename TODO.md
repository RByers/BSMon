# TODO

* For 30d charts there are too many data points, making it look very noisy. Reduce these to one point ever 2 hours in the data series. Average all the values over a 2 hour period, and if there are none skip the point entirely. 
* Update the pentair reconnection behavior to follow the simpler pattern in bsclient which also ensures that we are resillient to the device being down on server start.
* Replace the fake controller infrastructure with a mock blusentinel class which implements the modbus TCP protocol, as we did for pentair. Update tests to use this, taking care to address any timing issues the same way we did for the pentair tests. This should simplify the bsclient code, removing lines of code there, in exchange for adding a new class in the tests. Pull register definitions from the bsclient code instead of duplicating them (refactoring if necessary).
* Update the README.md to better reflect the current system and link to ARCHITECTURE.md. Add new app screenshots and mention the use of agentic coding, especially in building the UI and test suite.

## Additional test coverage 
* Extend the pentair client tests to cover the ping behavior to keep the connection alive.
* Review the BSclient testing, is using a mock bsclient good enough or should I be using the fake controller? Or perhaps we should create a mock bs server (just like the pentair one) that exposes just a TCP server. Perhaps these can be used for test development as well.

## Log reader updates
* Make tapping on the uptime card show a graph over time for al three lines.
* Make tapping on the pH, ORP, and Temperature cards show a graph of that data over time according to the current historical mode.
* When opening a chart, change the URL using a hash value eg. '#view=chartCl,days=30'. Preserve the serverHost hash paramater if any. When the page is loaded read the hash and open any requested view. This way reloading when on a certain view doesn't change the view. (DONE)

## Logger test cleanups
* Make all tests setup and teardown the pentair server config. This should resolve the redundancy between the pentair connection tests and heater on tests and perhaps even let us avoid having extra before/after config for these tests at all.
* Tests use a mixing of overriding real functions vs. passing in mocks (like the fake now and mockFs). What is considered best practice and should we unify on one pattern or the other?
