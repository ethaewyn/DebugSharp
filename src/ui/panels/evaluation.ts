/**
 * Evaluation Panel Module
 *
 * Provides C# expression evaluation with full IntelliSense support.
 * Uses a temporary .cs file to enable rich editing experience.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  generateScaffold,
  getScopeVariables,
  getSourceFileUsings,
  getFrameAndVariables,
  extractUserExpression,
  isScaffoldFile,
  EXPR_START,
  EXPR_END,
  ScopeVariable,
} from '../../debug/scaffoldGenerator';

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
 * Get the temp file path for external access
 */
export function getTempFilePath(): string | undefined {
  return tempFilePath;
}

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

  // Write an initial scaffold with no variables (debugger hasn't stopped yet)
  const initialScaffold = generateScaffold([], [], '');
  fs.writeFileSync(filePath, initialScaffold, 'utf8');
}

/**
 * Update the scaffold in the eval file with current debug scope variables.
 * Preserves the user's expression between the expression markers.
 *
 * When threadId is provided, uses the atomic getFrameAndVariables() which
 * does a single stackTrace call — avoiding stale reference issues.
 * Returns the frameId that was used (useful for callers that need it).
 */
export async function updateEvalScaffold(
  session: vscode.DebugSession,
  frameId: number,
  threadId?: number,
): Promise<number | undefined> {
  if (!tempFilePath) return undefined;

  // Ensure file exists
  if (!fs.existsSync(tempFilePath)) return undefined;

  try {
    const projectDir = path.dirname(tempFilePath);
    let variables: ScopeVariable[];
    let sourceUsings: string[];
    let resolvedFrameId = frameId;

    if (threadId !== undefined) {
      // Use the atomic path: single stackTrace → scopes → variables
      const result = await getFrameAndVariables(session, threadId);
      if (!result) return undefined;

      resolvedFrameId = result.frameId;
      variables = result.variables;
      sourceUsings = await getSourceFileUsings(session, resolvedFrameId, result.sourcePath);
    } else {
      // Fallback: use provided frameId directly
      const [vars, usings] = await Promise.all([
        getScopeVariables(session, frameId),
        getSourceFileUsings(session, frameId),
      ]);
      variables = vars;
      sourceUsings = usings;
    }

    // Only source-file usings — global usings are already project-wide
    const allUsings = sourceUsings;

    // Read current content — prefer open document over disk
    const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === tempFilePath);
    const currentContent = doc ? doc.getText() : fs.readFileSync(tempFilePath, 'utf8');

    // Preserve user's expression
    const userExpression = isScaffoldFile(currentContent)
      ? extractUserExpression(currentContent)
      : currentContent.trim();

    // Generate new scaffold
    const newContent = generateScaffold(variables, allUsings, userExpression || '');

    // Skip if nothing changed
    if (newContent === currentContent) return resolvedFrameId;

    if (doc) {
      // Document is open — use WorkspaceEdit for atomic in-memory update
      // Only replace the scaffold header portion (above expression start marker)
      // to avoid disrupting the user's cursor position in the expression area
      const currentStartIdx = currentContent.indexOf(EXPR_START);
      const newStartIdx = newContent.indexOf(EXPR_START);

      if (currentStartIdx !== -1 && newStartIdx !== -1) {
        // Only replace the header (everything before the start marker)
        const edit = new vscode.WorkspaceEdit();
        const headerRange = new vscode.Range(doc.positionAt(0), doc.positionAt(currentStartIdx));
        edit.replace(doc.uri, headerRange, newContent.substring(0, newStartIdx));
        await vscode.workspace.applyEdit(edit);
      } else {
        // Full replacement (first time or file was corrupted)
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          doc.positionAt(0),
          doc.positionAt(currentContent.length),
        );
        edit.replace(doc.uri, fullRange, newContent);
        await vscode.workspace.applyEdit(edit);
      }
    } else {
      // File not open as document — write to disk
      fs.writeFileSync(tempFilePath, newContent, 'utf8');
    }

    return resolvedFrameId;
  } catch (error) {
    console.error('[DebugSharp] Error updating scaffold:', error);
    return undefined;
  }
}

/**
 * Get the user's expression from the eval file, stripping the scaffold
 */
export function getEvalExpression(): string | undefined {
  if (!tempFilePath) return undefined;

  const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === tempFilePath);
  const content = doc
    ? doc.getText()
    : fs.existsSync(tempFilePath)
      ? fs.readFileSync(tempFilePath, 'utf8')
      : undefined;

  if (!content) return undefined;

  if (isScaffoldFile(content)) {
    return extractUserExpression(content);
  }
  return content.trim();
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

  // Note: scaffold is updated by the DebugAdapterTracker on stopped events.
  // Do NOT call updateEvalScaffold here — it would do a new stackTrace call
  // that allocates stale frame IDs, overwriting the good scaffold.

  // Open or update the temp .cs file
  if (!inputDocument && tempFilePath && fs.existsSync(tempFilePath)) {
    const uri = vscode.Uri.file(tempFilePath);
    inputDocument = await vscode.workspace.openTextDocument(uri);

    // If initial expression provided, inject it into the scaffold's expression area
    if (initialExpression) {
      const content = inputDocument.getText();
      const startIdx = content.indexOf(EXPR_START);
      const endIdx = content.lastIndexOf(EXPR_END);

      if (startIdx !== -1 && endIdx !== -1) {
        const edit = new vscode.WorkspaceEdit();
        const afterStartLine = content.indexOf('\n', startIdx);
        if (afterStartLine !== -1 && afterStartLine < endIdx) {
          const replaceRange = new vscode.Range(
            inputDocument.positionAt(afterStartLine + 1),
            inputDocument.positionAt(endIdx),
          );
          edit.replace(uri, replaceRange, `        ${initialExpression}\n        `);
          await vscode.workspace.applyEdit(edit);
        }
      } else {
        // Fallback: replace entire content
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          inputDocument.positionAt(0),
          inputDocument.positionAt(content.length),
        );
        edit.replace(uri, fullRange, initialExpression);
        await vscode.workspace.applyEdit(edit);
      }
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
  }

  // Show the text document with focus (after panel is created/revealed)
  const editor = await vscode.window.showTextDocument(inputDocument, {
    viewColumn: vscode.ViewColumn.One,
    preview: false,
    preserveFocus: false,
  });

  // Place cursor in the expression area (after the start marker)
  const docText = inputDocument.getText();
  const startMarkerIdx = docText.indexOf(EXPR_START);
  if (startMarkerIdx !== -1) {
    const startLine = inputDocument.positionAt(startMarkerIdx).line + 1;
    const position = new vscode.Position(startLine, 4); // 4 spaces for scaffold indentation
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }
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
