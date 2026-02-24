/**
 * Debug State Tracker
 *
 * Uses DebugAdapterTracker to intercept DAP protocol messages and reliably
 * detect when the debugger is stopped. This avoids the problems of polling
 * (stale frame IDs, variable references invalidated by repeated stackTrace calls).
 *
 * When a 'stopped' event is received, we make a single set of DAP calls to
 * get the current frame, scopes, and variables — then update the scaffold.
 */
import * as vscode from 'vscode';

export type StoppedCallback = (session: vscode.DebugSession, threadId: number) => Promise<void>;

/**
 * Last known stopped state — set by the tracker when the debugger hits a
 * breakpoint/step, cleared on continue/terminate. This is the single
 * source of truth for the current frame ID, avoiding stale references
 * from repeated stackTrace calls.
 */
let lastStoppedState:
  | {
      session: vscode.DebugSession;
      frameId: number;
      threadId: number;
    }
  | undefined;

/**
 * Get the last known stopped state (frameId, threadId, session).
 * Returns undefined if the debugger is not currently stopped.
 */
export function getLastStoppedState() {
  return lastStoppedState;
}

/**
 * Update the stored frame ID (called from the tracker callback after
 * the scaffold has been resolved).
 */
export function setLastStoppedFrameId(
  session: vscode.DebugSession,
  frameId: number,
  threadId: number,
): void {
  lastStoppedState = { session, frameId, threadId };
}

/**
 * Clear the stopped state (called on continue, terminate, or session end).
 */
export function clearStoppedState(): void {
  lastStoppedState = undefined;
}

/**
 * Tracker that intercepts DAP messages for a single debug session.
 */
class CSharpDebugTracker implements vscode.DebugAdapterTracker {
  private readonly session: vscode.DebugSession;
  private readonly onStopped: StoppedCallback;

  constructor(session: vscode.DebugSession, onStopped: StoppedCallback) {
    this.session = session;
    this.onStopped = onStopped;
  }

  onDidSendMessage(message: any): void {
    if (!message || message.type !== 'event') return;

    if (message.event === 'stopped') {
      const threadId = message.body?.threadId ?? 1;

      // Small delay to let the debug adapter finish processing the stop
      // (ensures variable references are fully allocated)
      setTimeout(() => {
        this.onStopped(this.session, threadId).catch(err => {
          console.error('[DebugSharp] Error in stopped callback:', err);
        });
      }, 50);
    } else if (message.event === 'continued') {
      clearStoppedState();
    } else if (message.event === 'terminated' || message.event === 'exited') {
      clearStoppedState();
    }
  }
}

/**
 * Register a DebugAdapterTrackerFactory for C# debug sessions.
 *
 * @param onStopped - Callback invoked when the debugger stops at a breakpoint/step
 * @returns Disposable to unregister the factory
 */
export function registerDebugTracker(onStopped: StoppedCallback): vscode.Disposable {
  const factory: vscode.DebugAdapterTrackerFactory = {
    createDebugAdapterTracker(
      session: vscode.DebugSession,
    ): vscode.ProviderResult<vscode.DebugAdapterTracker> {
      // Only track C# debug sessions (coreclr, dotnet, etc.)
      const type = session.type?.toLowerCase() || '';
      if (type === 'coreclr' || type === 'dotnet' || type === 'clr') {
        return new CSharpDebugTracker(session, onStopped);
      }
      return undefined;
    },
  };

  // Register for all debug types — the factory filters to C# sessions
  return vscode.debug.registerDebugAdapterTrackerFactory('*', factory);
}
