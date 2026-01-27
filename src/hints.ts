import * as vscode from 'vscode';
import { DebugVariables } from './debugger';
import { MAX_VALUE_LENGTH, VALUE_TRUNCATE_LENGTH } from './constants';

/**
 * Update inline hints for variables in the current editor
 */
export function updateInlineHints(
  editor: vscode.TextEditor,
  decorationType: vscode.TextEditorDecorationType,
  variables: DebugVariables,
) {
  const doc = editor.document;
  const decorations: vscode.DecorationOptions[] = [];

  if (!variables || Object.keys(variables).length === 0) {
    editor.setDecorations(decorationType, []);
    return;
  }

  // Iterate through document lines
  for (let lineNum = 0; lineNum < doc.lineCount; lineNum++) {
    const line = doc.lineAt(lineNum);
    const trimmed = line.text.trim();

    // Skip empty lines and comments
    if (trimmed.length === 0 || trimmed.startsWith('//')) {
      continue;
    }

    // Check if this is a declaration line and extract the variable being declared
    const declarationMatch =
      /(var|const|int|string|bool|double|float|decimal|List<?\w+>?|Dictionary<?\w+,\s*\w+>?)\s+(\w+)\s*=/.exec(
        line.text,
      );
    const declaredVarName = declarationMatch ? declarationMatch[2] : null;

    // Try to find any variable from our list on this line
    for (const varKey of Object.keys(variables)) {
      // Extract just the variable name (before the type info)
      // varKey looks like "a [int]" or "args [string[]]"
      const varName = varKey.split(' ')[0];

      // Use word boundary to match only whole words, not partial matches
      const wordBoundaryRegex = new RegExp(`\\b${varName}\\b`);

      // Check if variable appears on this line (with word boundaries)
      if (wordBoundaryRegex.test(line.text)) {
        // If this is a declaration line, prioritize showing the declared variable
        if (declaredVarName && varName !== declaredVarName) {
          continue; // Skip non-declared variables on declaration lines
        }

        const value = variables[varKey];
        const displayValue =
          value.length > MAX_VALUE_LENGTH
            ? value.substring(0, VALUE_TRUNCATE_LENGTH) + '...'
            : value;

        decorations.push({
          range: new vscode.Range(line.range.end, line.range.end),
          renderOptions: {
            after: {
              contentText: ` // ${varName} = ${displayValue}`,
            },
          },
        });
        break; // Only one hint per line
      }
    }
  }

  editor.setDecorations(decorationType, decorations);
}

/**
 * Clear all inline hints for the given editor
 */
export function clearHints(
  editor: vscode.TextEditor | undefined,
  decorationType: vscode.TextEditorDecorationType,
) {
  editor?.setDecorations(decorationType, []);
}
