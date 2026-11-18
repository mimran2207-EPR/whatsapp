import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';

export const repo = path.resolve(__dirname, '..', '..', '..');
const logDir = path.join(path.resolve(__dirname, '..'), 'test-results', 'logs');

const started: ChildProcess[] = [];

export interface StackProcess {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  shell?: boolean;
  /** Ready when this URL answers 2xx, or when stdout matches `stdout` (whichever is given). */
  url?: string;
  stdout?: RegExp;
  timeoutMs: number;
}

/** Starts a process, keeps its output in test-results/logs, and resolves when it is ready. */
export async function startProcess(o: StackProcess): Promise<void> {
  mkdirSync(logDir, { recursive: true });
  const log = createWriteStream(path.join(logDir, `${o.name}.log`));
  const child = spawn(o.command, o.args, {
    cwd: o.cwd,
    env: { ...process.env, ...o.env },
    shell: o.shell ?? false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  started.push(child);
  let exited: number | undefined;
  child.on('exit', (code) => (exited = code ?? -1));
  let ready = false;
  const onData = (chunk: Buffer) => {
    log.write(chunk);
    if (o.stdout?.test(chunk.toString())) ready = true;
  };
  child.stdout!.on('data', onData);
  child.stderr!.on('data', onData);

  const deadline = Date.now() + o.timeoutMs;
  for (;;) {
    if (exited !== undefined) throw new Error(`[e2e] ${o.name} exited early (code ${exited}); see test-results/logs/${o.name}.log`);
    if (o.url) {
      try {
        if ((await fetch(o.url)).ok) ready = true;
      } catch {
        /* not up yet */
      }
    }
    if (ready) {
      console.log(`[e2e] ${o.name} ready`);
      return;
    }
    if (Date.now() > deadline) throw new Error(`[e2e] ${o.name} not ready within ${o.timeoutMs} ms; see test-results/logs/${o.name}.log`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Stops every process started by this module (whole process trees). Safe to call more than once. */
export function stopStack(): void {
  for (const child of started.splice(0)) {
    if (child.pid === undefined || child.exitCode !== null) continue;
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}
