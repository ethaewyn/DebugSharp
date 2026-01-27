import * as vscode from 'vscode';
import { getCurrentFrameId, getVariablesForFrame } from './dap';
import { POLL_INTERVAL_MS } from '../config/constants';
import { updateInlayHintData } from '../ui/inlayHints/provider';
import type { DebugInlayHintsProvider } from '../ui/inlayHints/provider';

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

  startPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    this.pollInterval = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    updateInlayHintData({}, undefined);
    this.inlayHintsProvider.refresh();
  }

  setSession(session: vscode.DebugSession | undefined): void {
    this.currentSession = session;
  }

  getSession(): vscode.DebugSession | undefined {
    return this.currentSession;
  }
}
