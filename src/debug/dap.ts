import * as vscode from 'vscode';

/**
 * Get the current frameId from the active debug session
 */
export async function getCurrentFrameId(session: vscode.DebugSession): Promise<number | null> {
  try {
    const threadsResponse = await session.customRequest('threads', {});
    if (!threadsResponse?.threads || threadsResponse.threads.length === 0) {
      return null;
    }

    const stackTraceResponse = await session.customRequest('stackTrace', {
      threadId: threadsResponse.threads[0].id,
    });

    if (!stackTraceResponse?.stackFrames || stackTraceResponse.stackFrames.length === 0) {
      return null;
    }

    return stackTraceResponse.stackFrames[0].id;
  } catch (error) {
    return null;
  }
}
