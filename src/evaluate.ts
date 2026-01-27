import * as vscode from 'vscode';
import { serializeObjectToJson } from './debugger';

/**
 * Evaluate an expression in the current debug context
 */
export async function evaluateExpression(
  session: vscode.DebugSession,
  frameId: number,
  expression: string,
): Promise<{ result: string; type?: string; variablesReference?: number } | null> {
  try {
    const result = await session.customRequest('evaluate', {
      expression: expression,
      frameId: frameId,
      context: 'watch',
    });

    if (result && result.result) {
      return {
        result: result.result,
        type: result.type,
        variablesReference: result.variablesReference,
      };
    }
    if (result && result.error) {
      return {
        result: `Error: ${result.error}`,
      };
    }
    return null;
  } catch (error: any) {
    return {
      result: `Error: ${error?.message || 'Failed to evaluate expression'}`,
    };
  }
}

/**
 * Show evaluation result in a webview panel
 */
export async function showEvaluationResult(
  expression: string,
  evalResult: { result: string; type?: string; variablesReference?: number },
  session: vscode.DebugSession,
) {
  // Check if result is an object that can be expanded
  const isObject = evalResult.variablesReference && evalResult.variablesReference > 0;

  let displayContent: string;
  let isJson = false;

  if (isObject) {
    try {
      const jsonObj = await serializeObjectToJson(session, evalResult.variablesReference!);
      displayContent = JSON.stringify(jsonObj, null, 2);
      isJson = true;
    } catch (error) {
      displayContent = evalResult.result;
      isJson = false;
    }
  } else {
    displayContent = evalResult.result;
    isJson = false;
  }

  // Create webview panel
  const panel = vscode.window.createWebviewPanel(
    'evaluationResult',
    `Eval: ${expression}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
    },
  );

  panel.webview.html = getEvaluationWebviewContent(
    expression,
    displayContent,
    evalResult.type,
    isJson,
  );
}

function getEvaluationWebviewContent(
  expression: string,
  content: string,
  type: string | undefined,
  isJson: boolean,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Evaluation Result</title>
    <style>
        body {
            font-family: 'Consolas', 'Monaco', monospace;
            padding: 20px;
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
        }
        h2 {
            color: var(--vscode-editor-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 10px;
        }
        .type-info {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
            margin-bottom: 10px;
        }
        .toolbar {
            margin-bottom: 10px;
        }
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 3px;
            margin-right: 5px;
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        #result-container {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 15px;
            border-radius: 5px;
            overflow: auto;
            font-size: 14px;
            line-height: 1.6;
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
        .json-collapsible.collapsed .json-children {
            display: none;
        }
        .json-children {
            margin-left: 20px;
            display: block;
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
        .json-line {
            position: relative;
        }
    </style>
</head>
<body>
    <h2>Expression: ${escapeHtml(expression)}</h2>
    ${type ? `<div class="type-info">Type: ${escapeHtml(type)}</div>` : ''}
    <div class="toolbar">
        <button onclick="copyToClipboard()">📋 Copy Result</button>
        ${isJson ? '<button onclick="expandAll()">⬇️ Expand All</button><button onclick="collapseAll()">➡️ Collapse All</button>' : ''}
    </div>
    <div id="result-container"></div>
    <script>
        const isJson = ${isJson};
        const rawContent = ${JSON.stringify(content)};
        
        ${
          isJson
            ? `
        const jsonData = JSON.parse(rawContent);
        
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
            const entries = isArray ? obj : Object.entries(obj);
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
        
        function expandAll() {
            document.querySelectorAll('.json-collapsible.collapsed').forEach(el => {
                el.classList.remove('collapsed');
            });
        }
        
        function collapseAll() {
            document.querySelectorAll('.json-collapsible').forEach(el => {
                el.classList.add('collapsed');
            });
        }
        
        document.getElementById('result-container').innerHTML = syntaxHighlight(jsonData);
        `
            : `
        document.getElementById('result-container').textContent = rawContent;
        `
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        function copyToClipboard() {
            navigator.clipboard.writeText(rawContent).then(() => {
                const btn = document.querySelector('button');
                const originalText = btn.textContent;
                btn.textContent = '✓ Copied!';
                setTimeout(() => btn.textContent = originalText, 2000);
            });
        }
    </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * Show input dialog to evaluate an expression
 */
export async function promptForExpression(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: 'Enter an expression to evaluate',
    placeHolder: 'e.g., x + y, obj.Property, string.Concat(a, b)',
  });
}
