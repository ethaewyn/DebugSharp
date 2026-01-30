import * as vscode from 'vscode';
import { EvaluationResult } from '../models/EvaluationResult';

/**
 * Evaluate an expression in the current debug context
 */
export async function evaluateExpression(
  session: vscode.DebugSession,
  frameId: number,
  expression: string,
): Promise<EvaluationResult | null> {
  try {
    // Always use 'repl' context (Debug Console) - it has broader scope access
    // and handles lambdas properly, unlike 'watch' context
    const result = await session.customRequest('evaluate', {
      expression: expression,
      frameId: frameId,
      context: 'repl',
    });

    if (result?.result) {
      return {
        result: result.result,
        type: result.type,
        variablesReference: result.variablesReference,
      };
    }

    if (result?.error) {
      return {
        result: `Error: ${result.error}`,
      };
    }

    return null;
  } catch (error: any) {
    console.error('[DebugSharp] Evaluation error details:', {
      message: error?.message,
      body: error?.body,
      error: error,
    });
    return {
      result: `Error: ${error?.body?.error?.message || error?.message || 'Failed to evaluate expression'}`,
    };
  }
}
