# DebugSharp

Enhanced C# debugging experience with inline evaluation, JSON object viewing, and advanced debug hints for Visual Studio Code.

## Features

- **Inline Expression Evaluation**: Evaluate C# expressions directly from the editor while debugging
- **JSON Object Viewer**: View complex objects as formatted JSON in a dedicated panel
- **Quick Evaluation**: Use `Ctrl+Enter` (or `Cmd+Enter` on Mac) to quickly evaluate selected expressions
- **Context Menu Integration**: Right-click in the editor during debug sessions for quick access to evaluation features

## Usage

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
- C# debugging environment (e.g., C# Dev Kit or C# extension)
- .NET debugger configured for your project

## Commands

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
