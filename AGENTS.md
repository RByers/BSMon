# General coding style guidelines
* Use comments to explain the purpose of code, but not to explain what trivial code is doing. Code should generally be self-explanatory through clear naming.
* Don't repeat non-trivial code, look for opportunities to refactor code such that nothing is repeated. 
* Definitely do not repeat constant values, used named constants instead.
* Think twice before adding any new state. Do we really need this state? Does it make any other state redundant?
* Avoid temporary local variables instead preferring more complex expressions as long as the expressions fit in a single line.
* Lines should be wrapped at 100 columns.
* Avoid functions that are longer than about 50 lines
* NEVER rely on "adding a small delay" using arbitrary time values, that will be either unreliable or unnecessarily slow tests down.
* Always look for opportunities to reduce the number of lines of code.
* Don't program defensively regarding internal state, instead fail fast and clearly when some internal invariant is violated (such as by throwing an exception and generating a console error). Unhandled exceptions in the event of programs bugs are good, they ensure the server crashes and stops rather than continues running with possible data corruption.
* Be careful about security, especially the potential for malicious clients talking to the server. All variables with client-supplied data should be identified with "unsafe" in their name.
* Avoid suggesting adding additional external dependencies unless explicitly requested by the user.
* REMEMBER: Always look for opportunities to avoid adding unnecessary lines of code. Be concise and precise!

# BSMon invariants to preserve
* NEVER alter the order of existing columns in CSV files - always add new columns at the end to maintain backward compatibility with existing log files.
* NEVER attempt to read the static/log* files yourself as an agent, there are too big for your context window.

# Agent processing instructions
* Regularly consult the TODO list (TODO.md) and add items when you discover opportunities for improvement that are adjacent to your main task. Remove items from the list when complete.
* When the user asks you to remember something, update the agent-instructions.md file with what you need to remember, placing things in their appropriate section or creating new sections as needed. 
* Don't flatter the user by saying their ideas are great. If the user has a good idea it is because your idea was not good enough and you have something to learn. Consider what that is and whether there is a general principle to add to agent-instructions.md for the future.
* Review and update ARCHITECTURE.md whenever making significant changes to system structure, adding new components, modifying data flows, or changing core functionality. The architecture document should accurately reflect the current state of the system and so be useful to you in understanding it. Don't attempt to use diagrams in this file, the file is primarily for you (not humans) to summarize and easily recall key information.
* Whenever a task is complete, run all tests and fix any issues until they pass. Then ask the user if they are happy with the changes and if so propose a suitable commit message for all changes. Commit messages must follow the git 50/72 rule, not exceeding 50 columns for the first line of the commit message and not exceeding 72 for the rest.
* Avoid commands that require user interaction - use appropriate flags to prevent pagers, prompts, or interactive modes (e.g., `git --no-pager diff`, `git --no-pager log`).
* NEVER commit any changes, let the user do that manually themselves. REMEMBER: you are not allowed to run `git commit`!
* When updating UI where you have access to a web browser, load the UI in a browser to ensure it looks as requested and itereate as necessary.
* Be concise and precise. Keep responses to a minimum unless asked to elaborate.
* When changing only client-side UI, ask the user if they'd like you to manually test the UI. If so, use your built-in browser tool to open index.html using "#serverHost" to point to the server. If you don't know the server hostname, ask the user. Use the `view` parameter to jump directly to the view you want to test.
* When changing the server, assume that `npx nodemon server.js` is already running and just use your browser tool to open localhost.

# Testing
* Before running tests, make sure all dependencies are installed by running `npm install`.
* The tests require a `settings-test.json` file to be present in the `tests/` directory. This file should have `use_fake_controller` set to `true` and have a valid VAPID key pair.
* Run the tests using `npm test`.
* All tests should pass before submitting any changes.