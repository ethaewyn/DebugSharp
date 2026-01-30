/**
 * Evaluation Panel Module
 *
 * Provides C# expression evaluation with full IntelliSense support.
 * Uses a temporary .cs file to enable rich editing experience.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

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
 * Create the temp .cs file when debugging starts
 */
export async function createTempFile(session: vscode.DebugSession): Promise<void> {
  // Find the specific C# project being debugged
  let projectDir: string | undefined;

  // Get the debug configuration to find which project is being debugged
  const debugConfig = session.configuration;
  if (debugConfig?.program) {
    // Extract project directory from the program path (e.g., bin/Debug/net9.0/Project.dll)
    const programPath = debugConfig.program.replace(/\$\{workspaceFolder\}/g, '');
    const match = programPath.match(/^[\/\\]?([^\/\\]+)[\/\\]/);
    if (match) {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (workspaceFolder) {
        projectDir = path.join(workspaceFolder.uri.fsPath, match[1]);
      }
    }
  }

  // Fallback: Find any .csproj file
  if (!projectDir || !fs.existsSync(projectDir)) {
    const csprojFiles = await vscode.workspace.findFiles('**/*.csproj', '**/node_modules/**', 10);
    if (csprojFiles.length > 0) {
      projectDir = path.dirname(csprojFiles[0].fsPath);
    }
  }

  if (!projectDir) {
    return;
  }

  const filePath = path.join(projectDir, '.vscode-debug-eval.cs');

  // Clean up any orphaned temp file from previous session
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Fail silently
    }
  }

  tempFilePath = filePath;
  const content = '';
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Delete the temp .cs file when debugging stops
 */
export function deleteTempFile(): void {
  if (tempFilePath && fs.existsSync(tempFilePath)) {
    try {
      fs.unlinkSync(tempFilePath);
      tempFilePath = undefined;
    } catch {
      // Fail silently
    }
  }
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

  // Note: temp file is deleted when debug session terminates, not here

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

  // Open or update the temp .cs file
  if (!inputDocument && tempFilePath && fs.existsSync(tempFilePath)) {
    const uri = vscode.Uri.file(tempFilePath);
    inputDocument = await vscode.workspace.openTextDocument(uri);

    // Set initial expression if provided
    if (initialExpression) {
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        inputDocument.positionAt(0),
        inputDocument.positionAt(inputDocument.getText().length),
      );
      edit.replace(uri, fullRange, initialExpression);
      await vscode.workspace.applyEdit(edit);
    }
  } else if (!tempFilePath) {
    vscode.window.showErrorMessage('Debug session not active. Please start debugging first.');
    return;
  }

  if (!inputDocument) {
    vscode.window.showErrorMessage('Could not open evaluation file.');
    return;
  }

  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside, true);
  } else {
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

    currentPanel.onDidDispose(() => {
      cleanup(true);
    });

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

  // Show the text document with focus (after panel is created/revealed)
  await vscode.window.showTextDocument(inputDocument, {
    viewColumn: vscode.ViewColumn.One,
    preview: false,
    preserveFocus: false,
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
