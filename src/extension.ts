import * as vscode from 'vscode';
import { DebugPoller, getCurrentFrameId } from './services';
import {
  evaluateExpression,
  showEvaluationResult,
  promptForExpression,
  showObjectJson,
  showObjectPickerForLine,
} from './ui';
import { DebugInlayHintsProvider } from './providers';

/**
 * Activate the C# Debug Hints extension
 */
export function activate(context: vscode.ExtensionContext): void {
  const inlayHintsProvider = new DebugInlayHintsProvider();
  const poller = new DebugPoller(inlayHintsProvider);

  // Register inlay hints provider for C# files
  const inlayHintsDisposable = vscode.languages.registerInlayHintsProvider(
    { language: 'csharp', scheme: 'file' },
    inlayHintsProvider,
  );

  // Command: Show object as JSON
  const showJsonCommand = vscode.commands.registerCommand(
    'csharpDebugHints.showObjectJson',
    async (varName: string) => {
      await showObjectJson(varName);
    },
  );

  // Command: View object picker
  const viewObjectCommand = vscode.commands.registerCommand(
    'csharpDebugHints.viewObjectJson',
    async () => {
      await showObjectPickerForLine();
    },
  );

  // Command: Evaluate expression
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

      // Get expression from selection or prompt user
      const editor = vscode.window.activeTextEditor;
      let expression = editor?.document.getText(editor.selection);

      if (!expression) {
        expression = await promptForExpression();
        if (!expression) {
          return;
        }
      }

      // Evaluate and show result
      const result = await evaluateExpression(session, frameId, expression);
      if (result) {
        await showEvaluationResult(expression, result, session);
      } else {
        vscode.window.showWarningMessage('Failed to evaluate expression');
      }
    },
  );

  // Debug session event listeners
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
    vscode.debug.onDidTerminateDebugSession(() => {
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

export function deactivate(): void {}
