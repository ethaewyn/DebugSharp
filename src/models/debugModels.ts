import * as vscode from 'vscode';

/**
 * Information about a debug variable
 */
export interface VariableInfo {
  value: string;
  variablesReference?: number;
}

/**
 * Map of variable names to their information
 */
export interface DebugVariables {
  [key: string]: VariableInfo;
}

/**
 * Internal representation of a debug variable from DAP
 */
export interface DebugVariable {
  name: string;
  value: string;
  variablesReference?: number;
}

/**
 * Result of evaluating an expression
 */
export interface EvaluationResult {
  result: string;
  type?: string;
  variablesReference?: number;
}

/**
 * Reference to an object in the debug session
 */
export interface ObjectReference {
  session: vscode.DebugSession;
  variablesReference: number;
}
