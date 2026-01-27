import * as vscode from 'vscode';
import { getCurrentFrameId, getVariablesForFrame } from './debugger';
import { updateInlineHints, clearHints } from './hints';
import { POLL_INTERVAL_MS } from './constants';

export class DebugPoller {
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private currentSession: vscode.DebugSession | undefined;
  private decorationType: vscode.TextEditorDecorationType;

  constructor(decorationType: vscode.TextEditorDecorationType) {
    this.decorationType = decorationType;
  }

  /**
   * Single poll cycle - check if debugger is paused and update hints
   */
  private async poll() {
    if (!this.currentSession) {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    const frameId = await getCurrentFrameId(this.currentSession);
    if (frameId === null) {
      return; // Still running or no frames
    }

    const variables = await getVariablesForFrame(this.currentSession, frameId);
    if (Object.keys(variables).length === 0) {
      return;
    }

    updateInlineHints(editor, this.decorationType, variables);
  }

  /**
   * Start polling for debug variables
   */
  startPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    this.pollInterval = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  /**
   * Stop polling and clear hints
   */
  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      clearHints(editor, this.decorationType);
    }
  }

  /**
   * Update the active debug session
   */
  setSession(session: vscode.DebugSession | undefined) {
    this.currentSession = session;
  }

  /**
   * Get the active debug session
   */
  getSession(): vscode.DebugSession | undefined {
    return this.currentSession;
  }
}
