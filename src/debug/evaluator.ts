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
    const result = await session.customRequest('evaluate', {
      expression: expression,
      frameId: frameId,
      context: 'watch',
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
    return {
      result: `Error: ${error?.message || 'Failed to evaluate expression'}`,
    };
  }
}
