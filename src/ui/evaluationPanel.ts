import * as vscode from 'vscode';
import { evaluateExpression, serializeObjectToJson } from '../services/debugService';
import { createJsonWebviewPanel } from './webview';
import { EvaluationResult } from '../models/debugModels';

/**
 * Show input dialog to evaluate an expression
 */
export async function promptForExpression(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: 'Enter an expression to evaluate',
    placeHolder: 'e.g., x + y, obj.Property, string.Concat(a, b)',
  });
}

/**
 * Show evaluation result in a webview panel
 */
export async function showEvaluationResult(
  expression: string,
  evalResult: EvaluationResult,
  session: vscode.DebugSession,
): Promise<void> {
  const isObject = evalResult.variablesReference && evalResult.variablesReference > 0;
  const typeInfo = evalResult.type ? `Type: ${evalResult.type}` : undefined;

  if (isObject) {
    try {
      const jsonObj = await serializeObjectToJson(session, evalResult.variablesReference!);
      const jsonString = JSON.stringify(jsonObj, null, 2);
      createJsonWebviewPanel(`Eval: ${expression}`, jsonString, typeInfo);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to serialize result: ${(error as Error).message}`);
    }
  } else {
    // For primitive values, just show the result
    vscode.window.showInformationMessage(`${expression} = ${evalResult.result}`);
  }
}

export { evaluateExpression } from '../services/debugService';
