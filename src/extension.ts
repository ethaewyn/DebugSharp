/**
 * C# Debug Hints Extension
 *
 * Provides inline variable hints, object inspection, and expression evaluation
 * during C# debugging sessions in VS Code.
 */
import * as vscode from 'vscode';
import { DebugPoller } from './debug/poller';
import { getCurrentFrameId } from './debug/dap';
import {
  showEvaluationPanel,
  currentPanel,
  initializeEvaluationPanel,
} from './ui/panels/evaluation';
import { showObjectJson, showObjectPickerForLine } from './ui/panels/objectViewer';
import { DebugInlayHintsProvider } from './ui/inlayHints/provider';
import { initializeWebview } from './ui/panels/webview';
import { quickLaunch, generateLaunchConfigurations } from './debug/launcher';

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext): void {
  // Initialize webview modules with context
  initializeWebview(context);
  initializeEvaluationPanel(context);

  const inlayHintsProvider = new DebugInlayHintsProvider();
  const poller = new DebugPoller(inlayHintsProvider);

  const inlayHintsDisposable = vscode.languages.registerInlayHintsProvider(
    { language: 'csharp', scheme: 'file' },
    inlayHintsProvider,
  );

  // Command: Show object as JSON (called from inlay hint click)
  const showJsonCommand = vscode.commands.registerCommand(
    'csharpDebugHints.showObjectJson',
    async (varName: string) => {
      await showObjectJson(varName);
    },
  );

  // Command: View object JSON (triggered manually)
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
      const session = vscode.debug.activeDebugSession;
      if (!session) {
        vscode.window.showWarningMessage('No active debug session');
        return;
      }

      const frameId = await getCurrentFrameId(session);
      if (frameId === null) {
        vscode.window.showWarningMessage('Debugger is not paused at a breakpoint');
        return;
      }

      const editor = vscode.window.activeTextEditor;
      const selectedText = editor?.document.getText(editor.selection);
      await showEvaluationPanel(session, frameId, selectedText);
    },
  );

  // Command: Evaluate in already-open editor (keyboard shortcut)
  const evaluateInEditorCommand = vscode.commands.registerCommand(
    'csharpDebugHints.evaluateInEditor',
    async () => {
      const session = vscode.debug.activeDebugSession;
      if (!session) {
        vscode.window.showWarningMessage('No active debug session');
        return;
      }

      const frameId = await getCurrentFrameId(session);
      if (frameId === null) {
        vscode.window.showWarningMessage('Debugger is not paused at a breakpoint');
        return;
      }

      if (currentPanel) {
        currentPanel.webview.postMessage({ type: 'triggerEvaluate' });
      } else {
        const editor = vscode.window.activeTextEditor;
        const selectedText = editor?.document.getText(editor.selection);
        await showEvaluationPanel(session, frameId, selectedText);
      }
    },
  );

  // Command: Quick launch project
  const quickLaunchCommand = vscode.commands.registerCommand(
    'csharpDebugHints.quickLaunch',
    async () => {
      await quickLaunch();
    },
  );

  // Command: Generate launch configurations
  const generateLaunchCommand = vscode.commands.registerCommand(
    'csharpDebugHints.generateLaunchConfig',
    async () => {
      await generateLaunchConfigurations();
    },
  );

  // Debug session lifecycle listeners
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
    // Handle stopped/continue events for web apps
    vscode.debug.onDidChangeBreakpoints(() => {
      const session = vscode.debug.activeDebugSession;
      if (session) {
        poller.setSession(session);
      }
    }),
  ];

  context.subscriptions.push(
    inlayHintsDisposable,
    showJsonCommand,
    viewObjectCommand,
    evaluateCommand,
    evaluateInEditorCommand,
    quickLaunchCommand,
    generateLaunchCommand,
    ...listeners,
  );
}

export function deactivate(): void {}
