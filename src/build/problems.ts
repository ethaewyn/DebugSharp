/**
 * Problems Reporting
 *
 * Parses dotnet build/test output and publishes errors to the VS Code Problems panel
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Diagnostic collection for build errors
let buildDiagnostics: vscode.DiagnosticCollection | undefined;

/**
 * Initialize the diagnostic collection
 */
export function initializeDiagnostics(context: vscode.ExtensionContext): void {
  buildDiagnostics = vscode.languages.createDiagnosticCollection('csharp-build');
  context.subscriptions.push(buildDiagnostics);
}

/**
 * Clear all build diagnostics
 */
export function clearDiagnostics(): void {
  if (buildDiagnostics) {
    buildDiagnostics.clear();
  }
}

/**
 * Parse dotnet output and publish everything it contains to the Problems panel.
 *
 * `itemPath` is the .csproj/.sln that was built. Diagnostics MSBuild reports
 * against a tool rather than a source file (MSBUILD, CSC, NETSDK, restore
 * failures) are attached to it — they used to be filed against an invented
 * path like `<cwd>/MSBUILD`, which is not a real file, so they never showed up.
 */
export function reportDotnetOutput(
  output: string,
  workingDirectory: string,
  opts: { includeTests?: boolean; itemPath?: string } = {},
): void {
  const merged = parseBuildOutput(output, workingDirectory, opts.itemPath);

  if (opts.includeTests) {
    // Combine arrays for files that have both build and test diagnostics
    for (const [file, diags] of parseTestOutput(output, workingDirectory)) {
      const existing = merged.get(file);
      merged.set(file, existing ? [...existing, ...diags] : diags);
    }
  }

  updateDiagnostics(merged);
}

/**
 * MSBuild's canonical diagnostic format:
 *
 *   <origin> : <severity> <CODE>: <message> [<project>]
 *
 * where `origin` is either a source location — `File.cs(12,5)`, `File.cs(12)`,
 * `File.cs(12,5,12,9)` — or a tool name such as `MSBUILD` or `CSC`.
 */
const DIAGNOSTIC_LINE =
  /^(?<origin>.+?)\s*:\s*(?<severity>error|warning)\s+(?<code>[A-Za-z]+[0-9]+)\s*:\s*(?<message>.*)$/i;

/** `File.cs(line)` / `File.cs(line,col)` / `File.cs(line,col,endLine,endCol)` */
const ORIGIN_WITH_POSITION = /^(?<file>.*?)\((?<line>\d+)(?:,(?<col>\d+))?(?:,\d+,\d+)?\)$/;

/** Trailing ` [C:\path\Project.csproj]` that MSBuild appends to every diagnostic */
const PROJECT_SUFFIX = /\s*\[[^\]]*\.(?:csproj|sln|slnx|slnf|vbproj|fsproj)\]\s*$/i;

interface ParsedDiagnostic {
  /** Absolute path, or undefined when the diagnostic has no source location */
  file?: string;
  line: number;
  column: number;
  severity: vscode.DiagnosticSeverity;
  code: string;
  message: string;
}

/**
 * Parse a single line of MSBuild output into a diagnostic, or undefined when
 * the line isn't one.
 */
function parseDiagnosticLine(line: string, workingDirectory: string): ParsedDiagnostic | undefined {
  const match = line.trim().match(DIAGNOSTIC_LINE);
  if (!match?.groups) return undefined;

  const { origin, severity, code } = match.groups;
  const message = match.groups.message.replace(PROJECT_SUFFIX, '').trim();
  if (!message) return undefined;

  const parsed: ParsedDiagnostic = {
    line: 0,
    column: 0,
    severity:
      severity.toLowerCase() === 'error'
        ? vscode.DiagnosticSeverity.Error
        : vscode.DiagnosticSeverity.Warning,
    code,
    message,
  };

  const position = origin.match(ORIGIN_WITH_POSITION);
  if (position?.groups) {
    parsed.file = resolveFile(position.groups.file, workingDirectory);
    parsed.line = Math.max(0, parseInt(position.groups.line, 10) - 1);
    parsed.column = Math.max(0, parseInt(position.groups.col ?? '1', 10) - 1);
    return parsed;
  }

  // No position — a bare path (e.g. a .csproj for a restore error) still counts
  // as a file; a tool name like MSBUILD or CSC does not.
  const candidate = resolveFile(origin, workingDirectory);
  if (fs.existsSync(candidate)) {
    parsed.file = candidate;
  }

  return parsed;
}

function resolveFile(filePath: string, workingDirectory: string): string {
  const trimmed = filePath.trim();
  return path.isAbsolute(trimmed) ? trimmed : path.join(workingDirectory, trimmed);
}

/**
 * Parse dotnet build/test output and extract errors and warnings
 */
function parseBuildOutput(
  output: string,
  workingDirectory: string,
  itemPath?: string,
): Map<string, vscode.Diagnostic[]> {
  const diagnosticMap = new Map<string, vscode.Diagnostic[]>();

  for (const line of output.split('\n')) {
    const parsed = parseDiagnosticLine(line, workingDirectory);
    if (!parsed) continue;

    // Anything without a source location goes on the project being built, so
    // it is still visible and clickable in the Problems panel
    const target = parsed.file ?? itemPath;
    if (!target) continue;

    const range = new vscode.Range(
      new vscode.Position(parsed.line, parsed.column),
      new vscode.Position(parsed.line, parsed.column + 1),
    );

    const diagnostic = new vscode.Diagnostic(range, parsed.message, parsed.severity);
    diagnostic.code = parsed.code;
    diagnostic.source = 'dotnet build';

    const key = target.replace(/\\/g, '/');
    const existing = diagnosticMap.get(key) ?? [];

    // MSBuild repeats every diagnostic in its end-of-build summary
    const isDuplicate = existing.some(
      d =>
        d.range.start.line === diagnostic.range.start.line &&
        d.range.start.character === diagnostic.range.start.character &&
        d.code === diagnostic.code &&
        d.message === diagnostic.message,
    );

    if (!isDuplicate) {
      existing.push(diagnostic);
      diagnosticMap.set(key, existing);
    }
  }

  return diagnosticMap;
}

function parseTestOutput(
  output: string,
  workingDirectory: string,
): Map<string, vscode.Diagnostic[]> {
  const diagnosticMap = new Map<string, vscode.Diagnostic[]>();
  const lines = output.split('\n');

  // Test failure patterns
  // Format: Failed TestName [duration]
  // Followed by error message and sometimes stack trace with file location

  let currentTestName: string | null = null;
  let currentMessage: string[] = [];
  let currentFilePath: string | null = null;
  let currentLine = 0;

  // Pattern for test failure header: Failed TestName [duration]
  const failurePattern = /^\s*Failed\s+(.+?)\s+\[/i;

  // Pattern for stack trace with file location: at ClassName.Method() in FilePath:line LineNumber
  const stackTracePattern = /^\s*at\s+.+?\s+in\s+(.+?):line\s+(\d+)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for test failure
    const failureMatch = line.match(failurePattern);
    if (failureMatch) {
      // Save previous test failure if any
      if (currentTestName && currentMessage.length > 0) {
        addTestDiagnostic(
          diagnosticMap,
          currentFilePath,
          currentLine,
          currentTestName,
          currentMessage.join('\n'),
          workingDirectory,
        );
      }

      // Start new test failure
      currentTestName = failureMatch[1].trim();
      currentMessage = [];
      currentFilePath = null;
      currentLine = 0;
      continue;
    }

    // Check for stack trace with file location
    const stackMatch = line.match(stackTracePattern);
    if (stackMatch && currentTestName) {
      currentFilePath = stackMatch[1].trim();
      currentLine = parseInt(stackMatch[2], 10) - 1;
    }

    // Collect error message lines (between failure header and next test or end)
    if (currentTestName && line.trim() && !line.match(/^\s*at\s+/) && !failurePattern.test(line)) {
      // Skip stack trace lines that don't have file locations
      if (!line.match(/^\s*at\s+/)) {
        currentMessage.push(line.trim());
      }
    }
  }

  // Save last test failure if any
  if (currentTestName && currentMessage.length > 0) {
    addTestDiagnostic(
      diagnosticMap,
      currentFilePath,
      currentLine,
      currentTestName,
      currentMessage.join('\n'),
      workingDirectory,
    );
  }

  return diagnosticMap;
}

/**
 * Helper to add a test diagnostic
 */
function addTestDiagnostic(
  diagnosticMap: Map<string, vscode.Diagnostic[]>,
  filePath: string | null,
  lineNum: number,
  testName: string,
  message: string,
  workingDirectory: string,
): void {
  let fullPath: string;

  if (filePath) {
    // Resolve relative paths
    if (path.isAbsolute(filePath)) {
      fullPath = filePath;
    } else {
      fullPath = path.join(workingDirectory, filePath);
    }
  } else {
    // No file path, assign to working directory
    fullPath = workingDirectory;
    lineNum = 0;
  }

  // Normalize path separators
  fullPath = fullPath.replace(/\\/g, '/');

  const range = new vscode.Range(
    new vscode.Position(Math.max(0, lineNum), 0),
    new vscode.Position(Math.max(0, lineNum), 1),
  );

  const diagnostic = new vscode.Diagnostic(
    range,
    `Test failed: ${testName}\n${message}`,
    vscode.DiagnosticSeverity.Error,
  );
  diagnostic.source = 'dotnet test';

  if (!diagnosticMap.has(fullPath)) {
    diagnosticMap.set(fullPath, []);
  }

  // Check for duplicates before adding
  const existingDiagnostics = diagnosticMap.get(fullPath)!;
  const isDuplicate = existingDiagnostics.some(
    d =>
      d.range.start.line === diagnostic.range.start.line &&
      d.range.start.character === diagnostic.range.start.character &&
      d.message === diagnostic.message,
  );

  if (!isDuplicate) {
    existingDiagnostics.push(diagnostic);
  }
}

/**
 * Update the Problems panel with diagnostics
 */
function updateDiagnostics(diagnosticMap: Map<string, vscode.Diagnostic[]>): void {
  if (!buildDiagnostics) {
    return;
  }

  // Clear existing diagnostics
  buildDiagnostics.clear();

  // Add new diagnostics
  for (const [filePath, diagnostics] of diagnosticMap.entries()) {
    const uri = vscode.Uri.file(filePath);
    buildDiagnostics.set(uri, diagnostics);
  }
}
