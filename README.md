# DebugSharp

Enhanced C# debugging experience with inline evaluation, IntelliSense-powered expression editing, and advanced debug features for Visual Studio Code.

## Features

### Project Management

- **Quick Launch** (`Ctrl+Shift+F5`) - Instantly debug any C# project with automatic building
- **Quick Build** (`Ctrl+Shift+B`) - Build any project or solution with errors reported to Problems panel
- **Quick Clean** (`Ctrl+Shift+K`) - Clean build artifacts, clears Problems panel on success
- **Quick Rebuild** (`Ctrl+Shift+R`) - Clean and rebuild with automatic error detection
- **Quick Test** (`Ctrl+Shift+T`) - Run tests with failures shown in Problems panel
- **Problems Panel Integration** - All build, test errors appear with clickable file/line links
- **NuGet Package Manager** - Visual package management (right-click `.csproj`)
- **Smart project detection** - Remembers last used project for quick access

### Debugging Features

- **IntelliSense Expression Evaluator** - Edit C# expressions with full IntelliSense (types + variables)
- **JSON Object Viewer** - View complex objects as formatted JSON
- **Expression History** - Track all evaluated expressions in a compact history panel
- **Lambda Support** - Works in lambda scopes (ASP.NET minimal APIs, LINQ, etc.)
- **Auto Debug Configuration** - Generate launch.json for all projects

## Usage

### Quick Launch & Build Commands

**Quick Launch** - Build and debug any C# project:

1. Press `Ctrl+Shift+F5` (Mac: `Cmd+Shift+F5`) or run command "Quick Launch Project"
2. Select your project from the list (last used appears first)
3. For ASP.NET projects with multiple launch profiles, choose one
4. Project builds and debugging starts automatically

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

### Evaluate Expressions with IntelliSense

**During debugging:**

1. Stop at a breakpoint
2. Press `Ctrl+Shift+E` (Mac: `Cmd+Shift+E`) or right-click → "Evaluate Expression"
3. A C# file opens with **full IntelliSense**:
   - All project types (classes, interfaces, enums)
   - All runtime variables from current scope
   - Member access with method suggestions
4. Type your expression (e.g., `myObject.MyMethod()`, `items.Where(x => x.Price > 10).ToList()`)
5. Press `Ctrl+Enter` (Mac: `Cmd+Enter`)
6. Expression is sent to Debug Console and evaluated
7. View results in Debug Console with history tracked in the side panel

**Why this is better:**

- Full IntelliSense for all types and variables
- Works perfectly in lambda scopes
- Expression history tracking

### View Objects as JSON

**During debugging:**

1. Select a variable or expression
2. Right-click and select "View Object as JSON"
3. Explore the object structure in formatted JSON

### Generate Debug Configurations

**Automatically create launch.json entries:**

1. Run command "Generate Debug Configurations"
2. All runnable projects and launch profiles are added to `.vscode/launch.json`
3. Use Run and Debug panel to select and launch

## Keyboard Shortcuts

| Shortcut                              | Command               | Description                             |
| ------------------------------------- | --------------------- | --------------------------------------- |
| `Ctrl+Shift+F5` (Mac: `Cmd+Shift+F5`) | Quick Launch          | Build and debug project                 |
| `Ctrl+Shift+B` (Mac: `Cmd+Shift+B`)   | Quick Build           | Build project or solution               |
| `Ctrl+Shift+K` (Mac: `Cmd+Shift+K`)   | Quick Clean           | Clean build artifacts                   |
| `Ctrl+Shift+R` (Mac: `Cmd+Shift+R`)   | Quick Rebuild         | Clean and rebuild                       |
| `Ctrl+Shift+T` (Mac: `Cmd+Shift+T`)   | Quick Test            | Run tests                               |
| `Ctrl+Shift+E` (Mac: `Cmd+Shift+E`)   | Evaluate Expression   | Open evaluation panel (while debugging) |
| `Ctrl+Enter` (Mac: `Cmd+Enter`)       | Send to Debug Console | Evaluate expression (in eval file)      |

## Requirements

- Visual Studio Code 1.108.0 or higher
- .NET SDK installed
- C# debugger (vsdbg) - comes with:
  - C# extension (ms-dotnettools.csharp) - **FREE and open source**, OR
  - C# Dev Kit (ms-dotnettools.csdevkit)

**Note:** This extension is completely **free and open-source compatible**. IntelliSense works in all project types by automatically creating a temporary evaluation file in your project folder.

## Commands

### Project Management

- `C# Debug Hints: Quick Launch Project` - `Ctrl+Shift+F5` - Instantly debug any project
- `C# Debug Hints: Quick Build Project` - `Ctrl+Shift+B` - Build project or solution
- `C# Debug Hints: Quick Clean Project` - `Ctrl+Shift+K` - Clean project or solution
- `C# Debug Hints: Quick Rebuild Project` - `Ctrl+Shift+R` - Clean and rebuild
- `C# Debug Hints: Quick Test Project` - `Ctrl+Shift+T` - Run tests
- `C# Debug Hints: Generate Debug Configurations` - Auto-generate launch.json
- `C# Debug Hints: Manage NuGet Packages` - Visual NuGet package management

### Debugging

- `C# Debug Hints: Evaluate Expression` - `Ctrl+Shift+E` - Open evaluation panel with IntelliSense
- `C# Debug Hints: View Object as JSON` - Display object as JSON

## How It Works

### Scaffold-Based IntelliSense

DebugSharp creates a temporary `.vscode-debug-eval.cs` file in your project folder when you open the evaluation panel. This file contains a **C# scaffold** — a generated class with typed variable declarations matching your current debug scope:

```csharp
// Auto-generated — do not edit above this line
#pragma warning disable
#nullable disable

using MyApp.Models;  // from your source file

class _ { void _() {
    List<WeatherForecast> forecast = default!;
    string[] summaries = default!;

    // ── YOUR EXPRESSION (edit below) ──
    forecast.Where(f => f.TemperatureC > 20).ToList()
    // ── END EXPRESSION ──
}}
```

**How the scaffold is built:**

1. A `DebugAdapterTracker` intercepts DAP `stopped` events to know exactly when and on which thread the debugger pauses
2. An atomic `stackTrace` → `scopes` → `variables` call chain retrieves all local variables and their **runtime types** (not source-level `var`)
3. The scaffold generator sanitizes type names (generics, arrays, nullable, anonymous types → `dynamic`) and writes typed declarations
4. Source-file `using` statements are included; project-level `global using` directives are already project-wide
5. Roslyn then provides full IntelliSense: member access, LINQ, lambdas, method signatures — everything works

**Why this approach:**

- Full IntelliSense for all project types **and** runtime variables
- Works perfectly inside lambda scopes (ASP.NET minimal APIs, LINQ callbacks, etc.)
- Supports chained member access (`list.Where(x => ...)`)
- No extra configuration — the file is cleaned up when debugging stops

### Expression Evaluation

When you press `Ctrl+Enter`, the expression between the markers is extracted and sent to the Debug Console using the `repl` evaluation context, which:

- Works inside lambda and closure scopes
- Has full access to captured variables
- Shows results immediately

## Extension Settings

This extension works out of the box with no additional configuration required.

## Known Issues

None currently. Please report issues at: [GitHub Issues](https://github.com/Ethaewyn/debugsharp/issues)

## License

[MIT](LICENSE)
