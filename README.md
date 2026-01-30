# DebugSharp

Enhanced C# debugging experience with inline evaluation, IntelliSense-powered expression editing, and advanced debug features for Visual Studio Code.

## Features

- **Quick Launch** - Press `Ctrl+F5` to instantly debug any C# project in your workspace
- **Smart Debug Configuration** - Auto-detect projects, launch profiles, and generate configurations
- **IntelliSense Expression Evaluator**: Edit C# expressions with full IntelliSense (types + variables) and send to Debug Console
- **JSON Object Viewer**: View complex objects as formatted JSON in a dedicated panel
- **Expression History**: Track all evaluated expressions in a compact history panel
- **Seamless Lambda Support**: Automatically uses Debug Console context for lambda expressions

## Usage

### Quick Launch

The fastest way to debug any C# project:

1. Press `Ctrl+F5` (Mac: `Cmd+F5`) or run command "Quick Launch Project"
2. Select your project from the list
3. If the project has multiple launch profiles (like ASP.NET projects), choose one
4. Debugging starts automatically!

Works with:

- Console applications
- ASP.NET Core Web APIs and MVC apps (with launch profile detection)
- Class libraries with `<OutputType>Exe</OutputType>`
- Any runnable .NET project

### Evaluate Expressions with IntelliSense

**The best way to evaluate expressions during debugging:**

1. Start debugging your C# application
2. When stopped at a breakpoint, press **`Ctrl+E`** (Mac: `Cmd+E`) or right-click → "Evaluate Expression"
3. A C# file opens with **full IntelliSense**:
   - All your project types (classes, interfaces, enums)
   - All runtime variables from current scope
   - Member access with method suggestions
4. Type your expression (e.g., `myObject.MyMethod()`, `items.Where(x => x.Price > 10).ToList()`)
5. Press **`Ctrl+Enter`** (Mac: `Cmd+Enter`)
6. Expression is sent to Debug Console and automatically evaluated
7. View results in Debug Console, with history tracked in the side panel

**Why this is better:**

- ✅ Full IntelliSense for all types and variables
- ✅ Works perfectly in lambda scopes (ASP.NET minimal APIs, LINQ, etc.)
- ✅ See your command history
- ✅ No "cannot evaluate in lambda" errors
- ✅ Clean, focused workflow

### View Objects as JSON

1. While debugging, select a variable or expression
2. Right-click and select "View Object as JSON"
3. Explore the object structure in a formatted JSON viewer

### Generate Debug Configurations

Automatically create launch.json entries for all projects:

1. Run command "Generate Debug Configurations"
2. All runnable projects and their launch profiles are added to `.vscode/launch.json`
3. Use the Run and Debug panel to select and launch

## Keyboard Shortcuts

- **`Ctrl+E`** (Mac: `Cmd+E`) - Open evaluation panel with IntelliSense
- **`Ctrl+Enter`** (Mac: `Cmd+Enter`) - Send expression to Debug Console (when in eval file)
- **`Ctrl+F5`** (Mac: `Cmd+F5`) - Quick launch project

## Requirements

- Visual Studio Code 1.108.0 or higher
- .NET debugger (vsdbg) - comes with:
  - C# extension (ms-dotnettools.csharp) - **FREE and open source**, OR
  - C# Dev Kit (ms-dotnettools.csdevkit)

**Note:** This extension is completely **free and open-source compatible**. IntelliSense works in all project types by automatically creating a temporary evaluation file in your project folder.

## Commands

- `C# Debug Hints: Quick Launch Project` - **`Ctrl+F5`** - Instantly debug any project
- `C# Debug Hints: Generate Debug Configurations` - Auto-generate launch.json for all projects
- `C# Debug Hints: Evaluate Expression` - **`Ctrl+E`** - Open evaluation panel with IntelliSense
- `C# Debug Hints: View Object as JSON` - Display object as JSON

## How It Works

### IntelliSense + Debug Console Integration

DebugSharp creates a temporary `.vscode-debug-eval.cs` file in your project folder when debugging starts. This file:

- ✅ Gives you full IntelliSense from the C# language server
- ✅ Has access to all your project types
- ✅ Shows runtime variables via a custom completion provider
- ✅ Is automatically cleaned up when debugging stops

When you press `Ctrl+Enter`, the expression is sent directly to the Debug Console, which:

- ✅ Uses the `repl` context that works in lambda scopes
- ✅ Evaluates with full access to closure variables
- ✅ Shows results immediately

**This gives you the best of both worlds:** IntelliSense while editing + powerful evaluation at runtime.

## Extension Settings

This extension works out of the box with no additional configuration required.

## Known Issues

None currently. The lambda expression evaluation issue that affected previous versions has been completely solved by using the Debug Console context.

Please report issues at: [GitHub Issues](https://github.com/Ethaewyn/debugsharp/issues)

## License

[MIT](LICENSE)
