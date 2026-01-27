import * as vscode from 'vscode';
import { DebugPoller } from './polling';
import { DECORATION_CONFIG } from './constants';
import { evaluateExpression, showEvaluationResult, promptForExpression } from './evaluate';
import { getCurrentFrameId } from './debugger';

export function activate(context: vscode.ExtensionContext) {
  // Create decoration type for inline hints
  const decorationType = vscode.window.createTextEditorDecorationType(DECORATION_CONFIG);

  // Initialize debug poller
  const poller = new DebugPoller(decorationType);

  // Register evaluate command
  const evaluateCommand = vscode.commands.registerCommand(
    'csharpDebugHints.evaluateExpression',
    async () => {
      const session = poller.getSession();
      if (!session) {
        vscode.window.showWarningMessage('No active debug session');
        return;
      }

      const frameId = await getCurrentFrameId(session);
      if (frameId === null) {
        vscode.window.showWarningMessage('Debugger is not paused');
        return;
      }

      // Try to get selected text from editor
      const editor = vscode.window.activeTextEditor;
      let expression = editor?.document.getText(editor.selection);

      // If no selection, prompt user
      if (!expression) {
        expression = await promptForExpression();
        if (!expression) {
          return;
        }
      }

      // Evaluate the expression
      const result = await evaluateExpression(session, frameId, expression);
      if (result) {
        await showEvaluationResult(expression, result);
      } else {
        vscode.window.showWarningMessage('Failed to evaluate expression');
      }
    },
  );

  // Register debug session event listeners
  const listeners = [
    vscode.debug.onDidChangeActiveDebugSession(session => {
      poller.setSession(session);
      if (session) {
        poller.startPolling();
      } else {
        poller.stopPolling();
      }
    }),
    vscode.debug.onDidStartDebugSession(session => {
      poller.setSession(session);
      poller.startPolling();
    }),
    vscode.debug.onDidTerminateDebugSession(session => {
      poller.setSession(undefined);
      poller.stopPolling();
    }),
  ];

  context.subscriptions.push(decorationType, evaluateCommand, ...listeners);
}

export function deactivate() {}
