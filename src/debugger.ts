import * as vscode from 'vscode';

export interface DebugVariables {
  [key: string]: string;
}

/**
 * Get all local variables from the current debug frame
 */
export async function getVariablesForFrame(
  session: vscode.DebugSession,
  frameId: number,
): Promise<DebugVariables> {
  const variables: DebugVariables = {};

  try {
    // Request scopes with valid frameId
    const scopesResponse = await session.customRequest('scopes', {
      frameId: frameId,
    });

    if (scopesResponse?.scopes && scopesResponse.scopes.length > 0) {
      // Get local variables from first scope
      const scope = scopesResponse.scopes[0];

      const varsResponse = await session.customRequest('variables', {
        variablesReference: scope.variablesReference,
      });

      if (varsResponse?.variables) {
        varsResponse.variables.forEach((v: any) => {
          variables[v.name] = v.value;
        });
      }
    }
  } catch (error: any) {
    // Fail silently - frame may be invalid
    return {};
  }

  return variables;
}

/**
 * Get the current frameId from the active debug session
 */
export async function getCurrentFrameId(session: vscode.DebugSession): Promise<number | null> {
  try {
    // Step 1: Get threads
    const threadsResponse = await session.customRequest('threads', {});
    if (!threadsResponse?.threads || threadsResponse.threads.length === 0) {
      return null;
    }

    const threadId = threadsResponse.threads[0].id;

    // Step 2: Get stack trace for the thread
    const stackTraceResponse = await session.customRequest('stackTrace', {
      threadId: threadId,
    });

    if (!stackTraceResponse?.stackFrames || stackTraceResponse.stackFrames.length === 0) {
      return null;
    }

    return stackTraceResponse.stackFrames[0].id;
  } catch (error: any) {
    // Still running or other error
    return null;
  }
}
