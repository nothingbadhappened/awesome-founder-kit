# Changelog

What changed in each Founder Kit release, in plain words. `fk update` shows the entries between your version and the new one.

## v0.10.0 (2026-10-18)

The rules your product must always keep are now numbered in docs/00-constraints.md (BR-1, BR-2, ...), each with how to check it and why. Every review answers each rule, and a task cannot close while a rule is broken, until a later review confirms it is fixed. A rule cannot be dropped or retired in the middle of a task without you, and rules marked (draft) or (retired) are not checked. The kit no longer assumes any particular tools: it never defaults to npm, just, mise or containers, and uses whatever check command your project already has (or asks you once). Setup now installs only git, Node.js, Claude Code, oh-my-claudecode and gitleaks; everything else is optional (add it with --with <name> or --all, or when your project's tool list needs it). fk portability check accepts any runner, version pinning and service setup, and fk portability init with its justfile and CI templates is gone. Run fk update on existing projects: the old npm run default is cleared.

## v0.9.0 (2026-10-16)

Agents no longer redo work only you can judge (images, video, audio, copy, designs) in an endless loop. Before the first generate or render call in a session, the agent shows you a cheap preview (an outline, storyboard, thumbnails or a sample) and asks what done looks like and how many attempts you want. After 3 such calls without hearing from you (change it with `fk-approve rounds <n|off>`), it stops, shows what it has and asks before going on. It also offers ideas from other chats instead of applying them unasked. Code work is not affected. Kickoff now asks for your attempt count.

## v0.8.1 (2026-10-14)

Installer fixes found by the first real-install tests. A palace that `mempalace init` has just set up now counts as ready, so the installer no longer stays red and reruns init (the palace folder only appears on the first save). On Linux, codebase-memory now installs where a user's default settings make `~/.local/bin` group-writable, which its installer refuses. On macOS, the installer no longer prints shell errors while recording what was already on the computer.

## v0.8.0 (2026-10-14)

Taking the kit off your computer now also cleans up your projects first, if you want: `fk uninstall --system` lists each project still set up for the kit, with the tools `fk provision` added there, and asks per project (or for all at once) whether to roll those tools back and take the kit out of the project. Both happen before the kit itself is removed, because they need it; without questions, add `--rollbacks` and `--projects` to `--yes`. The README was rewritten to be shorter and to match what the kit really does. Coming from 0.7: `fk init` now also adds Claude Code sandbox and permission rules that keep agents out of the kit's folder, and agents can no longer switch off or uninstall the kit; `fk update` brings new versions (from an agent, only after you type `fk-approve update <version> <reason>`); `fk uninstall --system` takes the kit off the computer using the install list the kit now keeps; and `fk-approve gates` and `fk-approve baseline` are the lines you type to approve changing a gate command or re-recording the baseline.

## v0.7.0 (2026-10-14)

The kit now keeps an exact list of what it installs, changes and creates on your computer, and of what was already there (which it never touches). `fk uninstall --system` uses that list to take the kit back out, step by step, with your choice of what goes. `fk update` shows what changed in a new version and updates the kit after one yes; a short note at session start tells you when a new version is out.
