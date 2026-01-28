/**
 * Webview Module
 *
 * Provides JSON object visualization with syntax highlighting and collapsible tree view.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

let objectViewerTemplate: string | undefined;
let extensionContext: vscode.ExtensionContext | undefined;

/**
 * Initialize the webview module with extension context
 */
export function initializeWebview(context: vscode.ExtensionContext): void {
  extensionContext = context;
}

/**
 * Load and cache the HTML template
 */
function getObjectViewerTemplate(): string {
  if (!objectViewerTemplate) {
    if (!extensionContext) {
      throw new Error('Webview not initialized. Call initializeWebview() first.');
    }
    const templatePath = path.join(
      extensionContext.extensionPath,
      'out',
      'ui',
      'panels',
      'templates',
      'objectViewer.html',
    );
    objectViewerTemplate = fs.readFileSync(templatePath, 'utf8');
  }
  return objectViewerTemplate;
}

/**
 * Generate HTML for JSON webview
 *
 * @param title - Panel title
 * @param jsonString - JSON data to display
 * @param subtitle - Optional subtitle text
 * @returns Fully rendered HTML string
 */
export function generateJsonWebview(title: string, jsonString: string, subtitle?: string): string {
  const subtitleHtml = subtitle
    ? `<p style="color: var(--vscode-descriptionForeground);">${subtitle}</p>`
    : '';

  return getObjectViewerTemplate()
    .replace(/{{TITLE}}/g, escapeHtml(title))
    .replace(/{{SUBTITLE}}/g, subtitleHtml)
    .replace(/{{JSON_DATA}}/g, jsonString)
    .replace(/{{RAW_CONTENT}}/g, JSON.stringify(jsonString));
}

/**
 * Escape HTML special characters
 */
export function escapeHtml(text: string): string {
  const escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, match => escapeMap[match]);
}

/**
 * Create and display a JSON viewer webview panel
 *
 * @param title - Panel title
 * @param jsonString - JSON data to display
 * @param subtitle - Optional subtitle text
 * @returns The created webview panel
 */
export function createJsonWebviewPanel(
  title: string,
  jsonString: string,
  subtitle?: string,
): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel('jsonViewer', title, vscode.ViewColumn.Beside, {
    enableScripts: true,
  });

  panel.webview.html = generateJsonWebview(title, jsonString, subtitle);
  return panel;
}
