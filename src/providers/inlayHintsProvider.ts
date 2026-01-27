import * as vscode from 'vscode';
import { DebugVariables, ObjectReference } from '../models/debugModels';
import { MAX_INLINE_VALUE_LENGTH } from '../config/constants';

// Store object references for JSON popup
export const objectReferences = new Map<string, ObjectReference>();

// Current debug state
let currentVariables: DebugVariables = {};
let currentSession: vscode.DebugSession | undefined;

/**
 * Update inlay hint data with current debug state
 */
export function updateInlayHintData(
  variables: DebugVariables,
  session?: vscode.DebugSession,
): void {
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

/**
 * Check if a line should be skipped for hints
 */
function shouldSkipLine(lineText: string): boolean {
  const trimmed = lineText.trim();
  return trimmed.length === 0 || trimmed.startsWith('//');
}

/**
 * Extract declared variable name from a line
 */
function getDeclaraionVarName(lineText: string): string | null {
  const declarationMatch =
    /(var|const|int|string|bool|double|float|decimal|List<?\w+>?|Dictionary<?\w+,\s*\w+>?)\s+(\w+)\s*=/.exec(
      lineText,
    );
  return declarationMatch ? declarationMatch[2] : null;
}

/**
 * Format variable value for display
 */
function formatVariableValue(varInfo: { value: string; variablesReference?: number }): {
  displayValue: string;
  isObject: boolean;
} {
  if (varInfo.variablesReference && varInfo.variablesReference > 0) {
    return { displayValue: '{Object}', isObject: true };
  }

  const value = varInfo.value;
  const displayValue =
    value.length > MAX_INLINE_VALUE_LENGTH ? value.substring(0, 50) + '...' : value;
  return { displayValue, isObject: false };
}

/**
 * Provides inline hints for debug variables
 */
export class DebugInlayHintsProvider implements vscode.InlayHintsProvider {
  private _onDidChangeInlayHints = new vscode.EventEmitter<void>();
  public readonly onDidChangeInlayHints = this._onDidChangeInlayHints.event;

  refresh(): void {
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

    for (let lineNum = range.start.line; lineNum <= range.end.line; lineNum++) {
      if (lineNum >= document.lineCount) break;

      const line = document.lineAt(lineNum);

      if (shouldSkipLine(line.text)) {
        continue;
      }

      const declaredVarName = getDeclaraionVarName(line.text);
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
          const { displayValue, isObject } = formatVariableValue(varInfo);

          varsOnLine.push({ name: varName, value: displayValue, isObject });
        }
      }

      if (varsOnLine.length > 0) {
        const hint = this.createInlayHint(varsOnLine, lineNum, line.range.end.character);
        hints.push(hint);
      }
    }

    return hints;
  }

  private createInlayHint(
    vars: Array<{ name: string; value: string; isObject: boolean }>,
    lineNum: number,
    endChar: number,
  ): vscode.InlayHint {
    const position = new vscode.Position(lineNum, endChar);
    const parts: vscode.InlayHintLabelPart[] = [];

    vars.forEach((v, index) => {
      if (index > 0) {
        parts.push(new vscode.InlayHintLabelPart(', '));
      }

      if (v.isObject) {
        const clickablePart = new vscode.InlayHintLabelPart(`${v.name} = ${v.value} 🔍`);
        clickablePart.command = {
          title: 'View JSON',
          command: 'csharpDebugHints.showObjectJson',
          arguments: [v.name],
        };
        clickablePart.tooltip = `Click to view ${v.name} as JSON`;
        parts.push(clickablePart);
      } else {
        parts.push(new vscode.InlayHintLabelPart(`${v.name} = ${v.value}`));
      }
    });

    const label = [new vscode.InlayHintLabelPart(' // '), ...parts];
    return new vscode.InlayHint(position, label, vscode.InlayHintKind.Type);
  }
}
