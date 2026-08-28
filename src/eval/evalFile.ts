/**
 * Evaluation File Module
 *
 * Manages the temporary `.vscode-debug-eval.cs` file that gives users a
 * real C# editing surface — with full IntelliSense — for debugger expressions.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  generateScaffold,
  getSourceFileUsings,
  getProjectNamespaces,
  getFrameAndVariables,
  extractUserExpression,
  isScaffoldFile,
  EVAL_FILE_NAME,
  EXPR_START,
  EXPR_END,
} from './scaffold';

// Module state
let currentSession: vscode.DebugSession | undefined;
let inputDocument: vscode.TextDocument | undefined;
let tempFilePath: string | undefined;
let debugSessionListener: vscode.Disposable | undefined;
let documentCloseListener: vscode.Disposable | undefined;

/** Serializes scaffold updates — see updateEvalScaffold */
let pendingUpdate: Promise<void> = Promise.resolve();

/**
 * Create or delete the scaffold without disturbing its directory's timestamp.
 *
 * The scaffold is our artifact, not one of the user's build inputs — but adding
 * or removing a file bumps the containing directory's mtime, and the up-to-date
 * check reads directory mtimes to notice deleted and renamed sources. Left
 * alone, every debug session would mark its own project stale forever.
 */
function withoutTouchingDirectory(filePath: string, mutate: () => void): void {
  const dir = path.dirname(filePath);

  let before: fs.Stats | undefined;
  try {
    before = fs.statSync(dir);
  } catch {
    // Directory is gone; nothing to preserve
  }

  mutate();

  if (before) {
    try {
      fs.utimesSync(dir, before.atime, before.mtime);
    } catch {
      // Best effort — a needless rebuild is the worst case
    }
  }
}

/**
 * Delete an eval scaffold, leaving its directory's timestamp untouched.
 */
export function deleteEvalFileAt(filePath: string): void {
  withoutTouchingDirectory(filePath, () => {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Already gone, or in use
    }
  });
}

/**
 * Remove scaffolds left behind by a previous session.
 */
export async function cleanupOrphanedEvalFiles(): Promise<void> {
  try {
    const orphans = await vscode.workspace.findFiles(`**/${EVAL_FILE_NAME}`, '**/node_modules/**');
    for (const file of orphans) {
      deleteEvalFileAt(file.fsPath);
    }
  } catch {
    // Workspace might not be ready
  }
}

/**
 * Find the nearest directory containing a .csproj file by walking up from a source file.
 */
function findProjectDirFromSource(sourcePath: string): string | undefined {
  let dir = path.dirname(sourcePath);
  const root = path.parse(dir).root;

  while (dir !== root) {
    try {
      const entries = fs.readdirSync(dir);
      if (entries.some(e => e.endsWith('.csproj'))) {
        return dir;
      }
    } catch {
      // Skip unreadable dirs
    }
    dir = path.dirname(dir);
  }
  return undefined;
}

/**
 * Relocate the temp file to a new project directory.
 * Preserves the file content and updates the module state.
 */
function relocateTempFile(newProjectDir: string): void {
  const newPath = path.join(newProjectDir, EVAL_FILE_NAME);
  if (newPath === tempFilePath) return;

  try {
    // Read current content before moving
    let content = '';
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      content = fs.readFileSync(tempFilePath, 'utf8');
      deleteEvalFileAt(tempFilePath);
    }

    // Write to new location
    const scaffold = content || generateScaffold([], [], '');
    withoutTouchingDirectory(newPath, () => fs.writeFileSync(newPath, scaffold, 'utf8'));
    tempFilePath = newPath;
    inputDocument = undefined; // Force re-open from new path
  } catch {
    // Keep existing location on failure
  }
}

/**
 * Create the temp .cs file when debugging starts
 */
export async function createEvalFile(session: vscode.DebugSession): Promise<void> {
  // Find the specific C# project being debugged
  let projectDir: string | undefined;

  // Use cwd from debug config — set to the project directory by generateDebugConfig
  const debugConfig = session.configuration;
  if (debugConfig?.cwd) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const resolvedCwd = debugConfig.cwd.replace(
      /\$\{workspaceFolder\}/g,
      workspaceFolder?.uri.fsPath || '',
    );
    if (fs.existsSync(resolvedCwd)) {
      projectDir = resolvedCwd;
    }
  }

  // Fallback: Find any .csproj file
  if (!projectDir) {
    const csprojFiles = await vscode.workspace.findFiles('**/*.csproj', '**/node_modules/**', 10);
    if (csprojFiles.length > 0) {
      projectDir = path.dirname(csprojFiles[0].fsPath);
    }
  }

  if (!projectDir) {
    return;
  }

  const filePath = path.join(projectDir, EVAL_FILE_NAME);

  // Clean up any orphaned temp file from previous session
  deleteEvalFileAt(filePath);

  tempFilePath = filePath;

  // Write an initial scaffold with no variables (debugger hasn't stopped yet)
  const initialScaffold = generateScaffold([], [], '');
  withoutTouchingDirectory(filePath, () => fs.writeFileSync(filePath, initialScaffold, 'utf8'));
}

/**
 * Update the scaffold in the eval file with current debug scope variables.
 * Preserves the user's expression between the expression markers.
 *
 * Uses the atomic getFrameAndVariables() which does a single stackTrace call —
 * avoiding stale reference issues. Returns the frameId that was used.
 */
export function updateEvalScaffold(
  session: vscode.DebugSession,
  threadId: number,
  preferredFrameId?: number,
): Promise<number | undefined> {
  // Both the stopped event and the focused-frame change can trigger an update,
  // and each applies a WorkspaceEdit — serialize them so their edits can't
  // interleave on the same document.
  const run = pendingUpdate.then(() => doUpdateEvalScaffold(session, threadId, preferredFrameId));
  pendingUpdate = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function doUpdateEvalScaffold(
  session: vscode.DebugSession,
  threadId: number,
  preferredFrameId?: number,
): Promise<number | undefined> {
  if (!tempFilePath) return undefined;

  // Ensure file exists
  if (!fs.existsSync(tempFilePath)) return undefined;

  try {
    // Single stackTrace → scopes → variables
    const result = await getFrameAndVariables(session, threadId, preferredFrameId);
    if (!result) return undefined;

    const { frameId, variables, sourcePath } = result;
    const sourceUsings = getSourceFileUsings(sourcePath);

    // Relocate temp file to the correct project if sourcePath reveals a different project
    if (sourcePath) {
      const correctProjectDir = findProjectDirFromSource(sourcePath);
      if (correctProjectDir && path.dirname(tempFilePath) !== correctProjectDir) {
        relocateTempFile(correctProjectDir);
      }
    }

    // Merge source-file usings with project-wide namespace usings
    const projectDir = path.dirname(tempFilePath);
    const allUsings = [...sourceUsings, ...getProjectNamespaces(projectDir)];

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
    if (newContent === currentContent) return frameId;

    if (doc) {
      // Document is open — use WorkspaceEdit for atomic in-memory update
      // Only replace the scaffold header portion (above expression start marker)
      // to avoid disrupting the user's cursor position in the expression area
      const currentStartIdx = currentContent.indexOf(EXPR_START);
      const newStartIdx = newContent.indexOf(EXPR_START);

      const edit = new vscode.WorkspaceEdit();

      if (currentStartIdx !== -1 && newStartIdx !== -1) {
        // Only replace the header (everything before the start marker)
        const headerRange = new vscode.Range(doc.positionAt(0), doc.positionAt(currentStartIdx));
        edit.replace(doc.uri, headerRange, newContent.substring(0, newStartIdx));
      } else {
        // Full replacement (first time or file was corrupted)
        const fullRange = new vscode.Range(
          doc.positionAt(0),
          doc.positionAt(currentContent.length),
        );
        edit.replace(doc.uri, fullRange, newContent);
      }

      await vscode.workspace.applyEdit(edit);
    } else {
      // File not open as document — write to disk
      fs.writeFileSync(tempFilePath, newContent, 'utf8');
    }

    return frameId;
  } catch (error) {
    console.error('[DebugSharp] Error updating scaffold:', error);
    return undefined;
  }
}

/**
 * Delete the temp .cs file when debugging stops
 */
export function deleteEvalFile(): void {
  if (tempFilePath && fs.existsSync(tempFilePath)) {
    deleteEvalFileAt(tempFilePath);
    tempFilePath = undefined;
  }
}

/**
 * Clean up resources: close the editor and dispose listeners
 */
async function cleanup(): Promise<void> {
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

  currentSession = undefined;
}

/**
 * Open the eval file with the cursor in the expression area.
 *
 * @param session - Active debug session
 * @param initialExpression - Optional expression to pre-populate
 */
export async function openEvalFile(
  session: vscode.DebugSession,
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

  if (!debugSessionListener) {
    debugSessionListener = vscode.debug.onDidTerminateDebugSession(terminatedSession => {
      if (terminatedSession === currentSession) {
        cleanup();
      }
    });
  }

  if (!documentCloseListener && inputDocument && tempFilePath) {
    const tempUri = inputDocument.uri.toString();
    documentCloseListener = vscode.workspace.onDidCloseTextDocument(closedDoc => {
      if (closedDoc.uri.toString() === tempUri) {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          setTimeout(() => {
            if (tempFilePath && fs.existsSync(tempFilePath)) {
              deleteEvalFileAt(tempFilePath);
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

  // Show the text document with focus
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
