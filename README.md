# DebugSharp

Enhanced C# debugging experience with inline evaluation, JSON object viewing, and advanced debug hints for Visual Studio Code.

## Features

- **Quick Launch** - Press `Ctrl+F5` to instantly debug any C# project in your workspace
- **Smart Debug Configuration** - Auto-detect projects, launch profiles, and generate configurations
- **Multi-Profile Support** - Automatically detects ASP.NET launch profiles (IIS Express, Kestrel, etc.)
- **Inline Expression Evaluation**: Evaluate C# expressions directly from the editor while debugging
- **JSON Object Viewer**: View complex objects as formatted JSON in a dedicated panel
- **Quick Evaluation**: Use `Ctrl+Enter` (or `Cmd+Enter` on Mac) to quickly evaluate selected expressions
- **Context Menu Integration**: Right-click in the editor during debug sessions for quick access to evaluation features

## Usage

### Quick Launch (New!)

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

### Generate Debug Configurations

Automatically create launch.json entries for all projects:

1. Run command "Generate Debug Configurations"
2. All runnable projects and their launch profiles are added to `.vscode/launch.json`
3. Use the Run and Debug panel to select and launch

### Evaluate Expressions

1. Start debugging your C# application
2. When stopped at a breakpoint, select any expression in the editor
3. Right-click and select "Evaluate Expression" or press `Ctrl+Enter` (Mac: `Cmd+Enter`)
4. View the result in the evaluation panel

### View Objects as JSON

1. While debugging, select a variable or expression
2. Right-click and select "View Object as JSON"
3. Explore the object structure in a formatted JSON viewer

## Requirements

- Visual Studio Code 1.85.0 or higher
- .NET debugger (vsdbg) - comes with:
  - C# extension (ms-dotnettools.csharp) - **FREE and open source**, OR
  - C# Dev Kit (ms-dotnettools.csdevkit)

**Note:** This extension works with **any .NET debugger** and is completely **free and open-source compatible**. IntelliSense works in all project types (SDK-style, legacy .csproj, or any C# project) by automatically creating a minimal project context.

## Commands

- `C# Debug Hints: Quick Launch Project` - **`Ctrl+F5`** - Instantly debug any project in your workspace
- `C# Debug Hints: Generate Debug Configurations` - Auto-generate launch.json for all projects
- `C# Debug Hints: Evaluate Expression` - Evaluate the selected expression
- `C# Debug Hints: Evaluate Expression from Editor` - Quick evaluate with keyboard shortcut
- `C# Debug Hints: View Object as JSON` - Display object as JSON

## Extension Settings

This extension works out of the box with no additional configuration required.

## Known Issues

Please report issues at: [GitHub Issues](https://github.com/YOUR-USERNAME/debugsharp/issues)

## Release Notes

### 1.0.0

Initial release of DebugSharp

- Expression evaluation during debug sessions
- JSON object viewer
- Keyboard shortcuts for quick evaluation
- Context menu integration

## License

[MIT](LICENSE)
