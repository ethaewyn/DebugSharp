import * as vscode from 'vscode';
import {
  evaluateExpression,
  serializeObjectToJson,
  getCurrentFrameId,
} from '../services/debugService';
import { EvaluationResult } from '../models/debugModels';

let currentPanel: vscode.WebviewPanel | undefined;
let currentSession: vscode.DebugSession | undefined;

/**
 * Show or focus the evaluation panel
 */
export async function showEvaluationPanel(
  session: vscode.DebugSession,
  frameId: number,
  initialExpression?: string,
): Promise<void> {
  // Store current session
  currentSession = session;

  // If panel already exists, reveal it
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside);
    if (initialExpression) {
      currentPanel.webview.postMessage({ type: 'setExpression', expression: initialExpression });
    }
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
        const expression = message.expression;
        console.log('Evaluating expression:', expression);
        if (!expression?.trim()) {
          console.log('Expression is empty, returning');
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

  // Clean up when panel is closed
  currentPanel.onDidDispose(() => {
    currentPanel = undefined;
    currentSession = undefined;
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
            padding: 0;
            margin: 0;
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
            display: flex;
            flex-direction: column;
            height: 100vh;
        }
        
        .container {
            display: flex;
            flex-direction: column;
            height: 100%;
        }
        
        .input-section {
            border-bottom: 1px solid var(--vscode-panel-border);
            padding: 15px;
            background-color: var(--vscode-editor-background);
        }
        
        h3 {
            margin: 0 0 10px 0;
            color: var(--vscode-editor-foreground);
            font-size: 14px;
            font-weight: 600;
        }
        
        .input-wrapper {
            position: relative;
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            background-color: var(--vscode-input-background);
        }
        
        #expression-input {
            width: 100%;
            min-height: 80px;
            padding: 10px;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 13px;
            color: var(--vscode-input-foreground);
            background-color: var(--vscode-input-background);
            border: none;
            resize: vertical;
            outline: none;
            line-height: 1.6;
        }
        
        .button-row {
            margin-top: 10px;
            display: flex;
            gap: 8px;
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
        
        /* Syntax highlighting for input */
        .syntax-keyword {
            color: #569CD6;
        }
        .syntax-string {
            color: #CE9178;
        }
        .syntax-number {
            color: #B5CEA8;
        }
        .syntax-comment {
            color: #6A9955;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="input-section">
            <h3>Expression</h3>
            <div class="input-wrapper">
                <textarea id="expression-input" placeholder="Enter C# expression... (e.g., x + y, myObject.Property, list.Count)">${escapedExpression}</textarea>
            </div>
            <div class="button-row">
                <button id="evaluate-btn" onclick="evaluateExpression()">▶ Evaluate</button>
                <button onclick="clearResults()">Clear Results</button>
            </div>
        </div>
        
        <div class="output-section">
            <div id="results"></div>
            <div id="empty-state" class="empty-state">
                Enter an expression above and click Evaluate to see results
            </div>
        </div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        const resultsContainer = document.getElementById('results');
        const emptyState = document.getElementById('empty-state');
        const expressionInput = document.getElementById('expression-input');
        const evaluateBtn = document.getElementById('evaluate-btn');
        
        // Handle Ctrl+Enter to evaluate
        expressionInput.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                evaluateExpression();
            }
        });
        
        function evaluateExpression() {
            const expression = expressionInput.value.trim();
            console.log('Evaluate button clicked, expression:', expression);
            if (!expression) {
                console.log('Expression is empty, not sending message');
                return;
            }
            
            evaluateBtn.disabled = true;
            evaluateBtn.textContent = '⏳ Evaluating...';
            
            console.log('Posting message to extension');
            vscode.postMessage({
                type: 'evaluate',
                expression: expression
            });
        }
        
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
