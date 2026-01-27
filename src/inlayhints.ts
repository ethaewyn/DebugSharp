import * as vscode from 'vscode';
import { DebugVariables } from './debugger';

// Store object references and current variables for inlay hints
export let currentVariables: DebugVariables = {};
export let currentSession: vscode.DebugSession | undefined;

// Store object references for JSON popup
export const objectReferences = new Map<
  string,
  { session: vscode.DebugSession; variablesReference: number }
>();

export function updateInlayHintData(variables: DebugVariables, session?: vscode.DebugSession) {
  currentVariables = variables;
  currentSession = session;

  // Update object references
  objectReferences.clear();
  if (session) {
    for (const varKey of Object.keys(variables)) {
      const varName = varKey.split(' ')[0];
      const varInfo = variables[varKey];
      if (varInfo.variablesReference && varInfo.variablesReference > 0) {
        objectReferences.set(varName, {
          session: session,
          variablesReference: varInfo.variablesReference,
        });
      }
    }
  }
}

export class DebugInlayHintsProvider implements vscode.InlayHintsProvider {
  private _onDidChangeInlayHints = new vscode.EventEmitter<void>();
  public readonly onDidChangeInlayHints = this._onDidChangeInlayHints.event;

  refresh() {
    this._onDidChangeInlayHints.fire();
  }

  provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.InlayHint[] | undefined {
    const hints: vscode.InlayHint[] = [];

    if (!currentVariables || Object.keys(currentVariables).length === 0) {
      return hints;
    }

    // Iterate through document lines in the range
    for (let lineNum = range.start.line; lineNum <= range.end.line; lineNum++) {
      if (lineNum >= document.lineCount) break;

      const line = document.lineAt(lineNum);
      const trimmed = line.text.trim();

      // Skip empty lines and comments
      if (trimmed.length === 0 || trimmed.startsWith('//')) {
        continue;
      }

      // Check if this is a declaration line
      const declarationMatch =
        /(var|const|int|string|bool|double|float|decimal|List<?\w+>?|Dictionary<?\w+,\s*\w+>?)\s+(\w+)\s*=/.exec(
          line.text,
        );
      const declaredVarName = declarationMatch ? declarationMatch[2] : null;

      // Collect all variables that appear on this line
      const varsOnLine: Array<{ name: string; value: string; isObject: boolean }> = [];

      for (const varKey of Object.keys(currentVariables)) {
        const varName = varKey.split(' ')[0];
        const wordBoundaryRegex = new RegExp(`\\b${varName}\\b`);

        if (wordBoundaryRegex.test(line.text)) {
          // If this is a declaration line, only show the declared variable
          if (declaredVarName && varName !== declaredVarName) {
            continue;
          }

          const varInfo = currentVariables[varKey];
          let displayValue = varInfo.value;
          let isObject = false;

          if (varInfo.variablesReference && varInfo.variablesReference > 0) {
            isObject = true;
            displayValue = `{Object}`;
          }

          const truncatedValue =
            displayValue.length > 100 ? displayValue.substring(0, 50) + '...' : displayValue;

          varsOnLine.push({ name: varName, value: truncatedValue, isObject });
        }
      }

      // Create inlay hints for variables on this line
      if (varsOnLine.length > 0) {
        const position = new vscode.Position(lineNum, line.range.end.character);

        // Create parts for the hint
        const parts: vscode.InlayHintLabelPart[] = [];

        varsOnLine.forEach((v, index) => {
          if (index > 0) {
            parts.push(new vscode.InlayHintLabelPart(', '));
          }

          if (v.isObject) {
            // Make the entire object hint clickable
            const clickablePart = new vscode.InlayHintLabelPart(`${v.name} = ${v.value} 🔍`);
            clickablePart.command = {
              title: 'View JSON',
              command: 'csharpDebugHints.showObjectJson',
              arguments: [v.name],
            };
            clickablePart.tooltip = `Click to view ${v.name} as JSON`;
            parts.push(clickablePart);
          } else {
            // Non-object variables are not clickable
            parts.push(new vscode.InlayHintLabelPart(`${v.name} = ${v.value}`));
          }
        });

        // Add the leading comment prefix
        const label = [new vscode.InlayHintLabelPart(' // '), ...parts];
        const hint = new vscode.InlayHint(position, label, vscode.InlayHintKind.Type);
        hints.push(hint);
      }
    }

    return hints;
  }
}
