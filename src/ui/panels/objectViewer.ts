/**
 * Object Viewer Module
 *
 * Provides commands to view object state as JSON during debugging.
 */
import * as vscode from 'vscode';
import { serializeObjectToJson } from '../../debug/serializer';
import { objectReferences } from '../inlayHints/provider';
import { createJsonWebviewPanel } from './webview';

/**
 * Show object picker for the current line
 * If only one object, shows it directly. Otherwise shows quick pick.
 */
export async function showObjectPickerForLine(): Promise<void> {
  const objectNames = Array.from(objectReferences.keys());

  if (objectNames.length === 0) {
    vscode.window.showInformationMessage('No objects found on current line');
    return;
  }

  if (objectNames.length === 1) {
    await showObjectJson(objectNames[0]);
    return;
  }

  const selected = await vscode.window.showQuickPick(objectNames, {
    placeHolder: 'Select an object to view as JSON',
    title: 'View Object as JSON',
  });

  if (selected) {
    await showObjectJson(selected);
  }
}

/**
 * Display object contents as JSON in a webview
 *
 * @param varName - Variable name to serialize
 */
export async function showObjectJson(varName: string): Promise<void> {
  const objRef = objectReferences.get(varName);
  if (!objRef) {
    vscode.window.showErrorMessage(`No object reference found for ${varName}`);
    return;
  }

  try {
    const jsonObj = await serializeObjectToJson(objRef.session, objRef.variablesReference);
    const jsonString = JSON.stringify(jsonObj, null, 2);
    createJsonWebviewPanel(`${varName} - JSON View`, jsonString);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    vscode.window.showErrorMessage(`Failed to serialize object: ${message}`);
  }
}
