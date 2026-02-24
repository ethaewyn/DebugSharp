/**
 * Scaffold Generator for Evaluation Context
 *
 * Generates a C# scaffold file with typed variable declarations from the
 * current debug scope. This enables Roslyn's language server to provide
 * full IntelliSense (member access, LINQ, lambdas, etc.) in the eval file.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Markers that delimit the user's expression area in the scaffold
export const EXPR_START = '// --- expression start ---';
export const EXPR_END = '// --- expression end ---';

// Header comment to identify scaffold files
export const SCAFFOLD_HEADER = '// DebugSharp: auto-generated evaluation context';

export interface ScopeVariable {
  name: string;
  type: string;
}

/**
 * Get the frame ID and variables for a specific thread in a single atomic sequence.
 * This avoids the stale-reference problem that occurs when stackTrace is called
 * repeatedly (as in polling), since each stackTrace call can allocate new IDs.
 */
export async function getFrameAndVariables(
  session: vscode.DebugSession,
  threadId: number,
): Promise<{ frameId: number; variables: ScopeVariable[]; sourcePath?: string } | null> {
  try {
    // Single stackTrace call — frame IDs are valid until next continued event
    const stackResponse = await session.customRequest('stackTrace', {
      threadId,
      startFrame: 0,
      levels: 20, // Get enough frames to find user code
    });

    const frames = stackResponse?.stackFrames;
    if (!frames || frames.length === 0) {
      console.log('[DebugSharp] No stack frames for thread', threadId);
      return null;
    }

    // Find the first user-code frame (has a source with path on disk)
    let targetFrame = frames[0];
    for (const frame of frames) {
      if (frame.source?.path && fs.existsSync(frame.source.path)) {
        targetFrame = frame;
        break;
      }
    }

    const frameId = targetFrame.id;
    const sourcePath = targetFrame.source?.path;

    const variables = await getScopeVariables(session, frameId);

    return { frameId, variables, sourcePath };
  } catch (error) {
    console.error('[DebugSharp] Error getting frame/variables for thread:', threadId, error);
    return null;
  }
}

/**
 * Fetch all variables with their types from the current debug frame scopes.
 * Handles regular locals, closure-captured variables, and 'this' member expansion.
 */
export async function getScopeVariables(
  session: vscode.DebugSession,
  frameId: number,
): Promise<ScopeVariable[]> {
  const variables: ScopeVariable[] = [];
  const seenNames = new Set<string>();

  function addVariable(rawName: string, type: string | undefined): void {
    // DAP variable names can contain extra info (e.g., "name {Type}" or "name [0]")
    // Extract just the identifier part
    const name = rawName.split(/[\s{\[]/)[0].trim();

    if (!name || name.startsWith('$') || seenNames.has(name)) return;
    if (!isValidCSharpIdentifier(name)) return;

    const sanitized = sanitizeType(type);
    seenNames.add(name);
    variables.push({ name, type: sanitized });
  }

  try {
    const scopesResponse = await session.customRequest('scopes', { frameId });
    const scopes = scopesResponse?.scopes || [];

    for (const scope of scopes) {
      if (scope.variablesReference <= 0) continue;

      const varsResponse = await session.customRequest('variables', {
        variablesReference: scope.variablesReference,
      });

      const vars = varsResponse?.variables || [];

      for (const v of vars) {
        // Expand 'this' — add its members as accessible variables
        if (v.name === 'this' && v.variablesReference > 0) {
          await expandThisMembers(session, v.variablesReference, variables, seenNames);
          continue;
        }

        addVariable(v.name, v.type);
      }
    }
  } catch (error) {
    console.error('[DebugSharp] Error fetching scope variables:', error);
  }

  return variables;
}

/**
 * Expand 'this' members into top-level variable declarations.
 * This lets users access instance fields/properties directly in the eval file.
 */
async function expandThisMembers(
  session: vscode.DebugSession,
  variablesReference: number,
  variables: ScopeVariable[],
  seenNames: Set<string>,
): Promise<void> {
  try {
    const response = await session.customRequest('variables', { variablesReference });
    for (const member of response?.variables || []) {
      const name = member.name?.split(/[\s{\[]/)[0].trim();
      if (!name || seenNames.has(name)) continue;
      if (name === 'Raw View' || name === 'Static members') continue;
      if (!isValidCSharpIdentifier(name)) continue;

      const type = sanitizeType(member.type);
      seenNames.add(name);
      variables.push({ name, type });
    }
  } catch {
    // Fail silently — this members aren't critical
  }
}

/**
 * Extract using directives from the source file at the current debug frame.
 * Accepts an optional sourcePath to avoid making additional stackTrace calls.
 */
export async function getSourceFileUsings(
  session: vscode.DebugSession,
  frameId: number,
  sourcePath?: string,
): Promise<string[]> {
  try {
    // Use provided sourcePath or discover it from the stack trace
    let resolvedPath = sourcePath;
    if (!resolvedPath) {
      const threadsResponse = await session.customRequest('threads', {});
      if (!threadsResponse?.threads?.length) return [];

      const stackTraceResponse = await session.customRequest('stackTrace', {
        threadId: threadsResponse.threads[0].id,
      });

      resolvedPath = stackTraceResponse?.stackFrames?.[0]?.source?.path;
    }

    if (!resolvedPath || !fs.existsSync(resolvedPath)) return [];

    const sourceContent = fs.readFileSync(resolvedPath, 'utf8');
    const usings: string[] = [];

    // Match using directives: regular, global, static, and aliases
    const usingRegex = /^\s*(global\s+)?using\s+(static\s+)?[^;]+;/gm;
    let match;
    while ((match = usingRegex.exec(sourceContent)) !== null) {
      usings.push(match[0].trim());
    }

    return usings;
  } catch {
    return [];
  }
}

/**
 * Search for global usings files in the project (GlobalUsings.cs, *.GlobalUsings.g.cs)
 */
export async function getProjectGlobalUsings(projectDir: string): Promise<string[]> {
  const usings: string[] = [];

  try {
    // Look for GlobalUsings.cs in project root
    const globalUsingsPath = path.join(projectDir, 'GlobalUsings.cs');
    if (fs.existsSync(globalUsingsPath)) {
      const content = fs.readFileSync(globalUsingsPath, 'utf8');
      const regex = /^\s*global\s+using\s+[^;]+;/gm;
      let match;
      while ((match = regex.exec(content)) !== null) {
        usings.push(match[0].trim());
      }
    }

    // Look for auto-generated global usings in obj/
    const objDir = path.join(projectDir, 'obj');
    if (fs.existsSync(objDir)) {
      const findGlobalUsings = (dir: string): void => {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              findGlobalUsings(fullPath);
            } else if (entry.name.endsWith('.GlobalUsings.g.cs')) {
              const content = fs.readFileSync(fullPath, 'utf8');
              const regex = /^\s*global\s+using\s+[^;]+;/gm;
              let match;
              while ((match = regex.exec(content)) !== null) {
                usings.push(match[0].trim());
              }
            }
          }
        } catch {
          // Directory might not be accessible
        }
      };
      findGlobalUsings(objDir);
    }
  } catch {
    // Fail silently
  }

  return usings;
}

/**
 * Generate the complete C# scaffold content
 *
 * @param variables - Variables from current debug scope with their types
 * @param usings - Using directives to include
 * @param userExpression - User's expression to preserve between markers
 */
export function generateScaffold(
  variables: ScopeVariable[],
  usings: string[],
  userExpression: string = '',
): string {
  // Deduplicate and sort usings (source-file usings only — global usings are already project-wide)
  const usingBlock = [...new Set(usings)].sort().join('\n');

  // Generate typed variable declarations
  const varDeclarations = variables.map(v => `    ${v.type} ${v.name} = default!;`).join('\n');
  const varSection = varDeclarations ? `\n${varDeclarations}` : '';

  // Ensure user expression has proper newlines
  const exprContent = userExpression ? `\n${userExpression}` : '\n    ';

  const usingSection = usingBlock ? `\n${usingBlock}\n` : '\n';

  return `${SCAFFOLD_HEADER}
#pragma warning disable
#nullable disable${usingSection}
class _ { void _() {${varSection}
    ${EXPR_START}${exprContent}
    ${EXPR_END}
}}
`;
}

/**
 * Extract the user's expression from scaffold file content
 */
export function extractUserExpression(content: string): string {
  const startIdx = content.indexOf(EXPR_START);
  const endIdx = content.lastIndexOf(EXPR_END);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    // Not a scaffold file — treat entire content as the expression
    return content.trim();
  }

  // Get text between the end of the start marker line and the start of the end marker line
  const afterStart = content.indexOf('\n', startIdx);
  if (afterStart === -1 || afterStart >= endIdx) return '';

  const expression = content.substring(afterStart + 1, endIdx);

  // Remove trailing whitespace/newlines but preserve internal structure
  return expression.trimEnd();
}

/**
 * Check if file content contains our scaffold markers
 */
export function isScaffoldFile(content: string): boolean {
  return content.startsWith(SCAFFOLD_HEADER);
}

// ─── Private utilities ───────────────────────────────────────────────

/**
 * Sanitize a debugger type string into valid C# type syntax.
 * Falls back to 'dynamic' for unresolvable types.
 */
function sanitizeType(type: string | undefined): string {
  if (!type || type === '<error>' || type === 'void') return 'dynamic';

  let t = type
    .replace(/\{[^}]*\}/, '') // Remove inline debug values like {Count = 3}
    .trim();

  if (!t) return 'dynamic';

  // Compiler-generated / anonymous types → dynamic
  if (t.includes('<>') || t.startsWith('<')) return 'dynamic';

  // Remove assembly qualifiers outside of generic args
  // e.g., "MyType, MyAssembly" → "MyType"
  if (t.includes(',') && !t.includes('<')) {
    t = t.split(',')[0].trim();
  }

  // Remove backtick generic arity notation (e.g., List`1)
  t = t.replace(/`\d+/g, '');

  // Handle nullable display like "int?" or "Nullable<int>"
  // These are valid C# syntax, keep as-is

  // Final validation: reject types with obviously invalid C# characters
  if (/[#$@!%^&=|\\;]/.test(t)) return 'dynamic';

  return t || 'dynamic';
}

/**
 * Check if a string is a valid C# identifier
 */
function isValidCSharpIdentifier(name: string): boolean {
  return /^[a-zA-Z_@]\w*$/.test(name);
}
