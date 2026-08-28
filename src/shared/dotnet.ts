/**
 * Dotnet CLI Runner
 *
 * Single entry point for invoking the dotnet CLI. Handles argument quoting,
 * cancellation, and optional streaming to the "C# Build" output channel.
 */
import * as vscode from 'vscode';
import * as cp from 'child_process';

export interface DotnetResult {
  success: boolean;
  output: string;
}

export interface RunOptions {
  cwd: string;
  /** When set, the command and its output are streamed to the C# Build channel under this label */
  label?: string;
  /** When set, the process is killed if cancellation is requested */
  token?: vscode.CancellationToken;
  /** Extra environment variables merged over process.env */
  env?: NodeJS.ProcessEnv;
  /** Called with each stdout chunk as it arrives */
  onStdout?: (chunk: string) => void;
}

// ─── Build Output Channel ────────────────────────────────────────────

let buildOutputChannel: vscode.OutputChannel | undefined;

function getBuildOutputChannel(): vscode.OutputChannel {
  if (!buildOutputChannel) {
    buildOutputChannel = vscode.window.createOutputChannel('C# Build');
  }
  return buildOutputChannel;
}

/**
 * Write a standalone line to the C# Build channel, for actions that report a
 * result without running a command.
 */
export function logBuildLine(text: string): void {
  const channel = getBuildOutputChannel();
  channel.show(true);
  channel.appendLine(text);
  channel.appendLine('');
}

/**
 * Every caller parses this output — build diagnostics, test discovery, package
 * listings — and both the .NET CLI and MSBuild localize their messages,
 * including the words "error" and "warning". Pin the tool language so parsing
 * doesn't silently stop working on a non-English install.
 */
const PARSEABLE_OUTPUT_ENV = {
  DOTNET_CLI_UI_LANGUAGE: 'en',
  VSLANG: '1033',
};

/**
 * Quote an argument that the shell would otherwise mangle.
 *
 * Node joins the args array into a single command string when `shell: true`,
 * so anything the shell treats specially has to be quoted here — whitespace in
 * paths, and metacharacters like the `;` in `--logger trx;LogFileName=...`,
 * which POSIX shells would read as a command separator.
 */
function quoteArg(arg: string): string {
  if (!/[\s;&|<>()^"'`$]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

/**
 * Run a dotnet command.
 *
 * Args are passed as an array and quoted here — callers never build command
 * strings themselves.
 */
export function runDotnet(args: string[], opts: RunOptions): Promise<DotnetResult> {
  return new Promise(resolve => {
    const quoted = args.map(quoteArg);
    const channel = opts.label ? getBuildOutputChannel() : undefined;

    if (channel) {
      channel.show(true);
      channel.appendLine(`▶ ${opts.label}`);
      channel.appendLine(`> dotnet ${quoted.join(' ')}`);
      channel.appendLine('');
    }

    const proc = cp.spawn('dotnet', quoted, {
      cwd: opts.cwd,
      shell: true,
      env: { ...process.env, ...PARSEABLE_OUTPUT_ENV, ...opts.env },
    });

    let output = '';
    let settled = false;
    let cancelListener: vscode.Disposable | undefined;

    const finish = (result: DotnetResult) => {
      if (settled) return;
      settled = true;
      cancelListener?.dispose();
      resolve(result);
    };

    cancelListener = opts.token?.onCancellationRequested(() => {
      try {
        proc.kill();
      } catch {
        // Process may have already exited
      }
      finish({ success: false, output: 'Cancelled' });
    });

    proc.stdout.on('data', (d: Buffer) => {
      const s = d.toString();
      output += s;
      channel?.append(s);
      opts.onStdout?.(s);
    });

    proc.stderr.on('data', (d: Buffer) => {
      const s = d.toString();
      output += s;
      channel?.append(s);
    });

    proc.on('close', code => {
      if (channel) {
        channel.appendLine(code === 0 ? '✓ Done' : '✗ Failed');
        channel.appendLine('');
      }
      finish({ success: code === 0, output });
    });

    proc.on('error', err => {
      if (channel) {
        channel.appendLine(`Error: ${err.message}`);
        channel.appendLine('');
      }
      finish({ success: false, output: err.message });
    });
  });
}
