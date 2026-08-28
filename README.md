# DebugSharp

All-in-one C# development extension for Visual Studio Code — IntelliSense-powered expression evaluation, builds that skip when nothing has changed, Test Explorer integration, NuGet & project reference management, and Problems panel reporting.

## Features

### Project Management

- **Quick Launch** (`Ctrl+Shift+Q`) - Smart launch: re-runs last project, or infers from active file
- **Launch Project** (`Ctrl+Shift+F5`) - Full project picker with launch profile selection
- **Quick Build** (`Ctrl+Shift+B`) - Build any project or solution with errors reported to Problems panel
- **Quick Clean** (`Ctrl+Shift+K`) - Clean build artifacts, clears Problems panel on success
- **Quick Rebuild** (`Ctrl+Shift+R`) - Clean and rebuild with automatic error detection
- **Quick Test** (`Ctrl+Shift+T`) - Run tests with failures shown in Problems panel
- **Problems Panel Integration** - All build, test errors appear with clickable file/line links
- **NuGet Package Manager** - Visual package management (right-click `.csproj`)
- **Project References** - Add/remove project references with transitive duplicate detection (right-click `.csproj`)
- **Skips unchanged builds** - Won't rerun `dotnet build` when nothing has changed since the last one
- **Smart project detection** - Remembers last used project for quick access

### Testing

- **Test Explorer Integration** - Native VS Code Test Explorer with tree view (project → namespace → class → method)
- **Run & Debug Tests** - Run from the Test Explorer sidebar, or debug with breakpoints — both report full results
- **Lazy Discovery** - Tests are discovered on demand via `dotnet test --list-tests`
- **TRX Result Parsing** - Accurate pass/fail/skip status with durations and failure messages
- **File Watching** - Automatically refreshes tests when `.cs` or `.csproj` files change

### Debugging Features

- **IntelliSense Expression Evaluator** - Edit C# expressions with full IntelliSense (types + variables)
- **Lambda Support** - Sees captured variables and the enclosing instance when stopped inside a lambda (ASP.NET minimal APIs, LINQ, etc.)
- **Follows the Call Stack** - The evaluation scope tracks the frame you select, so it always matches the Debug Console
- **Auto Debug Configuration** - Generate launch.json for all projects

## Usage

### Quick Launch & Build Commands

**Quick Launch** - Instantly re-run or smart-detect your project:

1. Press `Ctrl+Shift+Q` (Mac: `Cmd+Shift+Q`)
2. If you have a last launched project and the active file belongs to it → launches immediately with the same launch profile
3. If a last launched project exists but the active file is different → asks if you want to re-run it or choose another
4. If no last project but a `.cs` file is open → launches the project that contains it
5. Otherwise, falls back to the full project picker

**Launch Project** - Full project picker with profile selection:

1. Press `Ctrl+Shift+F5` (Mac: `Cmd+Shift+F5`) or run command "Launch Project"
2. Select your project from the list (last used appears first)
3. For ASP.NET projects with multiple launch profiles, choose one — the profile is remembered **per project**, and offered first next time
4. Project builds and debugging starts automatically

Quick Launch reuses the profile last chosen for that specific project. If you've never picked one, it uses the project's default — the first profile with `"commandName": "Project"`, matching `dotnet run`.

**Quick Build** - Build without running:

1. Press `Ctrl+Shift+B` (Mac: `Cmd+Shift+B`)
2. Select a project or solution (last used appears first)
3. Build runs with progress shown via notification
4. Any errors or warnings appear in the **Problems panel** (`Ctrl+Shift+M`)
5. Click any error to jump directly to the file and line

**Quick Clean** - Clean build artifacts:

1. Press `Ctrl+Shift+K` (Mac: `Cmd+Shift+K`)
2. Select a project or solution (last used appears first)
3. Removes all build outputs (bin/obj folders)
4. Clears the Problems panel on successful clean

**Quick Rebuild** - Clean and rebuild in one step:

1. Press `Ctrl+Shift+R` (Mac: `Cmd+Shift+R`)
2. Select a project or solution (last used appears first)
3. Cleans then builds sequentially
4. Build errors appear in the Problems panel

**Quick Test** - Run tests:

1. Press `Ctrl+Shift+T` (Mac: `Cmd+Shift+T`)
2. Select a test project or solution (last used appears first)
3. Tests run with results shown via notification
4. Any test failures appear in the **Problems panel** with stack traces
5. Build errors during test compilation also appear in Problems panel

**All commands support:**

- Individual .csproj files
- Solution (.sln) files
- Console applications
- ASP.NET Core Web APIs and MVC apps
- Test projects (xUnit, NUnit, MSTest)

**No tasks.json required!** Everything is handled automatically.

**Debug vs Release:** DebugSharp always builds and launches `Debug`, matching `dotnet build`'s own default. C# Dev Kit already shows a configuration picker in the status bar and exposes no way to read its selection, so a second selector could only ever disagree with it — silently building Debug while the visible picker said Release. When you need another configuration, use Dev Kit's build commands or `dotnet build -c Release` directly.

### Skipping unchanged builds

Launching normally means waiting on `dotnet build` even when you changed nothing. MSBuild does its own incremental check, but only after 1-2 seconds of startup and project evaluation — so a no-op build still costs you that time on every run.

DebugSharp answers the same question first, with a filesystem check:

- Finds the project's compiled assembly under `bin/Debug` — never another configuration, so a Release build sitting on disk can't make a stale Debug output look current
- Compares its timestamp against **every** input: all files in the project tree (not just `.cs` — `.resx`, `.json`, and content files all count), the `.csproj`, the restore marker `obj/project.assets.json`, and any `Directory.Build.props`, `Directory.Build.targets`, `Directory.Packages.props`, `global.json` or `NuGet.config` above it
- Repeats this for every referenced project, transitively

If the output wins, the build is skipped:

| Command                       | When up to date                                                        |
| ----------------------------- | ---------------------------------------------------------------------- |
| Quick Launch / Launch Project | Skips the build and starts debugging immediately                       |
| Quick Build                   | Reports "Up to date", runs nothing                                     |
| Quick Test                    | Passes `--no-build` — tests still run, they just don't recompile first |
| Quick Rebuild                 | Always rebuilds (it cleans first, so nothing is ever up to date)       |

The check is deliberately biased towards building: anything missing, unreadable, or ambiguous counts as stale. A needless build costs seconds, while a wrongly skipped one would run your old code. For solutions, every project the solution names must resolve and be up to date — one project outside the workspace and the whole solution rebuilds.

Set `debugSharp.skipUnchangedBuilds` to `false` to always build, or use **Quick Rebuild** (`Ctrl+Shift+R`) as a one-off override.

### Problems Panel Integration

**Automatic error detection and reporting:**

When you build, rebuild, clean, or test a project, DebugSharp automatically:

- **Parses dotnet command output** for errors and warnings
- **Reports issues to VS Code's Problems panel** (`Ctrl+Shift+M`)
- **Creates clickable links** to exact file locations and line numbers
- **Deduplicates errors** so each issue appears only once
- **Clears on clean** - successful clean operations remove all problems

**Supported error types:**

- Compilation errors (CS####)
- Build warnings
- Test failures with stack traces
- Missing references
- Syntax errors

**Why this matters:**

- Navigate to errors instantly by clicking in Problems panel
- See all issues at a glance in one organized view
- No need to parse terminal output manually
- Same experience as other VS Code language extensions

### NuGet Package Manager

**Manage NuGet packages visually:**

1. In Explorer, right-click any `.csproj` file
2. Select "Manage NuGet Packages"
3. A dedicated tab opens with:
   - Installed packages with version numbers
   - Search for packages from nuget.org
   - Install/Uninstall buttons
   - Version picker for each package
   - Package dependencies viewer
   - Visual indicators for installed packages

### Project References

**Add or remove project-to-project references:**

1. In Explorer, right-click any `.csproj` file
2. Select "Add Project Reference" or "Remove Project Reference"
3. A Quick Pick list shows available projects:
   - Already-referenced projects are marked
   - Transitive references (indirect dependencies) are labeled to prevent duplicates
   - Select one or more projects to add/remove
4. Uses `dotnet add reference` / `dotnet remove reference` under the hood (preserves csproj formatting)

### Test Explorer

**Run and debug tests from VS Code's Test Explorer sidebar:**

1. Open the **Testing** sidebar (click the beaker icon in the Activity Bar)
2. Test projects are discovered automatically from your workspace
3. Expand a project node to discover its tests (grouped by namespace → class → method)
4. Click the **Run** button next to any test, class, namespace, or project to run it
5. Click the **Debug** button to hit breakpoints — debug runs report the same pass/fail results as normal runs
6. Results show pass/fail/skip icons with durations
7. Failed tests display error messages and clickable stack trace locations inline
8. Tests automatically refresh when you edit `.cs` or `.csproj` files

**Supported frameworks:** xUnit, NUnit, MSTest

> **Using C# Dev Kit?** Dev Kit registers its own Test Explorer, so DebugSharp's stays out of the way — otherwise the Testing sidebar would list every test twice and run each one through two separate `dotnet test` invocations. Set `debugSharp.testExplorer` to `always` if you prefer this one. `Ctrl+Shift+T` (Quick Test) is unaffected and works either way.

### Evaluate Expressions with IntelliSense

**During debugging:**

1. Stop at a breakpoint
2. Press `Ctrl+Shift+E` (Mac: `Cmd+Shift+E`) or right-click → "Evaluate Expression"
3. A C# file opens with **full IntelliSense**:
   - All project types (classes, interfaces, enums)
   - Every variable in the current scope, with its runtime type
   - Member access and method signatures via `Ctrl+Space`
4. Type your expression (e.g., `myObject.MyMethod()`, `items.Where(x => x.Price > 10).ToList()`)
5. Press `Ctrl+Enter` (Mac: `Cmd+Enter`)
6. The expression is sent to the Debug Console and evaluated there

**Notes:**

- The file always describes the stack frame **currently selected in the Call Stack**. Click a different frame and it re-populates for that scope
- Inside a lambda you get the lambda's own locals, its captured variables, and the enclosing object's members
- Variables whose runtime type can't be expressed in C# (anonymous types, for instance) are declared `dynamic`; static completion isn't available on those

### Generate Debug Configurations

**Automatically create launch.json entries:**

1. Run command "Generate Debug Configurations"
2. All runnable projects and launch profiles are added to `.vscode/launch.json`
3. Use Run and Debug panel to select and launch

## Keyboard Shortcuts

| Shortcut                              | Command               | Description                                |
| ------------------------------------- | --------------------- | ------------------------------------------ |
| `Ctrl+Shift+Q` (Mac: `Cmd+Shift+Q`)   | Quick Launch          | Smart launch (re-run last or infer)        |
| `Ctrl+Shift+F5` (Mac: `Cmd+Shift+F5`) | Launch Project        | Full project picker with profile selection |
| `Ctrl+Shift+B` (Mac: `Cmd+Shift+B`)   | Quick Build           | Build project or solution                  |
| `Ctrl+Shift+K` (Mac: `Cmd+Shift+K`)   | Quick Clean           | Clean build artifacts                      |
| `Ctrl+Shift+R` (Mac: `Cmd+Shift+R`)   | Quick Rebuild         | Clean and rebuild                          |
| `Ctrl+Shift+T` (Mac: `Cmd+Shift+T`)   | Quick Test            | Run tests                                  |
| `Ctrl+Shift+E` (Mac: `Cmd+Shift+E`)   | Evaluate Expression   | Open evaluation panel (while debugging)    |
| `Ctrl+Enter` (Mac: `Cmd+Enter`)       | Send to Debug Console | Evaluate expression (in eval file)         |

## Requirements

- Visual Studio Code 1.108.0 or higher
- .NET SDK installed
- C# debugger (vsdbg) - comes with:
  - C# extension (ms-dotnettools.csharp) - **FREE and open source**, OR
  - C# Dev Kit (ms-dotnettools.csdevkit)

**Note:** This extension is completely **free and open-source compatible** — it needs only the C# extension, not C# Dev Kit.

### Alongside C# Dev Kit

DebugSharp is built to sit next to Dev Kit rather than compete with it:

| Feature                                                                                      | With Dev Kit installed                                                            |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Test Explorer                                                                                | **Disabled** — Dev Kit provides its own (override with `debugSharp.testExplorer`) |
| NuGet Package Manager                                                                        | **Enabled** — a more visual, Visual Studio-like package UI                        |
| Expression evaluation, build & launch commands, unchanged-build skipping, project references | **Enabled** — Dev Kit doesn't cover these                                         |

## Commands

All commands are under the **DebugSharp** category in the Command Palette.

### Project Management

| Command                                     | Shortcut        | Description                                                 |
| ------------------------------------------- | --------------- | ----------------------------------------------------------- |
| `DebugSharp: Quick Launch`                  | `Ctrl+Shift+Q`  | Re-run the last project, or infer one from the active file  |
| `DebugSharp: Launch Project`                | `Ctrl+Shift+F5` | Project picker with launch profile selection                |
| `DebugSharp: Quick Build Project`           | `Ctrl+Shift+B`  | Build a project or solution                                 |
| `DebugSharp: Quick Clean Project`           | `Ctrl+Shift+K`  | Clean a project or solution                                 |
| `DebugSharp: Quick Rebuild Project`         | `Ctrl+Shift+R`  | Clean and rebuild (always builds)                           |
| `DebugSharp: Quick Test Project`            | `Ctrl+Shift+T`  | Run tests                                                   |
| `DebugSharp: Generate Debug Configurations` | —               | Auto-generate `launch.json`                                 |
| `DebugSharp: Manage NuGet Packages`         | —               | Visual NuGet package management (right-click a `.csproj`)   |
| `DebugSharp: Add Project Reference`         | —               | Add project-to-project references (right-click a `.csproj`) |
| `DebugSharp: Remove Project Reference`      | —               | Remove project references (right-click a `.csproj`)         |

### Debugging

| Command                                       | Shortcut       | Description                                |
| --------------------------------------------- | -------------- | ------------------------------------------ |
| `DebugSharp: Evaluate Expression`             | `Ctrl+Shift+E` | Open the evaluation file with IntelliSense |
| `DebugSharp: Evaluate Expression from Editor` | `Ctrl+Enter`   | Send the expression to the Debug Console   |

## How It Works

### Scaffold-Based IntelliSense

DebugSharp writes a temporary `.vscode-debug-eval.cs` file into the project being debugged. Because it's a real file in your project, Roslyn analyses it with the project's full type information — that's what makes `Ctrl+Space` work. It holds typed declarations for everything in your current debug scope:

```csharp
// DebugSharp: auto-generated evaluation context
#pragma warning disable
#nullable disable
using MyApp.Models;

class __DebugSharpEval { void Evaluate() {
    List<WeatherForecast> forecast = default!;
    string[] summaries = default!;

    var __debugSharpResult = new object[] {
    // --- expression start ---
    forecast.Where(f => f.TemperatureC > 20).ToList()
    // --- expression end ---
    };
}}
```

**How the scaffold is built:**

1. The frame described is the one **VS Code has focused** in the Call Stack — the same frame the Debug Console evaluates against. Select a different frame and the scaffold follows it
2. An atomic `stackTrace` → `scopes` → `variables` chain retrieves the locals and their **runtime types** (not source-level `var`)
3. Compiler-generated closures are expanded through, so a lambda's captured variables and enclosing `this` appear as ordinary locals
4. Type names are sanitized into legal C#; anything unrecognisable degrades to `dynamic` rather than breaking the file
5. Source-file `using` directives and the project's own namespaces are included

**Two details make it work, and both are load-bearing:**

- The generated class and method **must not share a name**. `class _ { void _() {` is `CS0542` — it never compiles, which breaks both your build and IntelliSense.
- The expression lives in an **array initializer**, not bare in the method body. A bare expression isn't a statement (`CS1002`), and a syntax error leaves Roslyn without a parse tree — and completion needs a tree. Inside the initializer, a half-typed expression is only a _binding_ error, so the tree survives and `Ctrl+Space` keeps working.

**Consequences worth knowing:**

- A void call such as `Console.WriteLine(x)` shows a red squiggle, because void doesn't convert to `object`. It still evaluates correctly — `Ctrl+Enter` sends the raw text to the Debug Console, which never sees the wrapper
- While you are mid-expression the file won't compile, exactly as any half-typed C# wouldn't
- The file is deleted when debugging stops, and orphans are cleaned up at startup

### Expression Evaluation

When you press `Ctrl+Enter`, the expression between the markers is extracted and sent to the Debug Console using the `repl` evaluation context, which:

- Works inside lambda and closure scopes
- Has full access to captured variables
- Shows results immediately

## Keybinding Notes

Some shortcuts override VS Code defaults to provide a Visual Studio-like workflow:

| DebugSharp Shortcut                  | VS Code Default It Replaces |
| ------------------------------------ | --------------------------- |
| `Ctrl+Shift+B` (Quick Build)         | Run Build Task              |
| `Ctrl+Shift+T` (Quick Test)          | Reopen Closed Editor        |
| `Ctrl+Shift+K` (Quick Clean)         | Delete Line                 |
| `Ctrl+Shift+F5` (Launch Project)     | Debug: Restart              |
| `Ctrl+Shift+E` (Evaluate Expression) | Focus Explorer view         |

You can remap any of these in **File → Preferences → Keyboard Shortcuts**.

## Extension Settings

| Setting                            | Default | Description                                                                                                                                                                        |
| ---------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `debugSharp.suppressFrameworkLogs` | `true`  | Suppress debugger module load messages and duplicate log output in the debug console, showing only application logs (similar to Rider's default behavior).                         |
| `debugSharp.openBrowserOnLaunch`   | `true`  | Automatically open a browser when launching an ASP.NET web application.                                                                                                            |
| `debugSharp.testExplorer`          | `auto`  | Whether to show DebugSharp's Test Explorer. `auto` hides it when C# Dev Kit is installed, since Dev Kit provides its own; `always` and `never` override. Requires a window reload. |
| `debugSharp.skipUnchangedBuilds`   | `true`  | Skip `dotnet build` when the compiled output is already newer than every input. See [Skipping unchanged builds](#skipping-unchanged-builds).                                       |

## Known Issues

- Evaluating a **void** call (e.g. `Console.WriteLine(x)`) shows a red squiggle in the evaluation file. The evaluation itself works — see [Scaffold-Based IntelliSense](#scaffold-based-intellisense)
- All keyboard shortcuts are bound globally, not only in C# workspaces
- `Ctrl+Shift+T` (Quick Test) and the Test Explorer are separate implementations and report results differently
- C# Dev Kit is detected at activation, so installing or removing it needs a window reload

Please report issues at: [GitHub Issues](https://github.com/Ethaewyn/debugsharp/issues)

## License

[MIT](LICENSE)
