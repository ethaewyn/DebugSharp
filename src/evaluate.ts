import * as vscode from 'vscode';
import { getVariablesForFrame } from './debugger';

/**
 * Evaluate an expression in the current debug context
 */
export async function evaluateExpression(
  session: vscode.DebugSession,
  frameId: number,
  expression: string,
): Promise<{ result: string; details?: string } | null> {
  try {
    const result = await session.customRequest('evaluate', {
      expression: expression,
      frameId: frameId,
      context: 'watch',
    });

    if (result && result.result) {
      return {
        result: result.result,
        details: result.variablesReference ? ` (type: ${result.type})` : undefined,
      };
    }
    if (result && result.error) {
      return {
        result: `Error: ${result.error}`,
      };
    }
    return null;
  } catch (error: any) {
    return {
      result: `Error: ${error?.message || 'Failed to evaluate expression'}`,
    };
  }
}

/**
 * Show quick pick dialog with evaluation result and options
 */
export async function showEvaluationResult(
  expression: string,
  evalResult: { result: string; details?: string },
) {
  const fullResult = evalResult.details
    ? `${evalResult.result}${evalResult.details}`
    : evalResult.result;

  const selected = await vscode.window.showQuickPick(
    [
      {
        label: fullResult,
        description: 'Result',
        picked: true,
      },
      {
        label: '$(copy) Copy Result',
        description: evalResult.result,
      },
    ],
    {
      title: `Evaluate: ${expression}`,
      canPickMany: false,
      ignoreFocusOut: true,
    },
  );

  if (selected?.label.includes('Copy')) {
    await vscode.env.clipboard.writeText(evalResult.result);
    vscode.window.showInformationMessage('Result copied to clipboard');
  }
}

/**
 * Show input dialog to evaluate an expression
 */
export async function promptForExpression(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: 'Enter an expression to evaluate',
    placeHolder: 'e.g., x + y, obj.Property, string.Concat(a, b)',
  });
}
