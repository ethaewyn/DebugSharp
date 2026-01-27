import * as vscode from 'vscode';
import { DebugPoller, getCurrentFrameId } from './services';
import { showEvaluationPanel, showObjectJson, showObjectPickerForLine, currentPanel } from './ui';
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

      // Get expression from selection (if any)
      const editor = vscode.window.activeTextEditor;
      const selectedText = editor?.document.getText(editor.selection);

      // Show evaluation panel with optional pre-filled expression
      await showEvaluationPanel(session, frameId, selectedText);
    },
  );

  // Command: Evaluate expression in editor
  const evaluateInEditorCommand = vscode.commands.registerCommand(
    'csharpDebugHints.evaluateInEditor',
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

      // Trigger evaluation - the panel will read from the current input document
      if (currentPanel) {
        currentPanel.webview.postMessage({ type: 'triggerEvaluate' });
      } else {
        // If no panel exists, create it
        const editor = vscode.window.activeTextEditor;
        const selectedText = editor?.document.getText(editor.selection);
        await showEvaluationPanel(session, frameId, selectedText);
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
    evaluateInEditorCommand,
    ...listeners,
  );
}

export function deactivate(): void {}
