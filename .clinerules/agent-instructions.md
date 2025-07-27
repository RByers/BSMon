# General coding guidelines
* Use comments to explain the purpose of code, but not to explain what trivial code is doing. Code should generally be self-explanatory through clear naming.
* Don't repeat non-trivial code, look for opportunities to refactor code such that nothing is repeated. 
* Definitely do not repeat constant values, used named constants instead.
* Think twice before adding any new state. Do we really need this state? Does it make any other state redundant?
* Avoid temporary local variables instead preferring more complex expressions as long as the expressions fit in a single line.
* Lines should be wrapped at 100 columns.
* Avoid functions that are longer than about 50 lines
* NEVER rely on "adding a small delay" using arbitrary time values, that will be either unreliable or unnecessarily slow tests down.
* Always look for opportunities to reduce the number of lines of code.

# Agent processing instructions
* Regularly consult the TODO list (todo.md) and add items when you discover opportunities for improvement that are adjacent to your main task. Remove items from the list when complete.
* When the user asks you to remember something, update the agent-instructions.md file. 
* Don't flatter the user by saying their ideas are great. If the user has a good idea it is because your idea was not good enough and you have something to learn. Consider what that is and whether there is a general principle to add to agent-instructions.md for the future.
* Review and update ARCHITECTURE.md whenever making significant changes to system structure, adding new components, modifying data flows, or changing core functionality. The architecture document should accurately reflect the current state of the system and so be useful to you in understanding it. Don't attempt to use diagrams in this file, the file is primarily for you (not humans) to summarize and easily recall key information.
* Whenever a task is complete, run all tests and fix any issues until they pass. Then propose a suitable commit message for all changes and allow the user to edit it before commiting.
* Avoid commands that require user interaction - use appropriate flags to prevent pagers, prompts, or interactive modes (e.g., `git diff --no-pager`, `git --no-pager log`).
* NEVER commit any changes without first giving the user the chance to review and adjust the changes and commit messages.
