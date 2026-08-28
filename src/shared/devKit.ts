/**
 * C# Dev Kit Detection
 *
 * DebugSharp is built to sit alongside Dev Kit rather than duplicate it, so a
 * few features stand down when it's installed. Detection happens at activation;
 * installing or removing Dev Kit needs a window reload either way.
 */
import * as vscode from 'vscode';

const DEV_KIT_EXTENSION_ID = 'ms-dotnettools.csdevkit';

/** Command Dev Kit contributes for choosing the solution configuration */
export const DEV_KIT_SELECT_CONFIGURATION = 'csdevkit.selectActiveConfiguration';

export function isDevKitInstalled(): boolean {
  return vscode.extensions.getExtension(DEV_KIT_EXTENSION_ID) !== undefined;
}

/** How a feature that overlaps Dev Kit should behave */
export type CoexistenceMode = 'auto' | 'always' | 'never';

/**
 * Resolve an `auto | always | never` setting: `auto` means "only when Dev Kit
 * isn't here to do it for us".
 */
export function shouldEnable(settingKey: string): boolean {
  const mode = vscode.workspace
    .getConfiguration('debugSharp')
    .get<CoexistenceMode>(settingKey, 'auto');

  if (mode === 'always') return true;
  if (mode === 'never') return false;

  return !isDevKitInstalled();
}
