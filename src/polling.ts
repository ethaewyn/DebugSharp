import * as vscode from 'vscode';
import { getCurrentFrameId, getVariablesForFrame } from './debugger';
import { POLL_INTERVAL_MS } from './constants';
import { updateInlayHintData } from './inlayhints';

export class DebugPoller {
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private currentSession: vscode.DebugSession | undefined;
  private inlayHintsProvider: any;

  constructor(inlayHintsProvider: any) {
    this.inlayHintsProvider = inlayHintsProvider;
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

    // Update inlay hints data
    updateInlayHintData(variables, this.currentSession);
    this.inlayHintsProvider.refresh();
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
    // Clear inlay hints data
    updateInlayHintData({}, undefined);
    this.inlayHintsProvider.refresh();
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
