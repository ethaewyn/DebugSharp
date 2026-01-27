import * as vscode from 'vscode';
import { serializeObjectToJson } from '../services/debugService';
import { objectReferences } from '../providers/inlayHintsProvider';
import { createJsonWebviewPanel } from './webview';

/**
 * Show quick pick to select which object to view when multiple objects are available
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
 * Show formatted JSON popup for an object in a webview panel
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
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to serialize object: ${error.message}`);
  }
}
