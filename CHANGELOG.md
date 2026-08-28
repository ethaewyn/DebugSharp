# Changelog

All notable changes to DebugSharp are documented here.

## [1.9.0]

### Added

- **Skips unchanged builds** — `dotnet build` is skipped when the compiled output is already newer than every input: the project tree, the `.csproj`, the restore marker, `Directory.Build.props` and friends, and every referenced project transitively. Quick Test reuses existing binaries via `--no-build`; Quick Rebuild always rebuilds. Controlled by `debugSharp.skipUnchangedBuilds`.
- **C# Dev Kit coexistence** — the Test Explorer stands down when Dev Kit is installed, since two controllers list every test twice and run each through separate `dotnet test` invocations. Controlled by `debugSharp.testExplorer`. The NuGet manager stays enabled.

### Fixed

- **Expression evaluation never had working IntelliSense.** The generated scaffold was not valid C#: `class _ { void _() {` is `CS0542`, and a bare expression in a method body is `CS1002`. A syntax error leaves Roslyn without a parse tree, and completion needs a tree. The wrapper is renamed and the expression now sits in an array initializer, where a half-typed expression is only a binding error.
- **Evaluating inside a lambda showed the wrong scope.** Frame selection picked the first frame with an on-disk source, which walks past compiler-generated lambda frames onto the enclosing method. The scaffold now follows the frame VS Code has focused — the same frame the Debug Console evaluates in — and updates when you select a different one in the Call Stack.
- **A lambda's captured variables were invisible.** Compiler-generated closures (`<>4__this`, `CS$<>8__locals1`) were discarded rather than expanded through.
- **Deleting, renaming or moving a source file skipped the build.** Only file timestamps were checked, and none of those operations changes a remaining file's mtime — a rename even preserves the moved file's own. Directory timestamps are now checked too.
- **Build errors without a source file never reached the Problems panel.** `MSBUILD`, `CSC` and restore diagnostics were filed against invented paths like `<cwd>/MSBUILD`. They now attach to the project being built.
- **Every problem message ended with `[C:\...\Project.csproj]`.** MSBuild appends it; the pattern meant to strip it was unreachable.
- **Problem parsing failed entirely on non-English installs**, which localize "error" and "warning". Tool output language is now pinned.
- **Debugging a test reported no result.** Every test came back skipped; the TRX logger was writing results all along and they were discarded.
- **Quick Launch used the wrong launch profile.** A single global profile name was applied to whichever project was inferred, and on a fresh window no profile was applied at all — ignoring `launchSettings.json`. Profiles are now remembered per project and default to the first `commandName: "Project"` profile, matching `dotnet run`.
- **Namespaces added mid-session never appeared** in evaluation IntelliSense; the cache was never invalidated.
- Projects with an `<AssemblyName>` differing from the project name failed to resolve their build output.
- Paths containing spaces broke NuGet, project-reference and test commands.

### Changed

- **Always builds `Debug`.** Dev Kit owns a configuration picker in the status bar and exposes no way to read its selection, so a second selector could only ever disagree with it — silently building Debug while the visible picker said Release. Use Dev Kit's build commands or `dotnet build -c Release` for other configurations.
- The `C# Build` output channel is always English, so diagnostics stay parseable.
- Reference closures are cached and composed. A 200-project layered solution took ~23s to check — slower than the build it avoids — and is now ~0.6s, scaling linearly to 500+ projects.

### Internal

- Reorganized by feature: `shared/`, `build/`, `launch/`, `eval/`, `testing/`, `dependencies/`.
- One `dotnet` runner replaces five near-identical process wrappers; one cached project index replaces seven uncached workspace scans.

## [1.8.0] and earlier

See the commit history.
