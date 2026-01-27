import * as vscode from 'vscode';
import { getCurrentFrameId, getVariablesForFrame } from './debugService';
import { POLL_INTERVAL_MS } from '../config/constants';
import { updateInlayHintData, DebugInlayHintsProvider } from '../providers/inlayHintsProvider';

/**
 * Manages polling for debug variables and updating inlay hints
 */
export class DebugPoller {
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private currentSession: vscode.DebugSession | undefined;
  private readonly inlayHintsProvider: DebugInlayHintsProvider;

  constructor(inlayHintsProvider: DebugInlayHintsProvider) {
    this.inlayHintsProvider = inlayHintsProvider;
  }

  /**
   * Single poll cycle - check if debugger is paused and update hints
   */
  private async poll(): Promise<void> {
    if (!this.currentSession || !vscode.window.activeTextEditor) {
      return;
    }

    const frameId = await getCurrentFrameId(this.currentSession);
    if (frameId === null) {
      return;
    }

    const variables = await getVariablesForFrame(this.currentSession, frameId);
    if (Object.keys(variables).length === 0) {
      return;
    }

    updateInlayHintData(variables, this.currentSession);
    this.inlayHintsProvider.refresh();
  }

  /**
   * Start polling for debug variables
   */
  startPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    this.pollInterval = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  /**
   * Stop polling and clear hints
   */
  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    updateInlayHintData({}, undefined);
    this.inlayHintsProvider.refresh();
  }

  /**
   * Update the active debug session
   */
  setSession(session: vscode.DebugSession | undefined): void {
    this.currentSession = session;
  }

  /**
   * Get the active debug session
   */
  getSession(): vscode.DebugSession | undefined {
    return this.currentSession;
  }
}
