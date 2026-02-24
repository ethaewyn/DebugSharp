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
  updateEvalScaffold,
} from './ui/panels/evaluation';
import { showObjectJson, showObjectPickerForLine } from './ui/panels/objectViewer';
import { DebugInlayHintsProvider } from './ui/inlayHints/provider';
import { initializeWebview } from './ui/panels/webview';
import {
  quickLaunch,
  quickBuild,
  quickClean,
  quickRebuild,
  quickTest,
  generateLaunchConfigurations,
} from './debug/launcher';
import { registerVariableCompletionProvider, updateDebugContext } from './ui/completionProvider';
import { showNugetPackageManager, initializeNugetPanel } from './ui/panels/nugetManager';
import { initializeDiagnostics } from './debug/diagnostics';
import { extractUserExpression, isScaffoldFile } from './debug/scaffoldGenerator';
import {
  registerDebugTracker,
  getLastStoppedState,
  setLastStoppedFrameId,
  clearStoppedState,
} from './debug/debugTracker';

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
 * Parse expression from text (removes scaffold wrapper, comments, and empty lines)
 */
function parseExpression(rawText: string): string {
  // If the text is a scaffold file, extract just the user's expression
  const expressionText = isScaffoldFile(rawText) ? extractUserExpression(rawText) : rawText;

  return expressionText
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
  initializeNugetPanel(context);

  // Initialize build diagnostics
  initializeDiagnostics(context);

  // Clean up any leftover temp files from previous sessions
  await cleanupOrphanedTempFiles();

  // Register variable completion provider for evaluation file
  registerVariableCompletionProvider(context);

  const inlayHintsProvider = new DebugInlayHintsProvider();
  const poller = new DebugPoller(inlayHintsProvider);

  // Register a DAP tracker to reliably detect stopped state and update the scaffold.
  // This replaces the poller-based approach which suffered from stale frame IDs
  // (each stackTrace call allocates new IDs, invalidating variable references).
  const trackerDisposable = registerDebugTracker(async (session, threadId) => {
    const resolvedFrameId = await updateEvalScaffold(session, 0, threadId);
    if (resolvedFrameId !== undefined) {
      setLastStoppedFrameId(session, resolvedFrameId, threadId);
      updateDebugContext(session, resolvedFrameId);
    }
  });

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

      // Use the tracker's stored frameId (from the stopped event)
      // instead of calling getCurrentFrameId which does another stackTrace
      // and gets a stale frame on a potentially wrong thread.
      const stoppedState = getLastStoppedState();
      const frameId = stoppedState?.frameId ?? (await getCurrentFrameId(session));
      if (frameId === null || frameId === undefined) {
        vscode.window.showWarningMessage('Debugger is not paused');
        return;
      }

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

      const stoppedState = getLastStoppedState();
      const frameId = stoppedState?.frameId ?? (await getCurrentFrameId(session));
      if (frameId === null || frameId === undefined) {
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

  // Command: Quick test
  const quickTestCommand = vscode.commands.registerCommand(
    'csharpDebugHints.quickTest',
    async () => {
      await quickTest();
    },
  );

  // Command: Generate launch configurations
  const generateLaunchCommand = vscode.commands.registerCommand(
    'csharpDebugHints.generateLaunchConfigurations',
    async () => {
      await generateLaunchConfigurations();
    },
  );

  // Command: Manage NuGet packages
  const manageNugetCommand = vscode.commands.registerCommand(
    'csharpDebugHints.manageNugetPackages',
    async (uri: vscode.Uri) => {
      if (uri && uri.fsPath) {
        await showNugetPackageManager(uri.fsPath);
      } else {
        vscode.window.showErrorMessage('No .csproj file selected');
      }
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
      clearStoppedState();
      deleteTempFile();
    }),
  ];

  context.subscriptions.push(
    inlayHintsDisposable,
    trackerDisposable,
    showJsonCommand,
    viewObjectCommand,
    evaluateCommand,
    evaluateInEditorCommand,
    quickLaunchCommand,
    quickBuildCommand,
    quickCleanCommand,
    quickRebuildCommand,
    quickTestCommand,
    generateLaunchCommand,
    manageNugetCommand,
    ...listeners,
  );
}

export function deactivate(): void {}
