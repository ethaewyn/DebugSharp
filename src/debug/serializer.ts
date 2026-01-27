import * as vscode from 'vscode';
import { MAX_OBJECT_DEPTH } from '../config/constants';
import { getObjectProperties } from './dap';

/**
 * Recursively serialize object to JSON (up to maxDepth)
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
        result[cleanName] = await serializeObjectToJson(
          session,
          prop.variablesReference,
          depth + 1,
          maxDepth,
        );
      } else {
        result[cleanName] = parsePrimitiveValue(prop.value);
      }
    }

    return result;
  } catch (error) {
    return '{ error }';
  }
}

function cleanPropertyName(name: string): string {
  return name
    .trim()
    .replace(/\s*\{.*\}.*$/, '')
    .replace(/\s*\[.*\].*$/, '')
    .split(' ')[0]
    .replace(/^["'](.*)["']$/, '$1');
}

function parsePrimitiveValue(value: string): any {
  if (!isNaN(Number(value)) && value !== '') return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  return value.replace(/^"(.*)"$/, '$1');
}
