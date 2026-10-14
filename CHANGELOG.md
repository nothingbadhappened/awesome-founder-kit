# Changelog

What changed in each Founder Kit release, in plain words. `fk update` shows the entries between your version and the new one.

## v0.8.0 (2026-10-14)

Taking the kit off your computer now also cleans up your projects first, if you want: `fk uninstall --system` lists each project still set up for the kit, with the tools `fk provision` added there, and asks per project (or for all at once) whether to roll those tools back and take the kit out of the project. Both happen before the kit itself is removed, because they need it; without questions, add `--rollbacks` and `--projects` to `--yes`. The README was rewritten to be shorter and to match what the kit really does. Coming from 0.7: `fk init` now also adds Claude Code sandbox and permission rules that keep agents out of the kit's folder, and agents can no longer switch off or uninstall the kit; `fk update` brings new versions (from an agent, only after you type `fk-approve update <version> <reason>`); `fk uninstall --system` takes the kit off the computer using the install list the kit now keeps; and `fk-approve gates` and `fk-approve baseline` are the lines you type to approve changing a gate command or re-recording the baseline.

## v0.7.0 (2026-10-14)

The kit now keeps an exact list of what it installs, changes and creates on your computer, and of what was already there (which it never touches). `fk uninstall --system` uses that list to take the kit back out, step by step, with your choice of what goes. `fk update` shows what changed in a new version and updates the kit after one yes; a short note at session start tells you when a new version is out.
