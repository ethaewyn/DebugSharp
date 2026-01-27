import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  evaluateExpression,
  serializeObjectToJson,
  getCurrentFrameId,
} from '../services/debugService';
import { EvaluationResult } from '../models/debugModels';

let currentPanel: vscode.WebviewPanel | undefined;
let currentSession: vscode.DebugSession | undefined;
let inputDocument: vscode.TextDocument | undefined;
let tempFilePath: string | undefined;
let debugSessionListener: vscode.Disposable | undefined;
let documentCloseListener: vscode.Disposable | undefined;

// Export currentPanel so extension.ts can access it
export { currentPanel };

/**
 * Clean up temporary files and state
 */
async function cleanup(closePanel: boolean = true) {
  // Close the input document first
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

  // Clean up temporary file after a short delay to ensure file is released
  if (tempFilePath && fs.existsSync(tempFilePath)) {
    setTimeout(() => {
      try {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
          tempFilePath = undefined;
        }
      } catch (err) {
        console.error('Failed to delete temp file:', err);
      }
    }, 100);
  }

  // Dispose listeners
  if (debugSessionListener) {
    debugSessionListener.dispose();
    debugSessionListener = undefined;
  }

  if (documentCloseListener) {
    documentCloseListener.dispose();
    documentCloseListener = undefined;
  }

  // Close panel only if requested
  if (closePanel && currentPanel) {
    currentPanel.dispose();
    currentPanel = undefined;
  }

  currentSession = undefined;
}

/**
 * Show or focus the evaluation panel with a C# editor for input
 */
export async function showEvaluationPanel(
  session: vscode.DebugSession,
  frameId: number,
  initialExpression?: string,
): Promise<void> {
  // Store current session
  currentSession = session;

  // Create or show input document as a temporary .cs file in the workspace
  if (!inputDocument) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder open');
      return;
    }

    // Create a temporary .cs file in the workspace root
    const filePath = path.join(workspaceFolder.uri.fsPath, '.vscode-debug-eval.cs');

    // Clean up any existing orphaned temp file from previous session
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log('Cleaned up orphaned temp file from previous session');
      } catch (err) {
        console.error('Failed to delete orphaned temp file:', err);
      }
    }

    tempFilePath = filePath;
    const content =
      initialExpression ||
      "// Enter C# expression here\n// This file has access to all types in your project\n// Note: Ignore any red squiggles - they don't affect evaluation\n";

    // Write the file
    fs.writeFileSync(filePath, content, 'utf8');

    // Open the file
    const uri = vscode.Uri.file(filePath);
    inputDocument = await vscode.workspace.openTextDocument(uri);
  }

  // Show the document in editor
  await vscode.window.showTextDocument(inputDocument, {
    viewColumn: vscode.ViewColumn.One,
    preview: false,
  });

  // If panel already exists, reveal it
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside);
    return;
  }

  // Create new panel
  currentPanel = vscode.window.createWebviewPanel(
    'evaluationPanel',
    'Expression Evaluator',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    },
  );

  currentPanel.webview.html = getEvaluationPanelHtml(initialExpression);

  // Handle messages from webview
  currentPanel.webview.onDidReceiveMessage(async message => {
    console.log('Received message from webview:', message);
    switch (message.type) {
      case 'evaluate':
        // Get expression from the input document and remove comments
        const rawText = inputDocument?.getText() || '';

        // Remove single-line comments and empty lines
        const expression = rawText
          .split('\n')
          .map(line => line.replace(/\/\/.*$/, '').trim())
          .filter(line => line.length > 0)
          .join('\n')
          .trim();

        console.log('Evaluating expression:', expression);
        if (!expression) {
          console.log('Expression is empty, returning');
          currentPanel?.webview.postMessage({
            type: 'error',
            message: 'Please enter a valid C# expression in the editor',
          });
          return;
        }

        // Check if we still have an active session
        if (!currentSession) {
          console.log('No active session');
          currentPanel?.webview.postMessage({
            type: 'error',
            message: 'No active debug session',
          });
          return;
        }

        try {
          // Get the current frame ID (it may have changed since panel opened)
          console.log('Getting current frame ID...');
          const currentFrameId = await getCurrentFrameId(currentSession);
          console.log('Current frame ID:', currentFrameId);
          if (currentFrameId === null) {
            currentPanel?.webview.postMessage({
              type: 'error',
              message: 'Debugger is not paused',
            });
            return;
          }

          console.log('Evaluating expression in debugger...');
          const result = await evaluateExpression(currentSession, currentFrameId, expression);
          console.log('Evaluation result:', result);
          if (result) {
            const isObject = result.variablesReference && result.variablesReference > 0;

            if (isObject) {
              console.log('Serializing object...');
              const jsonObj = await serializeObjectToJson(
                currentSession,
                result.variablesReference!,
              );
              const jsonString = JSON.stringify(jsonObj, null, 2);
              console.log('Sending result to webview');
              currentPanel?.webview.postMessage({
                type: 'result',
                expression: expression,
                result: jsonString,
                resultType: result.type,
                isJson: true,
              });
            } else {
              console.log('Sending primitive result to webview');
              currentPanel?.webview.postMessage({
                type: 'result',
                expression: expression,
                result: result.result,
                resultType: result.type,
                isJson: false,
              });
            }
          } else {
            console.log('Result is null');
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

  // Listen for debug session termination
  if (!debugSessionListener) {
    debugSessionListener = vscode.debug.onDidTerminateDebugSession(terminatedSession => {
      if (terminatedSession === currentSession) {
        console.log('Debug session terminated, cleaning up temp file but keeping panel open');
        cleanup(false); // Don't close the panel
      }
    });
  }

  // Listen for document close to clean up temp file
  if (!documentCloseListener && inputDocument && tempFilePath) {
    const tempUri = inputDocument.uri.toString();
    documentCloseListener = vscode.workspace.onDidCloseTextDocument(closedDoc => {
      if (closedDoc.uri.toString() === tempUri) {
        console.log('Temp document closed, deleting file');
        // Delete the temp file
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          setTimeout(() => {
            try {
              if (tempFilePath && fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
                console.log('Temp file deleted');
              }
            } catch (err) {
              console.error('Failed to delete temp file:', err);
            }
          }, 100);
        }
        // Dispose this listener as it's no longer needed
        if (documentCloseListener) {
          documentCloseListener.dispose();
          documentCloseListener = undefined;
        }
      }
    });
  }

  // Clean up when panel is closed
  currentPanel.onDidDispose(() => {
    cleanup(true); // Close everything
  });
}

function getEvaluationPanelHtml(initialExpression?: string): string {
  const escapedExpression = initialExpression ? escapeHtml(initialExpression) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Expression Evaluator</title>
    <style>
        body {
            font-family: 'Consolas', 'Monaco', monospace;
            padding: 15px;
            margin: 0;
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
        }
        
        .header {
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 15px;
            margin-bottom: 15px;
        }
        
        h3 {
            margin: 0 0 10px 0;
            color: var(--vscode-editor-foreground);
            font-size: 14px;
            font-weight: 600;
        }
        
        .info {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            margin-bottom: 10px;
        }
        
        .button-row {
            display: flex;
            gap: 8px;
            margin-bottom: 15px;
        }
        
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 14px;
            cursor: pointer;
            border-radius: 2px;
            font-size: 13px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .output-section {
            flex: 1;
            overflow-y: auto;
            padding: 15px;
        }
        
        .result-item {
            margin-bottom: 20px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            overflow: hidden;
        }
        
        .result-header {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .result-expression {
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
        }
        
        .result-type {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        
        .result-content {
            padding: 12px;
            background-color: var(--vscode-editor-background);
        }
        
        .error-message {
            color: var(--vscode-errorForeground);
            padding: 12px;
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            border-radius: 3px;
            margin-bottom: 15px;
        }
        
        .json-key {
            color: #9CDCFE;
        }
        .json-string {
            color: #CE9178;
        }
        .json-number {
            color: #B5CEA8;
        }
        .json-boolean {
            color: #569CD6;
        }
        .json-null {
            color: #569CD6;
        }
        .json-bracket {
            color: var(--vscode-editor-foreground);
        }
        .json-collapsible {
            display: inline;
        }
        .json-toggle {
            cursor: pointer;
            user-select: none;
            display: inline-block;
            width: 16px;
            color: var(--vscode-icon-foreground);
        }
        .json-toggle::before {
            content: '▼';
            font-size: 10px;
        }
        .json-collapsible.collapsed .json-toggle::before {
            content: '▶';
        }
        .json-children {
            margin-left: 20px;
            display: block;
        }
        .json-collapsible.collapsed .json-children {
            display: none;
        }
        .json-collapsible.collapsed .json-bracket-close {
            display: none;
        }
        .json-collapsed-preview {
            display: none;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        .json-collapsible.collapsed .json-collapsed-preview {
            display: inline;
        }
        
        .empty-state {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            padding: 40px 20px;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h3>Debug Expression Evaluator</h3>
        <div class="info">Write your C# expression in the editor on the left (with full IntelliSense), then click Evaluate or press Ctrl+Enter</div>
        <div class="button-row">
            <button id="evaluate-btn" onclick="evaluateExpression()">▶ Evaluate</button>
            <button onclick="clearResults()">Clear Results</button>
        </div>
    </div>
    
    <div id="results"></div>
    <div id="empty-state" class="empty-state">
        Write a C# expression in the editor and click Evaluate (or press Ctrl+Enter) to see results
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        const resultsContainer = document.getElementById('results');
        const emptyState = document.getElementById('empty-state');
        const evaluateBtn = document.getElementById('evaluate-btn');
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        function evaluateExpression() {
            console.log('Evaluate button clicked');
            
            evaluateBtn.disabled = true;
            evaluateBtn.textContent = '⏳ Evaluating...';
            
            console.log('Posting evaluate message to extension');
            vscode.postMessage({
                type: 'evaluate'
            });
        }
        
        // Listen for external evaluate triggers (e.g., from keyboard shortcut)
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'triggerEvaluate') {
                evaluateExpression();
            }
        });
        
        function clearResults() {
            resultsContainer.innerHTML = '';
            emptyState.style.display = 'block';
        }
        
        function syntaxHighlight(obj, depth = 0) {
            if (obj === null) {
                return '<span class="json-null">null</span>';
            }
            
            if (typeof obj === 'string') {
                return '<span class="json-string">"' + escapeHtml(obj) + '"</span>';
            }
            
            if (typeof obj === 'number') {
                return '<span class="json-number">' + obj + '</span>';
            }
            
            if (typeof obj === 'boolean') {
                return '<span class="json-boolean">' + obj + '</span>';
            }
            
            const isArray = Array.isArray(obj);
            const hasEntries = isArray ? obj.length > 0 : Object.keys(obj).length > 0;
            
            if (!hasEntries) {
                return '<span class="json-bracket">' + (isArray ? '[]' : '{}') + '</span>';
            }
            
            let html = '<span class="json-collapsible">';
            html += '<span class="json-toggle" onclick="toggleCollapse(event)"></span>';
            html += '<span class="json-bracket">' + (isArray ? '[' : '{') + '</span>';
            html += '<span class="json-collapsed-preview">...</span>';
            html += '<div class="json-children">';
            
            if (isArray) {
                obj.forEach((value, index) => {
                    html += '<div class="json-line">';
                    html += syntaxHighlight(value, depth + 1);
                    if (index < obj.length - 1) html += ',';
                    html += '</div>';
                });
            } else {
                const keys = Object.keys(obj);
                keys.forEach((key, index) => {
                    html += '<div class="json-line">';
                    html += '<span class="json-key">"' + escapeHtml(key) + '"</span>: ';
                    html += syntaxHighlight(obj[key], depth + 1);
                    if (index < keys.length - 1) html += ',';
                    html += '</div>';
                });
            }
            
            html += '</div>';
            html += '<span class="json-bracket json-bracket-close">' + (isArray ? ']' : '}') + '</span>';
            html += '</span>';
            
            return html;
        }
        
        function toggleCollapse(event) {
            event.stopPropagation();
            const collapsible = event.target.closest('.json-collapsible');
            if (collapsible) {
                collapsible.classList.toggle('collapsed');
            }
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            evaluateBtn.disabled = false;
            evaluateBtn.textContent = '▶ Evaluate';
            
            switch (message.type) {
                case 'result':
                    emptyState.style.display = 'none';
                    
                    const resultDiv = document.createElement('div');
                    resultDiv.className = 'result-item';
                    
                    const header = document.createElement('div');
                    header.className = 'result-header';
                    header.innerHTML = \`
                        <span class="result-expression">\${escapeHtml(message.expression)}</span>
                        \${message.resultType ? \`<span class="result-type">\${escapeHtml(message.resultType)}</span>\` : ''}
                    \`;
                    
                    const content = document.createElement('div');
                    content.className = 'result-content';
                    
                    if (message.isJson) {
                        try {
                            const jsonObj = JSON.parse(message.result);
                            content.innerHTML = syntaxHighlight(jsonObj);
                        } catch {
                            content.textContent = message.result;
                        }
                    } else {
                        content.textContent = message.result;
                    }
                    
                    resultDiv.appendChild(header);
                    resultDiv.appendChild(content);
                    resultsContainer.insertBefore(resultDiv, resultsContainer.firstChild);
                    break;
                    
                case 'error':
                    emptyState.style.display = 'none';
                    
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'error-message';
                    errorDiv.textContent = message.message;
                    resultsContainer.insertBefore(errorDiv, resultsContainer.firstChild);
                    
                    setTimeout(() => errorDiv.remove(), 5000);
                    break;
                    
                case 'setExpression':
                    expressionInput.value = message.expression;
                    expressionInput.focus();
                    break;
            }
        });
    </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, match => {
    const escapeMap: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return escapeMap[match];
  });
}

export { evaluateExpression } from '../services/debugService';
