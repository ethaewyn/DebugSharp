import * as vscode from 'vscode';
import { DebugPoller } from './polling';
import { evaluateExpression, showEvaluationResult, promptForExpression } from './evaluate';
import { getCurrentFrameId } from './debugger';
import { showObjectJson, showObjectPickerForLine } from './hints';
import { DebugInlayHintsProvider } from './inlayhints';

export function activate(context: vscode.ExtensionContext) {
  // Register inlay hints provider
  const inlayHintsProvider = new DebugInlayHintsProvider();
  const inlayHintsDisposable = vscode.languages.registerInlayHintsProvider(
    { language: 'csharp', scheme: 'file' },
    inlayHintsProvider,
  );

  // Initialize debug poller
  const poller = new DebugPoller(inlayHintsProvider);

  // Register show object JSON command
  const showJsonCommand = vscode.commands.registerCommand(
    'csharpDebugHints.showObjectJson',
    async (varName: string) => {
      await showObjectJson(varName);
    },
  );

  // Register view object picker command
  const viewObjectCommand = vscode.commands.registerCommand(
    'csharpDebugHints.viewObjectJson',
    async () => {
      await showObjectPickerForLine();
    },
  );

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

  context.subscriptions.push(
    inlayHintsDisposable,
    showJsonCommand,
    viewObjectCommand,
    evaluateCommand,
    ...listeners,
  );
}

export function deactivate() {}
