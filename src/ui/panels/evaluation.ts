/**
 * Evaluation Panel Module
 *
 * Provides C# expression evaluation with full IntelliSense support.
 * Uses a temporary .cs file to enable rich editing experience.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { evaluateExpression } from '../../debug/evaluator';
import { serializeObjectToJson } from '../../debug/serializer';
import { getCurrentFrameId } from '../../debug/dap';

// Module state
let currentPanel: vscode.WebviewPanel | undefined;
let currentSession: vscode.DebugSession | undefined;
let inputDocument: vscode.TextDocument | undefined;
let tempFilePath: string | undefined;
let debugSessionListener: vscode.Disposable | undefined;
let documentCloseListener: vscode.Disposable | undefined;
let evaluationTemplate: string | undefined;
let extensionContext: vscode.ExtensionContext | undefined;

export { currentPanel };

/**
 * Initialize the evaluation panel with extension context
 */
export function initializeEvaluationPanel(context: vscode.ExtensionContext): void {
  extensionContext = context;
}

/**
 * Clean up resources: temp file, listeners, and optionally the panel
 */
async function cleanup(closePanel: boolean = true): Promise<void> {
  // Close input document
  if (inputDocument) {
    const editor = vscode.window.visibleTextEditors.find(
      e => e.document.uri.toString() === inputDocument?.uri.toString(),
    );
    if (editor) {
      await vscode.window.showTextDocument(editor.document, editor.viewColumn);
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }
    inputDocument = undefined;
  }

  // Delete temp file with delay to ensure file handle is released
  if (tempFilePath && fs.existsSync(tempFilePath)) {
    setTimeout(() => {
      try {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
          tempFilePath = undefined;
        }
      } catch {
        // Fail silently - file may already be deleted
      }
    }, 100);
  }

  // Dispose listeners
  debugSessionListener?.dispose();
  debugSessionListener = undefined;
  documentCloseListener?.dispose();
  documentCloseListener = undefined;

  // Close panel if requested
  if (closePanel && currentPanel) {
    currentPanel.dispose();
    currentPanel = undefined;
  }

  currentSession = undefined;
}

/**
 * Show evaluation panel with C# editor for expression input
 *
 * Creates a temporary .cs file to provide full IntelliSense support,
 * then displays a webview panel for evaluation results.
 *
 * @param session - Active debug session
 * @param frameId - Current stack frame ID
 * @param initialExpression - Optional expression to pre-populate
 */
export async function showEvaluationPanel(
  session: vscode.DebugSession,
  frameId: number,
  initialExpression?: string,
): Promise<void> {
  currentSession = session;

  // Create temp .cs file for IntelliSense support
  if (!inputDocument) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder open');
      return;
    }

    const filePath = path.join(workspaceFolder.uri.fsPath, '.vscode-debug-eval.cs');

    // Clean up any orphaned temp file from previous session
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // Fail silently
      }
    }

    tempFilePath = filePath;
    const content =
      initialExpression ||
      "// Enter C# expression here\n// This file has access to all types in your project\n// Note: Ignore any red squiggles - they don't affect evaluation\n";

    fs.writeFileSync(filePath, content, 'utf8');

    const uri = vscode.Uri.file(filePath);
    inputDocument = await vscode.workspace.openTextDocument(uri);
  }

  await vscode.window.showTextDocument(inputDocument, {
    viewColumn: vscode.ViewColumn.One,
    preview: false,
  });

  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside);
    return;
  }

  currentPanel = vscode.window.createWebviewPanel(
    'evaluationPanel',
    'Expression Evaluator',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    },
  );

  currentPanel.webview.html = getEvaluationPanelHtml();

  currentPanel.webview.onDidReceiveMessage(async message => {
    switch (message.type) {
      case 'evaluate':
        const rawText = inputDocument?.getText() || '';

        const expression = rawText
          .split('\n')
          .map(line => line.replace(/\/\/.*$/, '').trim())
          .filter(line => line.length > 0)
          .join('\n')
          .trim();

        if (!expression) {
          currentPanel?.webview.postMessage({
            type: 'error',
            message: 'Please enter a valid C# expression in the editor',
          });
          return;
        }

        if (!currentSession) {
          currentPanel?.webview.postMessage({
            type: 'error',
            message: 'No active debug session',
          });
          return;
        }

        try {
          const currentFrameId = await getCurrentFrameId(currentSession);
          if (currentFrameId === null) {
            currentPanel?.webview.postMessage({
              type: 'error',
              message: 'Debugger is not paused',
            });
            return;
          }

          const result = await evaluateExpression(currentSession, currentFrameId, expression);
          if (result) {
            const isObject = result.variablesReference && result.variablesReference > 0;

            if (isObject) {
              const jsonObj = await serializeObjectToJson(
                currentSession,
                result.variablesReference!,
              );
              const jsonString = JSON.stringify(jsonObj, null, 2);
              currentPanel?.webview.postMessage({
                type: 'result',
                expression: expression,
                result: jsonString,
                resultType: result.type,
                isJson: true,
              });
            } else {
              currentPanel?.webview.postMessage({
                type: 'result',
                expression: expression,
                result: result.result,
                resultType: result.type,
                isJson: false,
              });
            }
          } else {
            currentPanel?.webview.postMessage({
              type: 'error',
              message: 'Failed to evaluate expression',
            });
          }
        } catch (error) {
          console.error('Error during evaluation:', error);
          currentPanel?.webview.postMessage({
            type: 'error',
            message: `Error: ${(error as Error).message}`,
          });
        }
        break;
    }
  }, undefined);

  if (!debugSessionListener) {
    debugSessionListener = vscode.debug.onDidTerminateDebugSession(terminatedSession => {
      if (terminatedSession === currentSession) {
        cleanup(false);
      }
    });
  }

  if (!documentCloseListener && inputDocument && tempFilePath) {
    const tempUri = inputDocument.uri.toString();
    documentCloseListener = vscode.workspace.onDidCloseTextDocument(closedDoc => {
      if (closedDoc.uri.toString() === tempUri) {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          setTimeout(() => {
            try {
              if (tempFilePath && fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
              }
            } catch (err) {
              console.error('Failed to delete temp file:', err);
            }
          }, 100);
        }
        if (documentCloseListener) {
          documentCloseListener.dispose();
          documentCloseListener = undefined;
        }
      }
    });
  }

  currentPanel.onDidDispose(() => {
    cleanup(true);
  });
}

/**
 * Load and cache the HTML template
 */
function getEvaluationTemplate(): string {
  if (!evaluationTemplate) {
    if (!extensionContext) {
      throw new Error('Evaluation panel not initialized. Call initializeEvaluationPanel() first.');
    }
    const templatePath = path.join(
      extensionContext.extensionPath,
      'out',
      'ui',
      'panels',
      'templates',
      'evaluation.html',
    );
    evaluationTemplate = fs.readFileSync(templatePath, 'utf8');
  }
  return evaluationTemplate;
}

/**
 * Generate HTML for the evaluation panel
 */
function getEvaluationPanelHtml(): string {
  return getEvaluationTemplate();
}
