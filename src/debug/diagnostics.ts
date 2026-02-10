/**
 * Build Diagnostics Module
 *
 * Manages parsing of dotnet build/test output and reporting errors to VS Code Problems panel
 */
import * as vscode from 'vscode';
import * as path from 'path';

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
 * Get the diagnostic collection
 */
export function getDiagnosticCollection(): vscode.DiagnosticCollection {
  if (!buildDiagnostics) {
    throw new Error('Diagnostics not initialized');
  }
  return buildDiagnostics;
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
 * Parse dotnet build/test output and extract errors and warnings
 */
export function parseBuildOutput(
  output: string,
  workingDirectory: string,
): Map<string, vscode.Diagnostic[]> {
  const diagnosticMap = new Map<string, vscode.Diagnostic[]>();
  const lines = output.split('\n');

  // Regex patterns for different error/warning formats
  // Format 1: filepath(line,col): error/warning CODE: message
  const pattern1 = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(\w+):\s+(.+?)$/i;

  // Format 2: filepath.cs(line,col): error/warning CODE: message [project]
  const pattern2 = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(\w+):\s+(.+?)\s+\[.+\]$/i;

  // Format 3: filepath : error/warning CODE: message
  const pattern3 = /^(.+?):\s+(error|warning)\s+(\w+):\s+(.+?)$/i;

  // Format 4: CSC : error CS####: message
  const pattern4 = /^CSC\s*:\s+(error|warning)\s+(\w+):\s+(.+?)$/i;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    let match: RegExpMatchArray | null = null;
    let filePath: string | null = null;
    let lineNum = 0;
    let colNum = 0;
    let severity: vscode.DiagnosticSeverity = vscode.DiagnosticSeverity.Error;
    let code = '';
    let message = '';

    // Try pattern 1 or 2 (with line and column)
    match = trimmedLine.match(pattern1) || trimmedLine.match(pattern2);
    if (match) {
      filePath = match[1].trim();
      lineNum = parseInt(match[2], 10) - 1; // VS Code uses 0-based line numbers
      colNum = parseInt(match[3], 10) - 1; // VS Code uses 0-based column numbers
      severity =
        match[4].toLowerCase() === 'error'
          ? vscode.DiagnosticSeverity.Error
          : vscode.DiagnosticSeverity.Warning;
      code = match[5];
      message = match[6].trim();
    } else {
      // Try pattern 3 (without line and column)
      match = trimmedLine.match(pattern3);
      if (match) {
        filePath = match[1].trim();
        lineNum = 0;
        colNum = 0;
        severity =
          match[2].toLowerCase() === 'error'
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning;
        code = match[3];
        message = match[4].trim();
      } else {
        // Try pattern 4 (CSC errors without file path)
        match = trimmedLine.match(pattern4);
        if (match) {
          // These are general compiler errors, assign to working directory
          filePath = workingDirectory;
          lineNum = 0;
          colNum = 0;
          severity =
            match[1].toLowerCase() === 'error'
              ? vscode.DiagnosticSeverity.Error
              : vscode.DiagnosticSeverity.Warning;
          code = match[2];
          message = match[3].trim();
        }
      }
    }

    if (filePath && message) {
      // Resolve relative paths
      let fullPath: string;
      if (path.isAbsolute(filePath)) {
        fullPath = filePath;
      } else {
        fullPath = path.join(workingDirectory, filePath);
      }

      // Normalize path separators
      fullPath = fullPath.replace(/\\/g, '/');

      const range = new vscode.Range(
        new vscode.Position(Math.max(0, lineNum), Math.max(0, colNum)),
        new vscode.Position(Math.max(0, lineNum), Math.max(0, colNum) + 1),
      );

      const diagnostic = new vscode.Diagnostic(range, message, severity);
      diagnostic.code = code;
      diagnostic.source = 'dotnet build';

      if (!diagnosticMap.has(fullPath)) {
        diagnosticMap.set(fullPath, []);
      }

      // Check for duplicates before adding
      const existingDiagnostics = diagnosticMap.get(fullPath)!;
      const isDuplicate = existingDiagnostics.some(
        d =>
          d.range.start.line === diagnostic.range.start.line &&
          d.range.start.character === diagnostic.range.start.character &&
          d.code === diagnostic.code &&
          d.message === diagnostic.message,
      );

      if (!isDuplicate) {
        existingDiagnostics.push(diagnostic);
      }
    }
  }

  return diagnosticMap;
}

/**
 * Parse dotnet test output and extract test failures
 */
export function parseTestOutput(
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
export function updateDiagnostics(diagnosticMap: Map<string, vscode.Diagnostic[]>): void {
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
