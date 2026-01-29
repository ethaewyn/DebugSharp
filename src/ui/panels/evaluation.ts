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
 * Get local variables from current debug context for IntelliSense
 */
async function getDebugContextVariables(
  session: vscode.DebugSession,
  frameId: number,
): Promise<string> {
  try {
    let contextCode = '// Available variables in current context:\n';
    let foundVariables = false;
    let isLambdaFrame = false;
    let parentFrameId: number | undefined;

    // Get stack trace to find current frame and detect lambdas
    try {
      const threadsResponse = await session.customRequest('threads', {});
      if (threadsResponse?.threads && threadsResponse.threads.length > 0) {
        const stackTraceResponse = await session.customRequest('stackTrace', {
          threadId: threadsResponse.threads[0].id,
          startFrame: 0,
          levels: 20,
        });

        if (stackTraceResponse?.stackFrames && stackTraceResponse.stackFrames.length > 0) {
          const currentFrame = stackTraceResponse.stackFrames.find((f: any) => f.id === frameId);

          if (currentFrame) {
            contextCode += `// Method: ${currentFrame.name}\n`;
          } else {
            // Frame not in stack trace - likely a lambda/nested scope
            isLambdaFrame = true;
            const parentFrame = stackTraceResponse.stackFrames.find(
              (f: any) => !f.name.includes('[External Code]') && f.source,
            );
            if (parentFrame) {
              parentFrameId = parentFrame.id;
              contextCode += `// Lambda in: ${parentFrame.name}\n`;
            }
          }
        }
      }
    } catch {
      // Stack trace unavailable, continue
    }

    // Get scopes for the current frame
    const scopesResponse = await session.customRequest('scopes', { frameId });
    if (!scopesResponse?.scopes || scopesResponse.scopes.length === 0) {
      return contextCode + '\n';
    }

    // Extract variables from all scopes
    for (const scope of scopesResponse.scopes) {
      if (scope.variablesReference > 0) {
        const varsResponse = await session.customRequest('variables', {
          variablesReference: scope.variablesReference,
        });

        if (varsResponse?.variables && varsResponse.variables.length > 0) {
          foundVariables = true;
          for (const v of varsResponse.variables) {
            // Skip internal variables
            if (v.name === 'this' || v.name.startsWith('$')) {
              continue;
            }

            // Clean up variable name - remove type annotations in brackets
            let cleanName = v.name;
            const bracketIndex = cleanName.indexOf(' [');
            if (bracketIndex > 0) {
              cleanName = cleanName.substring(0, bracketIndex);
            }

            const cleanType = v.type?.replace('?', '') || 'object';
            contextCode += `${cleanType} ${cleanName} = default; // ${v.value}\n`;
          }
        }
      }
    }

    // If no variables found, try alternative methods
    if (!foundVariables) {
      // For lambdas, try to get parent frame variables
      if (isLambdaFrame && parentFrameId) {
        try {
          const parentScopesResponse = await session.customRequest('scopes', {
            frameId: parentFrameId,
          });

          if (parentScopesResponse?.scopes) {
            for (const scope of parentScopesResponse.scopes) {
              if (scope.variablesReference > 0) {
                const varsResponse = await session.customRequest('variables', {
                  variablesReference: scope.variablesReference,
                });
                if (varsResponse?.variables && varsResponse.variables.length > 0) {
                  foundVariables = true;
                  contextCode += `// Variables from parent scope (captured by lambda):\n`;
                  for (const v of varsResponse.variables) {
                    if (v.name === 'this' || v.name.startsWith('$')) {
                      continue;
                    }
                    let cleanName = v.name;
                    const bracketIndex = cleanName.indexOf(' [');
                    if (bracketIndex > 0) {
                      cleanName = cleanName.substring(0, bracketIndex);
                    }
                    const cleanType = v.type?.replace('?', '') || 'object';
                    contextCode += `${cleanType} ${cleanName} = default; // ${v.value}\n`;
                  }
                }
              }
            }
          }
        } catch {
          // Parent frame unavailable
        }
      }

      // Try evaluating common lambda-local variable names
      try {
        const lambdaTestExprs = ['forecast', 'index', 'result', 'item', 'value', 'data'];
        let foundLambdaVars = false;

        for (const expr of lambdaTestExprs) {
          try {
            const result = await session.customRequest('evaluate', {
              expression: expr,
              frameId: frameId,
              context: 'watch',
            });

            if (
              result?.result &&
              !result.result.includes('error') &&
              !result.result.includes('does not exist') &&
              !result.result.includes('not exist') &&
              !result.result.includes('Cannot evaluate')
            ) {
              if (!foundLambdaVars) {
                if (foundVariables) {
                  contextCode += `// Lambda-local variables:\n`;
                }
                foundLambdaVars = true;
              }
              const cleanType = result.type || 'var';
              contextCode += `${cleanType} ${expr} = default; // ${result.result}\n`;
              foundVariables = true;
            }
          } catch {
            // Expression not available
          }
        }
      } catch {
        // Lambda variable detection unavailable
      }

      // Try evaluating common framework objects
      if (!foundVariables) {
        try {
          const testExprs = ['this', 'HttpContext', 'Request', 'Response', 'app', 'builder'];
          for (const expr of testExprs) {
            try {
              const result = await session.customRequest('evaluate', {
                expression: expr,
                frameId: frameId,
                context: 'watch',
              });
              if (
                result?.result &&
                !result.result.includes('error') &&
                !result.result.includes('does not exist')
              ) {
                const cleanType = result.type || 'var';
                contextCode += `${cleanType} ${expr} = default; // ${result.result}\n`;
                foundVariables = true;
              }
            } catch {
              // Expression not available
            }
          }
        } catch {
          // Framework object detection unavailable
        }
      }

      if (!foundVariables) {
        contextCode += '// No variables found in current context\n';
      }
    }

    return contextCode + '\n';
  } catch (error) {
    return '';
  }
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

    // Create a mini SDK-style project for IntelliSense support
    const evalDir = path.join(workspaceFolder.uri.fsPath, '.vscode', 'debugsharp-eval');
    if (!fs.existsSync(evalDir)) {
      fs.mkdirSync(evalDir, { recursive: true });
    }

    // Find the project being debugged and its dependencies
    const debuggedProject = await findDebuggedProject(session);
    let allRelevantProjects: string[] = [];
    let targetFramework = 'net8.0';

    if (debuggedProject && fs.existsSync(debuggedProject)) {
      allRelevantProjects.push(debuggedProject);
      // Add all its dependencies recursively
      allRelevantProjects.push(...getProjectReferences(debuggedProject));
      // Remove duplicates
      allRelevantProjects = [...new Set(allRelevantProjects)];

      // Get target framework from the debugged project
      const tfm = getTargetFrameworkFromProject(debuggedProject);
      if (tfm) {
        targetFramework = tfm;
      }
    } else {
      // Fallback: try to detect from debugger
      targetFramework = (await detectTargetFramework(session)) || 'net8.0';
    }

    const projectReferences = allRelevantProjects
      .filter(proj => !proj.includes('debugsharp-eval')) // Exclude our own eval project
      .map(proj => {
        const relativePath = path.relative(evalDir, proj).replace(/\\/g, '/');
        return `    <ProjectReference Include="${relativePath}" />`;
      })
      .join('\n');

    // Create/update .csproj file for IntelliSense
    const projectPath = path.join(evalDir, 'DebugEval.csproj');
    const projectContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>${targetFramework}</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <IsPackable>false</IsPackable>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="Eval.cs" />
  </ItemGroup>
${projectReferences ? `  <ItemGroup>\n${projectReferences}\n  </ItemGroup>` : ''}
</Project>`;

    fs.writeFileSync(projectPath, projectContent, 'utf8');

    const filePath = path.join(evalDir, 'Eval.cs');

    // Clean up any orphaned temp file from previous session
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // Fail silently
      }
    }

    tempFilePath = filePath;

    // Get current debug context for IntelliSense
    let contextVariables = '';
    try {
      contextVariables = await getDebugContextVariables(session, frameId);
    } catch {
      // Continue without context
    }

    const content =
      contextVariables +
      (initialExpression ||
        '// Enter C# expression here\n// This file has full IntelliSense support\n');

    fs.writeFileSync(filePath, content, 'utf8');

    const uri = vscode.Uri.file(filePath);
    inputDocument = await vscode.workspace.openTextDocument(uri);
  } else {
    // Update existing document with new context
    try {
      const contextVariables = await getDebugContextVariables(session, frameId);
      const currentText = inputDocument.getText();

      // Remove old context and add new one
      const lines = currentText.split('\n');
      const nonContextLines = lines.filter(line => !line.includes('// Available variables'));
      const userCode = nonContextLines
        .join('\n')
        .replace(/^\/\/ .*$/gm, '')
        .trim();

      if (userCode) {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          inputDocument.lineAt(0).range.start,
          inputDocument.lineAt(inputDocument.lineCount - 1).range.end,
        );
        edit.replace(inputDocument.uri, fullRange, contextVariables + userCode);
        await vscode.workspace.applyEdit(edit);
      }
    } catch {
      // Continue without updating context
    }
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

        // Filter out context variable declarations and comments
        const expression = rawText
          .split('\n')
          .filter(line => {
            const trimmed = line.trim();
            // Skip context declarations and comment lines
            return (
              trimmed &&
              !trimmed.startsWith('// Available variables') &&
              !trimmed.match(/^[\w\[\]<>\.]+\s+\w+\s*=\s*default;/) &&
              !trimmed.startsWith('//')
            );
          })
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
 * Detect target framework from debug session or use sensible default
 */
async function detectTargetFramework(session: vscode.DebugSession): Promise<string | null> {
  try {
    // Try to get runtime info from debugger
    const result = await session.customRequest('evaluate', {
      expression: 'System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription',
      context: 'watch',
    });

    if (result?.result) {
      const desc = result.result.toLowerCase();
      // Extract version from something like ".NET 8.0.1" or ".NET Framework 4.8"
      if (desc.includes('.net framework')) {
        return 'net48'; // Use .NET Framework 4.8 as default for framework apps
      }
      const match = desc.match(/(\d+)\.(\d+)/);
      if (match) {
        return `net${match[1]}.${match[2]}`;
      }
    }
  } catch {
    // Ignore errors, we'll use a default
  }
  return null;
}

/**
 * Find the .csproj file being debugged from the debug session
 */
async function findDebuggedProject(session: vscode.DebugSession): Promise<string | null> {
  try {
    // Try to get the program path from debug configuration
    const config = session.configuration;
    const programPath = config?.program;

    if (programPath && typeof programPath === 'string') {
      // The program path is usually something like: bin/Debug/net8.0/MyApp.dll
      // Navigate up to find the .csproj file
      let dir = path.dirname(programPath);

      // Go up directories looking for a .csproj
      for (let i = 0; i < 5; i++) {
        const files = fs.readdirSync(dir);
        const csprojFile = files.find(f => f.endsWith('.csproj'));
        if (csprojFile) {
          return path.join(dir, csprojFile);
        }
        const parent = path.dirname(dir);
        if (parent === dir) break; // Reached root
        dir = parent;
      }
    }
  } catch {
    // Ignore errors
  }
  return null;
}

/**
 * Parse a .csproj file to get its ProjectReference dependencies
 */
function getProjectReferences(csprojPath: string): string[] {
  try {
    const content = fs.readFileSync(csprojPath, 'utf8');
    const references: string[] = [];
    const projectDir = path.dirname(csprojPath);

    // Simple regex to find ProjectReference elements
    const regex = /<ProjectReference\s+Include="([^"]+)"/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
      const refPath = match[1].replace(/\\/g, '/');
      const absolutePath = path.resolve(projectDir, refPath);
      if (fs.existsSync(absolutePath)) {
        references.push(absolutePath);
        // Recursively get dependencies of dependencies
        references.push(...getProjectReferences(absolutePath));
      }
    }

    return references;
  } catch {
    return [];
  }
}

/**
 * Get target framework from a .csproj file
 */
function getTargetFrameworkFromProject(csprojPath: string): string | null {
  try {
    const content = fs.readFileSync(csprojPath, 'utf8');
    const match = content.match(/<TargetFramework>([^<]+)<\/TargetFramework>/);
    if (match) {
      return match[1];
    }
  } catch {
    // Ignore
  }
  return null;
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
