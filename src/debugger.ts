import * as vscode from 'vscode';

export interface VariableInfo {
  value: string;
  variablesReference?: number;
}

export interface DebugVariables {
  [key: string]: VariableInfo;
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
          variables[v.name] = {
            value: v.value,
            variablesReference: v.variablesReference,
          };
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
 * Fetch properties of an object given its variablesReference
 */
export async function getObjectProperties(
  session: vscode.DebugSession,
  variablesReference: number,
): Promise<Array<{ name: string; value: string; variablesReference?: number }>> {
  try {
    const response = await session.customRequest('variables', {
      variablesReference: variablesReference,
    });

    if (response?.variables) {
      return response.variables
        .filter((v: any) => {
          // Filter out special properties like Raw View, Results View, etc.
          if (v.name === 'Raw View' || v.name === 'Results View') {
            return false;
          }
          // Filter out private/internal properties (starting with underscore or special chars)
          if (v.name.startsWith('_') || v.name.startsWith('[')) {
            return false;
          }
          return true;
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

/**
 * Recursively serialize an object to JSON-like structure
 */
export async function serializeObjectToJson(
  session: vscode.DebugSession,
  variablesReference: number,
  depth: number = 0,
  maxDepth: number = 5,
): Promise<any> {
  if (depth >= maxDepth) {
    return '{ ... }'; // Prevent infinite recursion
  }

  try {
    const properties = await getObjectProperties(session, variablesReference);
    const result: any = {};

    for (const prop of properties) {
      // Clean property name - remove quotes and type annotation like " [int]"
      let cleanName = prop.name.trim();

      // Remove type annotation in brackets: "MyProp {MyClass}" -> "MyProp"
      cleanName = cleanName.replace(/\s*\{.*\}.*$/, '');

      // Remove type annotation with brackets: "MyProp [int]" -> "MyProp"
      cleanName = cleanName.replace(/\s*\[.*\].*$/, '');

      // Remove everything after the first space
      if (cleanName.includes(' ')) {
        cleanName = cleanName.split(' ')[0];
      }

      // Remove surrounding quotes if present
      cleanName = cleanName.replace(/^["'](.*)["']$/, '$1').trim();

      // If property has a variablesReference, it's an object/array
      if (prop.variablesReference && prop.variablesReference > 0) {
        // Recursively serialize nested objects
        result[cleanName] = await serializeObjectToJson(
          session,
          prop.variablesReference,
          depth + 1,
          maxDepth,
        );
      } else {
        // Parse primitive values - try to convert to proper types
        const value = prop.value;

        // Try to parse as number
        if (!isNaN(Number(value)) && value !== '') {
          result[cleanName] = Number(value);
        }
        // Try to parse as boolean
        else if (value === 'true' || value === 'false') {
          result[cleanName] = value === 'true';
        }
        // Try to parse as null
        else if (value === 'null') {
          result[cleanName] = null;
        }
        // Keep as string, but remove quotes if present
        else {
          result[cleanName] = value.replace(/^"(.*)"$/, '$1');
        }
      }
    }

    return result;
  } catch (error) {
    return '{ error }';
  }
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
