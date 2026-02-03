# DebugSharp

Enhanced C# debugging experience with inline evaluation, IntelliSense-powered expression editing, and advanced debug features for Visual Studio Code.

## Features

### Project Management

- **Quick Launch** (`Ctrl+Shift+F5`) - Instantly debug any C# project with automatic building
- **Quick Build** (`Ctrl+Shift+B`) - Build any project or solution
- **Quick Clean** (`Ctrl+Shift+K`) - Clean build artifacts from projects or solutions
- **Quick Rebuild** (`Ctrl+Shift+R`) - Clean and rebuild projects or solutions
- **Quick Test** (`Ctrl+Shift+T`) - Run tests for test projects or solutions
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
3. Build runs and shows progress in terminal

**Quick Clean** - Clean build artifacts:

1. Press `Ctrl+Shift+K` (Mac: `Cmd+Shift+K`)
2. Select a project or solution (last used appears first)
3. Removes all build outputs (bin/obj folders)

**Quick Rebuild** - Clean and rebuild in one step:

1. Press `Ctrl+Shift+R` (Mac: `Cmd+Shift+R`)
2. Select a project or solution (last used appears first)
3. Cleans then builds in one terminal

**Quick Test** - Run tests:

1. Press `Ctrl+Shift+T` (Mac: `Cmd+Shift+T`)
2. Select a test project or solution (last used appears first)
3. Tests run and results show in terminal

**All commands support:**

- Individual .csproj files
- Solution (.sln) files
- Console applications
- ASP.NET Core Web APIs and MVC apps
- Test projects (xUnit, NUnit, MSTest)

**No tasks.json required!** Everything is handled automatically.

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
2. Press `Ctrl+E` (Mac: `Cmd+E`) or right-click → "Evaluate Expression"
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
| `Ctrl+E` (Mac: `Cmd+E`)               | Evaluate Expression   | Open evaluation panel (while debugging) |
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

- `C# Debug Hints: Evaluate Expression` - `Ctrl+E` - Open evaluation panel with IntelliSense
- `C# Debug Hints: View Object as JSON` - Display object as JSON

## How It Works

### IntelliSense + Debug Console Integration

DebugSharp creates a temporary `.vscode-debug-eval.cs` file in your project folder when debugging starts. This file:

- Gives you full IntelliSense from the C# language server
- Has access to all your project types
- Shows runtime variables via a custom completion provider
- Is automatically cleaned up when debugging stops

When you press `Ctrl+Enter`, the expression is sent directly to the Debug Console, which:

- Uses the `repl` context that works in lambda scopes
- Evaluates with full access to closure variables
- Shows results immediately

**This gives you the best of both worlds:** IntelliSense while editing + powerful evaluation at runtime.

## Extension Settings

This extension works out of the box with no additional configuration required.

## Known Issues

None currently. Please report issues at: [GitHub Issues](https://github.com/Ethaewyn/debugsharp/issues)

## License

[MIT](LICENSE)
