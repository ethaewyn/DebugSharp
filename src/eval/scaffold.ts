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
const SCAFFOLD_HEADER = '// DebugSharp: auto-generated evaluation context';

// Identifiers for the generated wrapper. The class and method names must differ
// from each other, and all three are prefixed to avoid colliding with user code.
const SCAFFOLD_CLASS = '__DebugSharpEval';
const SCAFFOLD_METHOD = 'Evaluate';
const SCAFFOLD_RESULT = '__debugSharpResult';

/** Name of the temporary evaluation file written into the debugged project */
export const EVAL_FILE_NAME = '.vscode-debug-eval.cs';

// Cache for project namespace scan results, keyed by project directory path
const projectNamespaceCache = new Map<string, string[]>();

/**
 * Keep the namespace cache honest: a namespace added, renamed or removed in a
 * .cs file must show up in the next scaffold.
 *
 * Only the owning project's entry is dropped, and the eval scaffold itself is
 * ignored — it's rewritten on every debugger stop, so reacting to it would
 * rescan the project on every single step.
 */
export function initializeScaffoldGenerator(context: vscode.ExtensionContext): void {
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.cs');

  const invalidate = (uri: vscode.Uri) => {
    if (path.basename(uri.fsPath) === EVAL_FILE_NAME) return;

    for (const projectDir of projectNamespaceCache.keys()) {
      if (uri.fsPath.startsWith(projectDir + path.sep)) {
        projectNamespaceCache.delete(projectDir);
      }
    }
  };

  watcher.onDidCreate(invalidate);
  watcher.onDidChange(invalidate);
  watcher.onDidDelete(invalidate);

  context.subscriptions.push(watcher);
}

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
  preferredFrameId?: number,
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

    const targetFrame = selectFrame(frames, preferredFrameId);
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
 * Choose which stack frame the scaffold should describe.
 *
 * The frame VS Code has focused always wins — it's the frame the Debug Console
 * evaluates against, so anything else would show variables from one frame while
 * evaluating in another.
 *
 * Without one, use the frame the debugger actually stopped on. Only when that
 * frame has no source at all (stopped inside framework code) do we walk
 * outwards for user code. Walking outwards by default used to step straight
 * past lambda frames — their compiler-generated source often doesn't resolve on
 * disk — and describe the enclosing method instead.
 */
function selectFrame(frames: any[], preferredFrameId?: number): any {
  if (preferredFrameId !== undefined) {
    const preferred = frames.find(f => f.id === preferredFrameId);
    if (preferred) return preferred;
  }

  if (frames[0]?.source) return frames[0];

  return frames.find(f => f.source?.path && fs.existsSync(f.source.path)) ?? frames[0];
}

/**
 * Fetch all variables with their types from the current debug frame scopes.
 * Handles regular locals, closure-captured variables, and 'this' member expansion.
 */
async function getScopeVariables(
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
 * Compiler-generated closure plumbing. Inside a lambda, `this` is a display
 * class rather than the user's object: the enclosing instance hides in
 * `<>4__this`, and outer scopes hide in `CS$<>8__locals1`. Neither is a legal
 * C# identifier, so they have to be expanded through rather than declared —
 * otherwise everything the lambda captured is invisible in the scaffold.
 */
const CLOSURE_PLUMBING = /^(CS\$)?<>[\w$]*__(this|locals\d*)$/;

/** Guards against cycles in deeply nested closures */
const MAX_CLOSURE_DEPTH = 3;

/**
 * Expand 'this' members into top-level variable declarations.
 * This lets users access instance fields/properties directly in the eval file.
 */
async function expandThisMembers(
  session: vscode.DebugSession,
  variablesReference: number,
  variables: ScopeVariable[],
  seenNames: Set<string>,
  depth: number = 0,
): Promise<void> {
  try {
    const response = await session.customRequest('variables', { variablesReference });
    for (const member of response?.variables || []) {
      const rawName = member.name ?? '';
      const name = rawName.split(/[\s{\[]/)[0].trim();
      if (!name) continue;

      // Step through the closure to reach what the lambda actually captured
      if (CLOSURE_PLUMBING.test(name)) {
        if (member.variablesReference > 0 && depth < MAX_CLOSURE_DEPTH) {
          await expandThisMembers(
            session,
            member.variablesReference,
            variables,
            seenNames,
            depth + 1,
          );
        }
        continue;
      }

      if (seenNames.has(name)) continue;
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
 * The path comes from the stack frame resolved by getFrameAndVariables().
 */
export function getSourceFileUsings(sourcePath: string | undefined): string[] {
  if (!sourcePath || !fs.existsSync(sourcePath)) return [];

  try {
    const sourceContent = fs.readFileSync(sourcePath, 'utf8');
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
 * Scan all .cs files in the project directory for namespace declarations.
 * Returns an array of `using X.Y.Z;` strings for every unique namespace found.
 * Results are cached per projectDir for the lifetime of the extension host.
 */
export function getProjectNamespaces(projectDir: string): string[] {
  if (projectNamespaceCache.has(projectDir)) {
    return projectNamespaceCache.get(projectDir)!;
  }

  const namespaces = new Set<string>();
  const namespaceRegex = /^\s*namespace\s+([\w.]+)\s*[;{]/gm;

  function scanDirectory(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const lower = entry.name.toLowerCase();
        if (lower === 'bin' || lower === 'obj' || entry.name.startsWith('.')) {
          continue;
        }
        scanDirectory(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.cs')) {
        if (entry.name === EVAL_FILE_NAME) {
          continue;
        }
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          namespaceRegex.lastIndex = 0;
          let match;
          while ((match = namespaceRegex.exec(content)) !== null) {
            namespaces.add(match[1]);
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  scanDirectory(projectDir);

  const usings = Array.from(namespaces).map(ns => `using ${ns};`);
  projectNamespaceCache.set(projectDir, usings);
  return usings;
}

/**
 * Generate the complete C# scaffold content
 *
 * The scaffold is a real file inside the user's project — that's what gives
 * Roslyn the project references and types needed for IntelliSense — so it has
 * to stay compilable. Two details matter:
 *
 *  - The class and method names must differ (`class _ { void _() {` is CS0542,
 *    "member names cannot be the same as their enclosing type").
 *  - The expression sits in an array initializer rather than bare in the method
 *    body. A bare expression is not a statement (CS1002), which leaves a broken
 *    *parse tree* — and Roslyn can't complete against a tree it couldn't parse.
 *    Inside the initializer, a half-typed expression is only a *binding* error,
 *    so the tree stays intact and Ctrl+Space keeps working.
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

  // Generate typed variable declarations. Types are re-sanitized here rather
  // than trusted from the caller: this function is the last point that can
  // guarantee the file parses, and one bad declaration costs IntelliSense for
  // every variable in the scaffold.
  const varDeclarations = variables
    .filter(v => isValidCSharpIdentifier(v.name))
    .map(v => `    ${sanitizeType(v.type)} ${v.name} = default!;`)
    .join('\n');
  const varSection = varDeclarations ? `\n${varDeclarations}` : '';

  // Ensure user expression has proper newlines
  const exprContent = userExpression ? `\n${userExpression}` : '\n    ';

  const usingSection = usingBlock ? `\n${usingBlock}\n` : '\n';

  return `${SCAFFOLD_HEADER}
#pragma warning disable
#nullable disable${usingSection}
class ${SCAFFOLD_CLASS} { void ${SCAFFOLD_METHOD}() {${varSection}
    var ${SCAFFOLD_RESULT} = new object[] {
    ${EXPR_START}${exprContent}
    ${EXPR_END}
    };
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
 *
 * This is deliberately strict. Every variable becomes a declaration in a single
 * shared file, so one malformed type name is a syntax error that invalidates
 * the whole scaffold — and with it IntelliSense for every other variable.
 * Losing member completion on one `dynamic` is far cheaper than that.
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

  // CLR spells nested types Outer+Inner; C# spells them Outer.Inner
  t = t.replace(/\+/g, '.');

  // Byref/pointer decorations have no place in a local declaration
  t = t.replace(/[&*]+$/, '');

  // Whitelist: identifiers, namespace dots, generics, arrays, nullable and the
  // spaces that separate generic arguments. Anything else → dynamic.
  if (!/^[\w.<>,\[\]?\s]+$/.test(t)) return 'dynamic';

  // Square brackets may only form array ranks — `[]`, `[,]`, `[][]`. The CLR's
  // generic spelling (Dictionary`2[[System.String],[System.Int32]]) passes the
  // whitelist but is not C#, so reject any bracket holding a type argument.
  if (/\[[^\],]/.test(t)) return 'dynamic';

  // Brackets must balance, or the declaration won't parse
  if (!isBalanced(t)) return 'dynamic';

  return t.trim() || 'dynamic';
}

/**
 * Check that <> and [] pairs balance in a type name.
 */
function isBalanced(type: string): boolean {
  let angle = 0;
  let square = 0;

  for (const ch of type) {
    if (ch === '<') angle++;
    else if (ch === '>') angle--;
    else if (ch === '[') square++;
    else if (ch === ']') square--;
    if (angle < 0 || square < 0) return false;
  }

  return angle === 0 && square === 0;
}

/**
 * Check if a string is a valid C# identifier
 */
function isValidCSharpIdentifier(name: string): boolean {
  return /^[a-zA-Z_@]\w*$/.test(name);
}
