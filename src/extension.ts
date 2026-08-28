/**
 * DebugSharp Extension
 *
 * Provides IntelliSense-powered expression evaluation, project management,
 * and test explorer integration for C# debugging in VS Code.
 */
import * as vscode from 'vscode';
import {
  openEvalFile,
  createEvalFile,
  deleteEvalFile,
  updateEvalScaffold,
  cleanupOrphanedEvalFiles,
} from './eval/evalFile';
import { quickLaunch, launchProject } from './launch/commands';
import { quickBuild, quickClean, quickRebuild, quickTest } from './build/actions';
import { generateLaunchConfigurations } from './launch/debugConfig';
import { registerVariableCompletionProvider, updateDebugContext } from './eval/completion';
import {
  addProjectReferenceCommand,
  removeProjectReferenceCommand,
} from './dependencies/projectReferences';
import { activateTestExplorer } from './testing/testController';
import { showNugetPackageManager, initializeNugetPanel } from './dependencies/nugetPanel';
import { initializeProjectIndex } from './shared/projectIndex';
import { initializeDiagnostics } from './build/problems';
import {
  extractUserExpression,
  isScaffoldFile,
  initializeScaffoldGenerator,
  EVAL_FILE_NAME,
} from './eval/scaffold';
import {
  registerDebugTracker,
  requireStoppedFrame,
  getFocusedStackFrame,
  setLastStoppedFrameId,
  clearStoppedState,
} from './eval/tracker';

/**
 * Send expression from eval file to Debug Console
 */
async function sendExpressionToDebugConsole(expression: string): Promise<void> {
  await vscode.commands.executeCommand('workbench.debug.action.focusRepl');
  await vscode.commands.executeCommand('type', { text: expression });
  await vscode.commands.executeCommand('workbench.action.debug.console.execute');
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

// ─── Command handlers ────────────────────────────────────────────────

/**
 * Open the evaluation file, seeded with the editor's selection if any.
 */
async function evaluateExpression(): Promise<void> {
  const stopped = requireStoppedFrame();
  if (!stopped) return;

  updateDebugContext(stopped.session, stopped.frameId);

  const editor = vscode.window.activeTextEditor;
  const selectedText = editor?.document.getText(editor.selection);
  await openEvalFile(stopped.session, selectedText);
}

/**
 * Send the open evaluation file's expression to the Debug Console.
 */
async function evaluateInEditor(): Promise<void> {
  const stopped = requireStoppedFrame();
  if (!stopped) return;

  updateDebugContext(stopped.session, stopped.frameId);

  const editor = vscode.window.activeTextEditor;
  if (!editor || !editor.document.fileName.endsWith(EVAL_FILE_NAME)) {
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
    vscode.window.showErrorMessage(`Error sending to Debug Console: ${(error as Error).message}`);
  }
}

/**
 * Wrap a handler that operates on a .csproj selected in the Explorer.
 */
function withCsproj(
  handler: (uri: vscode.Uri) => Promise<void>,
): (uri: vscode.Uri) => Promise<void> {
  return async (uri: vscode.Uri) => {
    if (!uri?.fsPath) {
      vscode.window.showErrorMessage('No .csproj file selected');
      return;
    }
    await handler(uri);
  };
}

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Initialize shared services
  initializeProjectIndex(context);
  initializeNugetPanel(context);
  initializeDiagnostics(context);
  initializeScaffoldGenerator(context);

  // Clean up any leftover temp files from previous sessions
  await cleanupOrphanedEvalFiles();

  // Register variable completion provider for evaluation file
  registerVariableCompletionProvider(context);

  /**
   * Rebuild the scaffold for a thread, optionally pinned to a specific frame.
   */
  const refreshScaffold = async (
    session: vscode.DebugSession,
    threadId: number,
    frameId?: number,
  ): Promise<void> => {
    const resolvedFrameId = await updateEvalScaffold(session, threadId, frameId);
    if (resolvedFrameId !== undefined) {
      setLastStoppedFrameId(session, resolvedFrameId, threadId);
      updateDebugContext(session, resolvedFrameId);
    }
  };

  // Register a DAP tracker to reliably detect stopped state and update the scaffold.
  const trackerDisposable = registerDebugTracker(async (session, threadId) => {
    // The stopped event arrives before the UI focuses a frame; if it already
    // has one (stepping), respect it.
    const focused = getFocusedStackFrame();
    await refreshScaffold(
      session,
      threadId,
      focused?.threadId === threadId ? focused.frameId : undefined,
    );
  });

  // Selecting a different frame in the Call Stack must re-describe that frame —
  // otherwise the scaffold shows one scope while the Debug Console evaluates
  // in another. This is also what makes stopping inside a lambda work.
  const stackItemListener = vscode.debug.onDidChangeActiveStackItem(async item => {
    if (!item || !('frameId' in item)) return;
    await refreshScaffold(item.session, item.threadId, item.frameId);
  });

  const commands: Record<string, (...args: any[]) => unknown> = {
    'debugSharp.evaluateExpression': evaluateExpression,
    'debugSharp.evaluateInEditor': evaluateInEditor,
    'debugSharp.quickLaunch': quickLaunch,
    'debugSharp.launchProject': launchProject,
    'debugSharp.quickBuild': quickBuild,
    'debugSharp.quickClean': quickClean,
    'debugSharp.quickRebuild': quickRebuild,
    'debugSharp.quickTest': quickTest,
    'debugSharp.generateLaunchConfigurations': generateLaunchConfigurations,
    'debugSharp.manageNugetPackages': withCsproj(uri => showNugetPackageManager(uri.fsPath)),
    'debugSharp.addProjectReference': withCsproj(addProjectReferenceCommand),
    'debugSharp.removeProjectReference': withCsproj(removeProjectReferenceCommand),
  };

  // Test explorer
  activateTestExplorer(context);

  context.subscriptions.push(
    trackerDisposable,
    stackItemListener,
    ...Object.entries(commands).map(([id, handler]) =>
      vscode.commands.registerCommand(id, handler),
    ),
    // Debug session lifecycle
    vscode.debug.onDidStartDebugSession(async session => {
      await createEvalFile(session);
    }),
    vscode.debug.onDidTerminateDebugSession(() => {
      updateDebugContext(undefined, undefined);
      clearStoppedState();
      deleteEvalFile();
    }),
  );
}

export function deactivate(): void {}
