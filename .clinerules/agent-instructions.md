# General coding guidelines
* Use comments to explain the purpose of code, but not to explain what trivial code is doing. Code should generally be self-explanatory through clear naming.
* Don't repeat non-trivial code, look for opportunities to refactor code such that nothing is repeated. 
* Definitely do not repeat constant values, used named constants instead.
* Think twice before adding any new state. Do we really need this state? Does it make any other state redundant?
* Only break expressions into multiple lines with local variables when it adds significant clarity or keeps lines from exceeding 100 characters in length. 
* Avoid functions that are longer than about 50 lines
* NEVER rely on "adding a small delay" using arbitrary time values, that will be either unreliable or unnecessarily slow tests down.

# Agent processing instructions
* Regularly consult the TODO list (todo.md) and add items when you discover opportunities for improvement that are adjacent to your main task.
