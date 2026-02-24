/**
 * Completion Provider for Runtime Variables
 *
 * Provides IntelliSense for variables available in the current debug scope.
 * Works alongside the scaffold generator which gives Roslyn static type info.
 * This provider adds runtime values as documentation and handles dynamic member access.
 */
import * as vscode from 'vscode';
import { EXPR_START, EXPR_END } from '../debug/scaffoldGenerator';

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

        // Only provide completions within the expression markers
        const fullText = document.getText();
        const startIdx = fullText.indexOf(EXPR_START);
        const endIdx = fullText.lastIndexOf(EXPR_END);
        if (startIdx !== -1 && endIdx !== -1) {
          const startLine = document.positionAt(startIdx + EXPR_START.length).line;
          const endLine = document.positionAt(endIdx).line;
          if (position.line <= startLine || position.line >= endLine) {
            return undefined; // Outside expression area
          }
        }

        const linePrefix = document.lineAt(position).text.slice(0, position.character);

        // Check if we're typing after a dot (member access — possibly chained)
        const dotMatch = linePrefix.match(/([\w.]+)\.(\w*)$/);
        if (dotMatch) {
          // For member access, get runtime members and mark as incomplete
          // so C# extension (Roslyn) can merge its static completions
          const expression = dotMatch[1];
          const runtimeMembers = await getMemberCompletions(expression);
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
 * Get completions for members of an object (supports chained access like a.b.c.)
 */
async function getMemberCompletions(expression: string): Promise<vscode.CompletionItem[]> {
  if (!debugSession || currentFrameId === undefined) {
    return [];
  }

  try {
    // Evaluate the expression to get its reference (works for chained access)
    const evalResult = await debugSession.customRequest('evaluate', {
      expression: expression,
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
