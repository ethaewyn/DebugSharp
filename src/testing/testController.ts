/**
 * C# Test Explorer
 *
 * Integrates with VS Code's native Test Explorer by finding test projects,
 * discovering tests via `dotnet test --list-tests`, running them via
 * `dotnet test --filter`, and parsing TRX result files.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';

// ─── Types ───────────────────────────────────────────────────────────

interface TestItemData {
  type: 'project' | 'namespace' | 'class' | 'method';
  projectPath: string;
  fullyQualifiedName?: string;
}

interface TrxResult {
  testName: string;
  outcome: string;
  durationMs: number;
  errorMessage?: string;
  stackTrace?: string;
  stdout?: string;
}

// ─── Store ───────────────────────────────────────────────────────────

const testData = new WeakMap<vscode.TestItem, TestItemData>();

// ─── Controller setup ────────────────────────────────────────────────

export function activateTestExplorer(context: vscode.ExtensionContext): vscode.TestController {
  const controller = vscode.tests.createTestController('debugsharp.testExplorer', 'C# Tests');

  // Lazy resolution — called when the tree is expanded
  controller.resolveHandler = async item => {
    if (!item) {
      await discoverTestProjects(controller);
    } else {
      const data = testData.get(item);
      if (data?.type === 'project') {
        item.busy = true;
        try {
          await discoverTests(controller, item, data.projectPath);
        } finally {
          item.busy = false;
        }
      }
    }
  };

  // Manual refresh button
  controller.refreshHandler = async _token => {
    controller.items.replace([]);
    await discoverTestProjects(controller);
  };

  // Run profile
  controller.createRunProfile('Run Tests', vscode.TestRunProfileKind.Run, (request, token) =>
    runTests(controller, request, token, false),
  );

  // Debug profile
  controller.createRunProfile('Debug Tests', vscode.TestRunProfileKind.Debug, (request, token) =>
    runTests(controller, request, token, true),
  );

  // File watchers — invalidate results on source change
  const csWatcher = vscode.workspace.createFileSystemWatcher('**/*.cs');
  csWatcher.onDidChange(() => controller.invalidateTestResults());
  csWatcher.onDidCreate(() => controller.invalidateTestResults());
  csWatcher.onDidDelete(() => controller.invalidateTestResults());

  const csprojWatcher = vscode.workspace.createFileSystemWatcher('**/*.csproj');
  csprojWatcher.onDidChange(() => {
    controller.items.replace([]);
    controller.resolveHandler?.(undefined);
  });

  context.subscriptions.push(controller, csWatcher, csprojWatcher);
  return controller;
}

// ─── Discovery ───────────────────────────────────────────────────────

/**
 * Find test projects in the workspace and add them as top-level items.
 */
async function discoverTestProjects(controller: vscode.TestController): Promise<void> {
  const csprojFiles = await vscode.workspace.findFiles('**/*.csproj', '**/node_modules/**');

  for (const uri of csprojFiles) {
    try {
      const content = fs.readFileSync(uri.fsPath, 'utf8');
      const isTest =
        content.includes('Microsoft.NET.Test.Sdk') ||
        content.includes('xunit') ||
        content.includes('NUnit') ||
        content.includes('nunit') ||
        content.includes('MSTest') ||
        content.includes('MSTest.TestFramework') ||
        content.includes('MSTest.TestAdapter');

      if (!isTest) continue;

      const name = path.basename(uri.fsPath, '.csproj');
      const item = controller.createTestItem(uri.fsPath, name, uri);
      item.canResolveChildren = true;
      testData.set(item, { type: 'project', projectPath: uri.fsPath });
      controller.items.add(item);
    } catch {
      // skip unreadable files
    }
  }
}

/**
 * Discover tests in a specific project using `dotnet test --list-tests`.
 */
async function discoverTests(
  controller: vscode.TestController,
  projectItem: vscode.TestItem,
  projectPath: string,
): Promise<void> {
  const cwd = path.dirname(projectPath);

  const result = await runDotnet(['test', projectPath, '--list-tests', '--no-build'], cwd);

  // If --no-build fails (not built yet), retry with build
  let output = result.output;
  if (!result.success) {
    const retry = await runDotnet(['test', projectPath, '--list-tests'], cwd);
    if (!retry.success) {
      projectItem.error = `Failed to discover tests:\n${retry.output}`;
      return;
    }
    output = retry.output;
  }

  const fqns = parseListTestsOutput(output);
  if (fqns.length === 0) {
    projectItem.description = 'no tests found';
    return;
  }

  projectItem.description = `${fqns.length} test${fqns.length === 1 ? '' : 's'}`;
  buildTestTree(controller, projectItem, projectPath, fqns);
}

/**
 * Parse the output of `dotnet test --list-tests`.
 *
 * Output looks like:
 * ```
 * The following Tests are available:
 *     Namespace.Class.Method
 *     Namespace.Class.Method2
 * ```
 */
function parseListTestsOutput(output: string): string[] {
  const lines = output.split('\n');
  const tests: string[] = [];
  let found = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'The following Tests are available:') {
      found = true;
      continue;
    }
    if (found && trimmed.length > 0) {
      // Stop if we hit a blank line or a non-test line (e.g. summary info)
      if (trimmed.startsWith('Test run') || trimmed.startsWith('Total')) break;
      tests.push(trimmed);
    }
  }

  return tests;
}

/**
 * Build the TestItem tree from fully-qualified test names.
 *
 * Groups: Namespace.Class → Method
 * For parameterised tests like `Class.Method(x: 1)`, groups under `Method`.
 */
function buildTestTree(
  controller: vscode.TestController,
  projectItem: vscode.TestItem,
  projectPath: string,
  fqns: string[],
): void {
  // Group by class (everything before the last dot, ignoring parenthesised params)
  const byClass = new Map<string, string[]>();

  for (const fqn of fqns) {
    // Strip parameters for grouping: "NS.Class.Method(a: 1)" → "NS.Class.Method"
    const baseFqn = fqn.replace(/\(.*\)$/, '');
    const lastDot = baseFqn.lastIndexOf('.');
    if (lastDot === -1) {
      // Unlikely, but handle: no namespace
      const methods = byClass.get('(default)') ?? [];
      methods.push(fqn);
      byClass.set('(default)', methods);
    } else {
      const className = baseFqn.substring(0, lastDot);
      const methods = byClass.get(className) ?? [];
      methods.push(fqn);
      byClass.set(className, methods);
    }
  }

  // Clear existing children
  projectItem.children.replace([]);

  // Build namespace → class grouping
  // We'll group classes by their namespace to create a namespace → class → method hierarchy
  const byNamespace = new Map<string, Map<string, string[]>>();

  for (const [classFqn, methods] of byClass) {
    const lastDot = classFqn.lastIndexOf('.');
    let ns: string;
    let className: string;
    if (lastDot === -1) {
      ns = '';
      className = classFqn;
    } else {
      ns = classFqn.substring(0, lastDot);
      className = classFqn.substring(lastDot + 1);
    }

    if (!byNamespace.has(ns)) {
      byNamespace.set(ns, new Map());
    }
    byNamespace.get(ns)!.set(classFqn, methods);
  }

  // If there's only one namespace, skip the namespace level
  const skipNamespace = byNamespace.size === 1;

  for (const [ns, classes] of byNamespace) {
    let parentItem: vscode.TestItem;

    if (skipNamespace) {
      parentItem = projectItem;
    } else {
      const nsId = `${projectPath}::${ns || '(default)'}`;
      parentItem = controller.createTestItem(nsId, ns || '(default)');
      testData.set(parentItem, { type: 'namespace', projectPath });
      projectItem.children.add(parentItem);
    }

    for (const [classFqn, methods] of classes) {
      const shortClassName = classFqn.substring(classFqn.lastIndexOf('.') + 1);
      const classId = `${projectPath}::${classFqn}`;
      const classItem = controller.createTestItem(classId, shortClassName);
      testData.set(classItem, {
        type: 'class',
        projectPath,
        fullyQualifiedName: classFqn,
      });
      parentItem.children.add(classItem);

      for (const fqn of methods) {
        const baseFqn = fqn.replace(/\(.*\)$/, '');
        const methodName = baseFqn.substring(baseFqn.lastIndexOf('.') + 1);
        // For parameterised tests, include the params in the label
        const params = fqn.includes('(') ? fqn.substring(fqn.indexOf('(')) : '';
        const label = params ? `${methodName}${params}` : methodName;

        const methodId = `${projectPath}::${fqn}`;
        const methodItem = controller.createTestItem(methodId, label);
        testData.set(methodItem, {
          type: 'method',
          projectPath,
          fullyQualifiedName: fqn,
        });
        classItem.children.add(methodItem);
      }
    }
  }
}

// ─── Running ─────────────────────────────────────────────────────────

/**
 * Run (or debug) the requested tests.
 */
async function runTests(
  controller: vscode.TestController,
  request: vscode.TestRunRequest,
  token: vscode.CancellationToken,
  debug: boolean,
): Promise<void> {
  const run = controller.createTestRun(request);

  // Collect leaf test items
  const leaves: vscode.TestItem[] = [];
  const excludeSet = new Set<string>();
  if (request.exclude) {
    request.exclude.forEach(t => excludeSet.add(t.id));
  }

  const enqueueLeaves = (items: vscode.TestItemCollection) => {
    items.forEach(item => {
      if (excludeSet.has(item.id)) return;
      if (item.children.size > 0) {
        enqueueLeaves(item.children);
      } else {
        leaves.push(item);
        run.enqueued(item);
      }
    });
  };

  if (request.include) {
    for (const item of request.include) {
      if (item.children.size > 0) {
        enqueueLeaves(item.children);
      } else {
        leaves.push(item);
        run.enqueued(item);
      }
    }
  } else {
    enqueueLeaves(controller.items);
  }

  // Group by project
  const byProject = new Map<string, vscode.TestItem[]>();
  for (const leaf of leaves) {
    const data = testData.get(leaf);
    if (!data) continue;
    const arr = byProject.get(data.projectPath) ?? [];
    arr.push(leaf);
    byProject.set(data.projectPath, arr);
  }

  for (const [projectPath, tests] of byProject) {
    if (token.isCancellationRequested) break;

    tests.forEach(t => run.started(t));

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debugsharp-trx-'));
    const trxFile = 'results.trx';
    const cwd = path.dirname(projectPath);

    // Build the filter
    const filterParts: string[] = [];
    let runAllInProject = false;

    for (const test of tests) {
      const data = testData.get(test);
      if (!data?.fullyQualifiedName) {
        // No FQN (e.g. project-level) → run all
        runAllInProject = true;
        break;
      }
      // Escape any special filter characters
      const fqn = data.fullyQualifiedName.replace(/\(.*\)$/, '');
      filterParts.push(`FullyQualifiedName~${fqn}`);
    }

    const args = [
      'test',
      projectPath,
      '--logger',
      `trx;LogFileName=${trxFile}`,
      '--results-directory',
      tmpDir,
    ];

    if (!runAllInProject && filterParts.length > 0) {
      // Deduplicate filter parts
      const uniqueFilters = [...new Set(filterParts)];
      args.push('--filter', uniqueFilters.join('|'));
    }

    if (debug) {
      // For debug, launch via VS Code's debugger
      await runTestsWithDebugger(projectPath, args, cwd, token);
      // In debug mode we can't easily get TRX — mark tests as passed/skipped
      tests.forEach(t => run.skipped(t));
    } else {
      const result = await runDotnetCancellable(args, cwd, token);

      if (token.isCancellationRequested) {
        tests.forEach(t => run.skipped(t));
      } else {
        // Parse TRX results
        const trxPath = path.join(tmpDir, trxFile);
        const trxResults = parseTrxFile(trxPath);

        if (trxResults.size === 0 && !result.success) {
          // TRX not produced — build or framework error
          const msg = new vscode.TestMessage(result.output || 'Test run failed');
          tests.forEach(t => run.errored(t, msg));
        } else {
          for (const test of tests) {
            const data = testData.get(test);
            const fqn = data?.fullyQualifiedName ?? '';

            // Try exact match first, then partial match
            let trx = trxResults.get(fqn);
            if (!trx) {
              // For parameterised tests the TRX name might differ slightly
              const baseFqn = fqn.replace(/\(.*\)$/, '');
              for (const [key, val] of trxResults) {
                if (key.startsWith(baseFqn)) {
                  trx = val;
                  break;
                }
              }
            }

            if (!trx) {
              run.skipped(test);
              continue;
            }

            switch (trx.outcome.toLowerCase()) {
              case 'passed': {
                run.passed(test, trx.durationMs);
                break;
              }
              case 'failed': {
                const msg = new vscode.TestMessage(trx.errorMessage ?? 'Test failed');
                if (trx.stackTrace) {
                  const loc = parseStackTraceLocation(trx.stackTrace);
                  if (loc) msg.location = loc;
                }
                if (trx.stdout) {
                  run.appendOutput(trx.stdout.replace(/\n/g, '\r\n'), undefined, test);
                }
                run.failed(test, msg, trx.durationMs);
                break;
              }
              case 'notexecuted':
              case 'inconclusive': {
                run.skipped(test);
                break;
              }
              default: {
                const errMsg = new vscode.TestMessage(
                  trx.errorMessage ?? `Outcome: ${trx.outcome}`,
                );
                run.errored(test, errMsg, trx.durationMs);
              }
            }
          }
        }
      }
    }

    // Cleanup temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }

  run.end();
}

// ─── TRX Parsing ─────────────────────────────────────────────────────

/**
 * Parse a TRX (Visual Studio Test Results) XML file.
 * Uses regex since the format is machine-generated and predictable.
 */
function parseTrxFile(trxPath: string): Map<string, TrxResult> {
  const results = new Map<string, TrxResult>();

  try {
    if (!fs.existsSync(trxPath)) return results;
    const content = fs.readFileSync(trxPath, 'utf8');

    // Build a map of testId → FQN from TestDefinitions
    const testIdToFqn = new Map<string, string>();
    const defRegex = /<UnitTest[^>]*\bname="([^"]*)"[^>]*\bid="([^"]*)"[\s\S]*?<\/UnitTest>/gi;
    let defMatch;
    while ((defMatch = defRegex.exec(content)) !== null) {
      const name = defMatch[1];
      const id = defMatch[2];

      // Try to extract className from TestMethod element
      const block = defMatch[0];
      const classMatch = block.match(/<TestMethod[^>]*\bclassName="([^"]*)"/);
      const methodMatch = block.match(/<TestMethod[^>]*\bname="([^"]*)"/);

      let fqn: string;
      if (classMatch && methodMatch) {
        fqn = `${classMatch[1]}.${methodMatch[1]}`;
      } else if (classMatch) {
        fqn = `${classMatch[1]}.${name}`;
      } else {
        fqn = name;
      }

      testIdToFqn.set(id, fqn);
    }

    // Parse UnitTestResult elements
    const resultRegex =
      /<UnitTestResult[^>]*\btestId="([^"]*)"[^>]*\btestName="([^"]*)"[^>]*\boutcome="([^"]*)"[^>]*\bduration="([^"]*)"[^>]*>([\s\S]*?)<\/UnitTestResult>/gi;
    let resMatch;
    while ((resMatch = resultRegex.exec(content)) !== null) {
      const testId = resMatch[1];
      const testName = resMatch[2];
      const outcome = resMatch[3];
      const duration = resMatch[4];
      const body = resMatch[5];

      const durationMs = parseDuration(duration);
      const fqn = testIdToFqn.get(testId) ?? testName;

      const errorMessageMatch = body.match(/<Message>([\s\S]*?)<\/Message>/);
      const stackTraceMatch = body.match(/<StackTrace>([\s\S]*?)<\/StackTrace>/);
      const stdoutMatch = body.match(/<StdOut>([\s\S]*?)<\/StdOut>/);

      results.set(fqn, {
        testName,
        outcome,
        durationMs,
        errorMessage: decodeXml(errorMessageMatch?.[1]?.trim()),
        stackTrace: decodeXml(stackTraceMatch?.[1]?.trim()),
        stdout: decodeXml(stdoutMatch?.[1]?.trim()),
      });
    }

    // Also try self-closing UnitTestResult (passed tests often have no body)
    const selfClosingRegex =
      /<UnitTestResult[^>]*\btestId="([^"]*)"[^>]*\btestName="([^"]*)"[^>]*\boutcome="([^"]*)"[^>]*\bduration="([^"]*)"[^/]*\/>/gi;
    let scMatch;
    while ((scMatch = selfClosingRegex.exec(content)) !== null) {
      const testId = scMatch[1];
      const testName = scMatch[2];
      const outcome = scMatch[3];
      const duration = scMatch[4];

      const fqn = testIdToFqn.get(testId) ?? testName;

      // Don't overwrite if already found in the full-body parse
      if (!results.has(fqn)) {
        results.set(fqn, {
          testName,
          outcome,
          durationMs: parseDuration(duration),
        });
      }
    }
  } catch {
    // Return whatever we have
  }

  return results;
}

/**
 * Parse TRX duration format `HH:MM:SS.FFFFFFF` to milliseconds.
 */
function parseDuration(duration: string): number {
  const match = duration.match(/(\d+):(\d+):(\d+)\.?(\d*)/);
  if (!match) return 0;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const fraction = match[4] ? parseInt(match[4].substring(0, 3).padEnd(3, '0'), 10) : 0;
  return (hours * 3600 + minutes * 60 + seconds) * 1000 + fraction;
}

/**
 * Decode basic XML entities.
 */
function decodeXml(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ─── Stack Trace Parsing ─────────────────────────────────────────────

/**
 * Extract a file:line location from a stack trace for inline display.
 */
function parseStackTraceLocation(stackTrace: string): vscode.Location | undefined {
  // Match patterns like: at Namespace.Class.Method() in C:\path\file.cs:line 42
  const match = stackTrace.match(/in\s+(.+?):line\s+(\d+)/);
  if (!match) return undefined;

  const filePath = match[1].trim();
  const lineNum = parseInt(match[2], 10) - 1; // 0-based

  if (!fs.existsSync(filePath)) return undefined;

  return new vscode.Location(vscode.Uri.file(filePath), new vscode.Position(lineNum, 0));
}

// ─── Debug Support ───────────────────────────────────────────────────

/**
 * Run dotnet test with the debugger attached.
 * Uses VSTEST_HOST_DEBUG to pause the test host, then attaches coreclr debugger.
 */
async function runTestsWithDebugger(
  projectPath: string,
  args: string[],
  cwd: string,
  token: vscode.CancellationToken,
): Promise<void> {
  return new Promise<void>(resolve => {
    const env = { ...process.env, VSTEST_HOST_DEBUG: '1' };
    const proc = cp.spawn('dotnet', args, { cwd, shell: true, env });

    let output = '';
    const pidRegex = /Process Id:\s*(\d+)/;

    const cleanup = () => {
      try {
        proc.kill();
      } catch {
        // ignore
      }
      resolve();
    };

    token.onCancellationRequested(cleanup);

    proc.stdout.on('data', async (data: Buffer) => {
      output += data.toString();
      const match = output.match(pidRegex);
      if (match) {
        const pid = parseInt(match[1], 10);
        // Attach the debugger to the test host process
        try {
          await vscode.debug.startDebugging(undefined, {
            type: 'coreclr',
            request: 'attach',
            name: 'Debug Test',
            processId: pid.toString(),
          });
        } catch {
          vscode.window.showErrorMessage('Failed to attach debugger to test host');
        }
      }
    });

    proc.stderr.on('data', () => {
      /* consume */
    });
    proc.on('close', () => resolve());
    proc.on('error', () => resolve());
  });
}

// ─── CLI Helper ──────────────────────────────────────────────────────

function runDotnet(args: string[], cwd: string): Promise<{ success: boolean; output: string }> {
  return new Promise(resolve => {
    const proc = cp.spawn('dotnet', args, { cwd, shell: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    proc.on('close', code => resolve({ success: code === 0, output: stdout + stderr }));
    proc.on('error', err => resolve({ success: false, output: err.message }));
  });
}

/**
 * Like runDotnet but supports cancellation.
 */
function runDotnetCancellable(
  args: string[],
  cwd: string,
  token: vscode.CancellationToken,
): Promise<{ success: boolean; output: string }> {
  return new Promise(resolve => {
    const proc = cp.spawn('dotnet', args, { cwd, shell: true });
    let stdout = '';
    let stderr = '';

    token.onCancellationRequested(() => {
      try {
        proc.kill();
      } catch {
        // ignore
      }
      resolve({ success: false, output: 'Cancelled' });
    });

    proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    proc.on('close', code => resolve({ success: code === 0, output: stdout + stderr }));
    proc.on('error', err => resolve({ success: false, output: err.message }));
  });
}
