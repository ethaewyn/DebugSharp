import * as vscode from 'vscode';
import { MAX_OBJECT_DEPTH } from '../config/constants';
import { DebugVariables, DebugVariable, EvaluationResult } from '../models/debugModels';

/**
 * Service for interacting with the Debug Adapter Protocol (DAP)
 */

/**
 * Get the current frameId from the active debug session
 */
export async function getCurrentFrameId(session: vscode.DebugSession): Promise<number | null> {
  try {
    const threadsResponse = await session.customRequest('threads', {});
    if (!threadsResponse?.threads || threadsResponse.threads.length === 0) {
      return null;
    }

    const threadId = threadsResponse.threads[0].id;

    const stackTraceResponse = await session.customRequest('stackTrace', {
      threadId: threadId,
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
 * Get all local variables from the current debug frame
 */
export async function getVariablesForFrame(
  session: vscode.DebugSession,
  frameId: number,
): Promise<DebugVariables> {
  const variables: DebugVariables = {};

  try {
    const scopesResponse = await session.customRequest('scopes', {
      frameId: frameId,
    });

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
 * Filters out debugger-specific properties like "Raw View" and private fields
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
          // Filter out debugger-specific views
          if (v.name === 'Raw View' || v.name === 'Results View') {
            return false;
          }
          // Filter out private/internal properties
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
 * Clean property name by removing type annotations and quotes
 * Examples:
 *   "MyProp {MyClass}" -> "MyProp"
 *   "MyProp [int]" -> "MyProp"
 *   '"MyProp"' -> "MyProp"
 */
function cleanPropertyName(name: string): string {
  let cleanName = name.trim();

  // Remove type annotation in braces: "MyProp {MyClass}" -> "MyProp"
  cleanName = cleanName.replace(/\s*\{.*\}.*$/, '');

  // Remove type annotation in brackets: "MyProp [int]" -> "MyProp"
  cleanName = cleanName.replace(/\s*\[.*\].*$/, '');

  // Remove everything after the first space
  if (cleanName.includes(' ')) {
    cleanName = cleanName.split(' ')[0];
  }

  // Remove surrounding quotes if present
  cleanName = cleanName.replace(/^["'](.*)["']$/, '$1').trim();

  return cleanName;
}

/**
 * Parse primitive value from debugger string representation
 * Converts strings to their appropriate types (number, boolean, null)
 */
function parsePrimitiveValue(value: string): any {
  // Try to parse as number
  if (!isNaN(Number(value)) && value !== '') {
    return Number(value);
  }

  // Try to parse as boolean
  if (value === 'true' || value === 'false') {
    return value === 'true';
  }

  // Try to parse as null
  if (value === 'null') {
    return null;
  }

  // Keep as string, but remove quotes if present
  return value.replace(/^"(.*)"$/, '$1');
}

/**
 * Recursively serialize an object to JSON structure
 * Handles nested objects up to maxDepth to prevent infinite recursion
 */
export async function serializeObjectToJson(
  session: vscode.DebugSession,
  variablesReference: number,
  depth: number = 0,
  maxDepth: number = MAX_OBJECT_DEPTH,
): Promise<any> {
  if (depth >= maxDepth) {
    return '{ ... }';
  }

  try {
    const properties = await getObjectProperties(session, variablesReference);
    const result: any = {};

    for (const prop of properties) {
      const cleanName = cleanPropertyName(prop.name);

      if (prop.variablesReference && prop.variablesReference > 0) {
        // Recursively serialize nested objects
        result[cleanName] = await serializeObjectToJson(
          session,
          prop.variablesReference,
          depth + 1,
          maxDepth,
        );
      } else {
        // Parse primitive values with proper type conversion
        result[cleanName] = parsePrimitiveValue(prop.value);
      }
    }

    return result;
  } catch (error) {
    return '{ error }';
  }
}

/**
 * Evaluate an expression in the current debug context
 */
export async function evaluateExpression(
  session: vscode.DebugSession,
  frameId: number,
  expression: string,
): Promise<EvaluationResult | null> {
  try {
    const result = await session.customRequest('evaluate', {
      expression: expression,
      frameId: frameId,
      context: 'watch',
    });

    if (result?.result) {
      return {
        result: result.result,
        type: result.type,
        variablesReference: result.variablesReference,
      };
    }

    if (result?.error) {
      return {
        result: `Error: ${result.error}`,
      };
    }

    return null;
  } catch (error: any) {
    return {
      result: `Error: ${error?.message || 'Failed to evaluate expression'}`,
    };
  }
}
