/**
 * C# Debug Hints Extension
 *
 * Provides inline variable hints, object inspection, and expression evaluation
 * during C# debugging sessions in VS Code.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import { DebugPoller } from './debug/poller';
import { getCurrentFrameId } from './debug/dap';
import {
  showEvaluationPanel,
  currentPanel,
  initializeEvaluationPanel,
  createTempFile,
  deleteTempFile,
} from './ui/panels/evaluation';
import { showObjectJson, showObjectPickerForLine } from './ui/panels/objectViewer';
import { DebugInlayHintsProvider } from './ui/inlayHints/provider';
import { initializeWebview } from './ui/panels/webview';
import {
  quickLaunch,
  quickBuild,
  quickClean,
  quickRebuild,
  generateLaunchConfigurations,
} from './debug/launcher';
import { registerVariableCompletionProvider, updateDebugContext } from './ui/completionProvider';

/**
 * Clean up any orphaned .vscode-debug-eval.cs files from previous sessions
 */
async function cleanupOrphanedTempFiles(): Promise<void> {
  try {
    const tempFiles = await vscode.workspace.findFiles(
      '**/.vscode-debug-eval.cs',
      '**/node_modules/**',
    );
    for (const file of tempFiles) {
      try {
        fs.unlinkSync(file.fsPath);
      } catch {
        // File might be in use or already deleted
      }
    }
  } catch {
    // Workspace might not be ready
  }
}

/**
 * Send expression from eval file to Debug Console
 */
async function sendExpressionToDebugConsole(expression: string): Promise<void> {
  await vscode.commands.executeCommand('workbench.debug.action.focusRepl');
  await vscode.commands.executeCommand('type', { text: expression });
  await vscode.commands.executeCommand('workbench.action.debug.console.execute');

  // Add to history panel
  if (currentPanel) {
    currentPanel.webview.postMessage({
      type: 'result',
      expression: expression,
      result: 'Sent to Debug Console',
      resultType: 'history',
      isJson: false,
    });
  }
}

/**
 * Parse expression from text (removes comments and empty lines)
 */
function parseExpression(rawText: string): string {
  return rawText
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, '').trim())
    .filter(line => line.length > 0)
    .join('\n')
    .trim();
}

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Initialize webview modules with context
  initializeWebview(context);
  initializeEvaluationPanel(context);

  // Clean up any leftover temp files from previous sessions
  await cleanupOrphanedTempFiles();

  // Register variable completion provider for evaluation file
  registerVariableCompletionProvider(context);

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

      // Update completion provider with current debug context
      updateDebugContext(session, frameId);

      const editor = vscode.window.activeTextEditor;
      const selectedText = editor?.document.getText(editor.selection);
      await showEvaluationPanel(session, frameId, selectedText);
    },
  );

  // Command: Evaluate in already-open editor (keyboard shortcut - Ctrl+Enter)
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

      updateDebugContext(session, frameId);

      const editor = vscode.window.activeTextEditor;
      if (!editor || !editor.document.fileName.endsWith('.vscode-debug-eval.cs')) {
        vscode.window.showWarningMessage('No evaluation file is active');
        return;
      }

      const expression = parseExpression(editor.document.getText());
      if (!expression) {
        vscode.window.showWarningMessage('Please enter a valid C# expression');
        return;
      }

      try {
        await sendExpressionToDebugConsole(expression);
      } catch (error) {
        vscode.window.showErrorMessage(
          `Error sending to Debug Console: ${(error as Error).message}`,
        );
      }
    },
  );

  // Command: Quick launch
  const quickLaunchCommand = vscode.commands.registerCommand(
    'csharpDebugHints.quickLaunch',
    async () => {
      await quickLaunch();
    },
  );

  // Command: Quick build
  const quickBuildCommand = vscode.commands.registerCommand(
    'csharpDebugHints.quickBuild',
    async () => {
      await quickBuild();
    },
  );

  // Command: Quick clean
  const quickCleanCommand = vscode.commands.registerCommand(
    'csharpDebugHints.quickClean',
    async () => {
      await quickClean();
    },
  );

  // Command: Quick rebuild
  const quickRebuildCommand = vscode.commands.registerCommand(
    'csharpDebugHints.quickRebuild',
    async () => {
      await quickRebuild();
    },
  );

  // Command: Generate launch configurations
  const generateLaunchCommand = vscode.commands.registerCommand(
    'csharpDebugHints.generateLaunchConfigurations',
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
    vscode.debug.onDidStartDebugSession(async session => {
      poller.setSession(session);
      poller.startPolling();
      await createTempFile(session);
    }),
    vscode.debug.onDidTerminateDebugSession(() => {
      poller.setSession(undefined);
      poller.stopPolling();
      updateDebugContext(undefined, undefined);
      deleteTempFile();
    }),
  ];

  context.subscriptions.push(
    inlayHintsDisposable,
    showJsonCommand,
    viewObjectCommand,
    evaluateCommand,
    evaluateInEditorCommand,
    quickLaunchCommand,
    quickBuildCommand,
    quickCleanCommand,
    quickRebuildCommand,
    generateLaunchCommand,
    ...listeners,
  );
}

export function deactivate(): void {}
