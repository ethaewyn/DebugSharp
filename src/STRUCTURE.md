# Project Structure

## Overview

C# Debug Hints extension providing inline variable hints, object inspection, and expression evaluation during debugging sessions.

## Directory Organization

```
src/
├── extension.ts              # Extension entry point and activation
├── config/                   # Configuration constants
│   └── constants.ts
├── debug/                    # Debug Adapter Protocol operations
│   ├── dap.ts               # DAP communication (frames, variables)
│   ├── evaluator.ts         # Expression evaluation
│   ├── serializer.ts        # Object-to-JSON serialization
│   └── poller.ts            # Variable polling service
├── models/                  # Type definitions
│   ├── DebugVariable.ts     # DAP variable representation
│   ├── DebugVariables.ts    # Variable collection type
│   ├── EvaluationResult.ts  # Expression evaluation result
│   ├── ObjectReference.ts   # Debug session object reference
│   └── VariableInfo.ts      # Variable metadata
└── ui/                      # User interface components
    ├── inlayHints/          # Inline hints provider
    │   └── provider.ts      # Inlay hints implementation
    └── panels/              # UI panels and webviews
        ├── evaluation.ts    # Expression evaluation panel
        ├── objectViewer.ts  # Object JSON viewer
        ├── webview.ts       # Webview utilities
        └── templates/       # HTML templates
            ├── evaluation.html  # Evaluation panel UI
            └── objectViewer.html # JSON viewer UI
```

## Module Responsibilities

### extension.ts

**Purpose**: Extension lifecycle and command registration.

- Initializes inlay hints provider and debug poller
- Registers all commands
- Manages debug session lifecycle listeners
- Subscribes all disposables

### config/

**Purpose**: Centralized configuration constants.

- `constants.ts`: Max depth, inline value lengths, etc.

### debug/

**Purpose**: Debug Adapter Protocol communication layer.

- **dap.ts**: Core DAP operations
  - Get current frame ID
  - Retrieve variables for frame
  - Fetch object properties
- **evaluator.ts**: Expression evaluation
  - Evaluates expressions in debug context
  - Returns results with type information
- **serializer.ts**: Object serialization
  - Recursively converts objects to JSON
  - Handles depth limits and filtering
- **poller.ts**: Variable polling service
  - Polls for variable changes during debugging
  - Updates inlay hints on changes

### models/

**Purpose**: Type definitions (one type per file).

- **DebugVariable.ts**: DAP variable structure
- **DebugVariables.ts**: Variable collection map
- **EvaluationResult.ts**: Expression result with metadata
- **ObjectReference.ts**: Debug session + variable reference
- **VariableInfo.ts**: Variable value and reference info

### ui/

**Purpose**: User interface components (inlay hints and panels).

#### ui/inlayHints/

- **provider.ts**: Inlay hints implementation
  - Manages current variables and debug session
  - Provides inline hints with clickable objects
  - Maintains object reference mappings

#### ui/panels/

- **evaluation.ts**: Expression evaluator panel
  - Creates temporary `.cs` file for full IntelliSense
  - Manages webview lifecycle and message handling
  - Handles cleanup of resources and temp files
- **objectViewer.ts**: Object inspection interface
  - Quick pick for multiple objects on a line
  - Serializes and displays objects as JSON
- **webview.ts**: Webview utilities
  - Template loading and caching
  - HTML generation with variable substitution
  - HTML escaping utilities
- **templates/**: HTML template files
  - `evaluation.html`: Expression evaluation UI
  - `objectViewer.html`: JSON viewer with syntax highlighting

## Code Organization Principles

1. **Feature-based structure**: Files grouped by feature, not technical role
2. **Single responsibility**: Each module has one clear purpose
3. **Exports first**: Public API before private helpers
4. **Type safety**: Dedicated type files with proper imports
5. **Template separation**: HTML/CSS/JS in separate files
6. **Comprehensive documentation**: JSDoc comments on all exports

## Key Patterns

- **Template caching**: HTML templates loaded once and reused
- **Resource cleanup**: Proper disposal of listeners and temp files
- **Error handling**: Graceful failures with user-friendly messages
- **Type safety**: Strong typing throughout the codebase

## Data Flow

1. **Debug Session Start** → `DebugPoller` starts polling
2. **Variables Retrieved** → `updateInlayHintData()` updates state
3. **Inlay Hints Refresh** → `DebugInlayHintsProvider` displays hints
4. **User Clicks Object** → `showObjectJson()` serializes and displays
5. **User Evaluates Expression** → `showEvaluationPanel()` opens editor with IntelliSense

## Best Practices

- All exported functions have JSDoc documentation
- Error handling uses proper Error type checking
- Optional chaining used for safe property access
- Resources properly disposed in cleanup functions
- HTML templates separated from TypeScript code
