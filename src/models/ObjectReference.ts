import * as vscode from 'vscode';

export interface ObjectReference {
  session: vscode.DebugSession;
  variablesReference: number;
}
