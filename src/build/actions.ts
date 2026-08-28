/**
 * Build Actions
 *
 * Runs dotnet build/clean/test against a project or solution, reports problems,
 * and backs the Quick Build/Clean/Rebuild/Test commands.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { clearDiagnostics, reportDotnetOutput } from './problems';
import { runDotnet, logBuildLine, DotnetResult } from '../shared/dotnet';
import { isUpToDate, skipUnchangedBuildsEnabled } from './upToDate';
import { getProjects, getSolutions, BuildableItem, ProjectFilter } from '../shared/projectIndex';

// The project or solution most recently acted on, shown first in the picker.
// Launching updates it too, so both flows agree on "last used".
let lastUsedItemPath: string | undefined;

export function setLastUsedItem(itemPath: string): void {
  lastUsedItemPath = itemPath;
}

export function getLastUsedItem(): string | undefined {
  return lastUsedItemPath;
}

// ─── Actions ─────────────────────────────────────────────────────────

/** A single dotnet verb that can be run against a project or solution */
type DotnetVerb = 'build' | 'clean' | 'test';

/** A user-facing command; `rebuild` is a clean followed by a build */
type Action = DotnetVerb | 'rebuild';

interface VerbSpec {
  /** Prefix for the C# Build output channel label */
  label: string;
  success: (name: string) => string;
  failure: (name: string) => string;
}

const VERBS: Record<DotnetVerb, VerbSpec> = {
  build: {
    label: 'Build',
    success: name => `✓ Build succeeded: ${name}`,
    failure: name => `Build failed: ${name}`,
  },
  clean: {
    label: 'Clean',
    success: name => `✓ Clean succeeded: ${name}`,
    failure: name => `Clean failed: ${name}`,
  },
  test: {
    label: 'Test',
    success: name => `✓ Tests passed: ${name}`,
    failure: name => `Tests failed: ${name}`,
  },
};

interface ActionSpec {
  icon: string;
  projects: ProjectFilter;
  /** Verb used in the picker placeholder */
  noun: string;
}

const ACTIONS: Record<Action, ActionSpec> = {
  build: { icon: 'tools', projects: 'all', noun: 'build' },
  clean: { icon: 'trash', projects: 'all', noun: 'clean' },
  rebuild: { icon: 'sync', projects: 'all', noun: 'rebuild' },
  test: { icon: 'beaker', projects: 'test', noun: 'test' },
};

interface VerbResult extends DotnetResult {
  /** True when the dotnet invocation was skipped because nothing had changed */
  skipped?: boolean;
}

/**
 * Run a dotnet verb against a project or solution, reporting problems and
 * showing a success/failure notification. Throws on failure.
 *
 * When the outputs are already newer than every input, a build is skipped
 * outright and a test run reuses the existing binaries via `--no-build`.
 */
export async function runVerb(verb: DotnetVerb, item: BuildableItem): Promise<VerbResult> {
  const cwd = path.dirname(item.path);
  const spec = VERBS[verb];
  const label = `${spec.label} ${item.name}`;
  const args = [verb, item.path];

  if (verb !== 'clean' && skipUnchangedBuildsEnabled() && (await isUpToDate(item))) {
    if (verb === 'build') {
      clearDiagnostics();
      logBuildLine(`▶ ${label} — already up to date, skipped`);
      vscode.window.showInformationMessage(`✓ Up to date: ${item.name}`);
      return { success: true, output: '', skipped: true };
    }

    // Tests still have to run — they just don't need recompiling first
    args.push('--no-build');
  }

  clearDiagnostics();

  const result = await runDotnet(args, { cwd, label });

  if (verb === 'clean') {
    // Clean only reports problems when it fails — a successful clean wipes the panel
    if (!result.success && result.output) {
      reportDotnetOutput(result.output, cwd, { itemPath: item.path });
    }
  } else if (result.output) {
    reportDotnetOutput(result.output, cwd, {
      includeTests: verb === 'test',
      itemPath: item.path,
    });
  }

  if (!result.success) {
    vscode.window.showErrorMessage(spec.failure(item.name));
    throw new Error(spec.failure(item.name));
  }

  if (verb === 'clean') {
    clearDiagnostics();
  }

  vscode.window.showInformationMessage(spec.success(item.name));
  return result;
}

/**
 * Run an action (including the composite `rebuild`) against an item.
 */
async function runAction(action: Action, item: BuildableItem): Promise<void> {
  if (action === 'rebuild') {
    await runVerb('clean', item);
    await runVerb('build', item);
  } else {
    await runVerb(action, item);
  }
}

// ─── Picker ──────────────────────────────────────────────────────────

/**
 * Show a project/solution picker for an action. Records the choice as the
 * last used item so it sorts first next time.
 */
async function pickBuildable(action: Action): Promise<BuildableItem | undefined> {
  const spec = ACTIONS[action];
  const [projects, solutions] = await Promise.all([getProjects(spec.projects), getSolutions()]);

  if (projects.length === 0 && solutions.length === 0) {
    vscode.window.showWarningMessage(
      spec.projects === 'test'
        ? 'No test projects or solutions found in workspace'
        : 'No C# projects or solutions found in workspace',
    );
    return undefined;
  }

  interface BuildableQuickPickItem extends vscode.QuickPickItem {
    item: BuildableItem;
  }

  // Solutions first, then projects
  const items: BuildableQuickPickItem[] = [
    ...solutions.map(solution => ({
      label: `$(folder) ${solution.name}`,
      description: 'Solution',
      detail: `${solution.projectCount} project(s) • ${path.dirname(solution.path)}`,
      item: solution,
    })),
    ...projects.map(project => ({
      label: `$(${spec.icon}) ${project.name}`,
      description:
        spec.projects === 'test'
          ? 'Test Project'
          : project.isWeb
            ? 'Web Application'
            : 'Console Application',
      detail: `${project.targetFramework} • ${path.dirname(project.path)}`,
      item: project as BuildableItem,
    })),
  ];

  // Sort items to show last used item first
  if (lastUsedItemPath) {
    items.sort((a, b) => {
      if (a.item.path === lastUsedItemPath) return -1;
      if (b.item.path === lastUsedItemPath) return 1;
      return 0;
    });
  }

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: `Select a project or solution to ${spec.noun}`,
    matchOnDescription: true,
  });

  if (!selected) {
    return undefined;
  }

  lastUsedItemPath = selected.item.path;
  return selected.item;
}

/**
 * Show the picker for an action and run it. Failures are already reported
 * by runVerb, so they're swallowed here.
 */
async function pickAndRun(action: Action): Promise<void> {
  const item = await pickBuildable(action);
  if (!item) {
    return;
  }

  try {
    await runAction(action, item);
  } catch {
    // Error messages already shown by runVerb
  }
}

/**
 * Quick build: Show project picker and build without running
 */
export async function quickBuild(): Promise<void> {
  await pickAndRun('build');
}

/**
 * Quick clean: Show project picker and clean
 */
export async function quickClean(): Promise<void> {
  await pickAndRun('clean');
}

/**
 * Quick rebuild: Show project picker and rebuild (clean + build)
 */
export async function quickRebuild(): Promise<void> {
  await pickAndRun('rebuild');
}

/**
 * Quick test: Show project picker and run tests
 */
export async function quickTest(): Promise<void> {
  await pickAndRun('test');
}
