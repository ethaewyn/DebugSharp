/**
 * Completion Provider for Runtime Variables
 *
 * Provides IntelliSense for variables available in the current debug scope.
 * Types are handled by the C# extension via the .vscode-debug-eval.cs file.
 */
import * as vscode from 'vscode';

let debugSession: vscode.DebugSession | undefined;
let currentFrameId: number | undefined;

/**
 * Register the completion provider for the evaluation file
 */
export function registerVariableCompletionProvider(context: vscode.ExtensionContext): void {
  const provider = vscode.languages.registerCompletionItemProvider(
    { pattern: '**/.vscode-debug-eval.cs' },
    {
      async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
        if (!debugSession || currentFrameId === undefined) {
          return undefined;
        }

        const linePrefix = document.lineAt(position).text.slice(0, position.character);

        // Check if we're typing after a dot (member access)
        const dotMatch = linePrefix.match(/([\w]+)\.(\w*)$/);
        if (dotMatch) {
          // For member access, get runtime members but mark as incomplete
          // so C# extension can add its completions (including methods)
          const runtimeMembers = await getMemberCompletions(dotMatch[1]);
          return new vscode.CompletionList(runtimeMembers, true);
        }

        // Otherwise, provide variable completions
        return getVariableCompletions();
      },
    },
    '.', // Trigger on dot for member access
  );

  context.subscriptions.push(provider);
}

/**
 * Update the debug session and frame ID
 */
export function updateDebugContext(
  session: vscode.DebugSession | undefined,
  frameId: number | undefined,
): void {
  debugSession = session;
  currentFrameId = frameId;
}

/**
 * Get completions for variables in current scope
 */
async function getVariableCompletions(): Promise<vscode.CompletionItem[]> {
  if (!debugSession || currentFrameId === undefined) {
    return [];
  }

  try {
    const scopesResponse = await debugSession.customRequest('scopes', { frameId: currentFrameId });
    const items: vscode.CompletionItem[] = [];

    for (const scope of scopesResponse?.scopes || []) {
      if (scope.variablesReference > 0) {
        const varsResponse = await debugSession.customRequest('variables', {
          variablesReference: scope.variablesReference,
        });

        for (const variable of varsResponse?.variables || []) {
          // Skip internal variables
          if (variable.name.startsWith('$')) {
            continue;
          }

          const item = new vscode.CompletionItem(variable.name, vscode.CompletionItemKind.Variable);
          item.detail = variable.type || 'object';
          item.documentation = variable.value;
          items.push(item);
        }
      }
    }

    return items;
  } catch (error) {
    return [];
  }
}

/**
 * Get completions for members of an object
 */
async function getMemberCompletions(variableName: string): Promise<vscode.CompletionItem[]> {
  if (!debugSession || currentFrameId === undefined) {
    return [];
  }

  try {
    // Evaluate the variable to get its reference
    const evalResult = await debugSession.customRequest('evaluate', {
      expression: variableName,
      frameId: currentFrameId,
      context: 'watch',
    });

    if (!evalResult?.variablesReference || evalResult.variablesReference === 0) {
      return [];
    }

    // Get the members
    const varsResponse = await debugSession.customRequest('variables', {
      variablesReference: evalResult.variablesReference,
    });

    const items: vscode.CompletionItem[] = [];
    for (const variable of varsResponse?.variables || []) {
      const kind =
        variable.type?.includes('method') || variable.value?.includes('(')
          ? vscode.CompletionItemKind.Method
          : vscode.CompletionItemKind.Property;

      const item = new vscode.CompletionItem(variable.name, kind);
      item.detail = variable.type || '';
      item.documentation = variable.value;
      items.push(item);
    }

    return items;
  } catch (error) {
    return [];
  }
}
