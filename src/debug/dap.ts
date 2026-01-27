import * as vscode from 'vscode';
import { DebugVariables } from '../models/DebugVariables';
import { DebugVariable } from '../models/DebugVariable';

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

/**
 * Get all local variables from current debug frame
 */
export async function getVariablesForFrame(
  session: vscode.DebugSession,
  frameId: number,
): Promise<DebugVariables> {
  const variables: DebugVariables = {};

  try {
    const scopesResponse = await session.customRequest('scopes', { frameId });

    if (scopesResponse?.scopes && scopesResponse.scopes.length > 0) {
      const scope = scopesResponse.scopes[0];
      const varsResponse = await session.customRequest('variables', {
        variablesReference: scope.variablesReference,
      });

      if (varsResponse?.variables) {
        varsResponse.variables.forEach((v: any) => {
          variables[v.name] = {
            value: v.value,
            variablesReference: v.variablesReference,
          };
        });
      }
    }
  } catch (error) {
    return {};
  }

  return variables;
}

/**
 * Fetch properties of an object given its variablesReference
 */
export async function getObjectProperties(
  session: vscode.DebugSession,
  variablesReference: number,
): Promise<DebugVariable[]> {
  try {
    const response = await session.customRequest('variables', {
      variablesReference: variablesReference,
    });

    if (response?.variables) {
      return response.variables
        .filter((v: any) => {
          return (
            v.name !== 'Raw View' &&
            v.name !== 'Results View' &&
            !v.name.startsWith('_') &&
            !v.name.startsWith('[')
          );
        })
        .map((v: any) => ({
          name: v.name,
          value: v.value,
          variablesReference: v.variablesReference,
        }));
    }
  } catch (error) {
    // Fail silently
  }

  return [];
}
