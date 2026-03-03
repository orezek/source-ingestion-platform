import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { runManifestSchema } from '@repo/control-plane-contracts';

type WorkerRuntime = {
  workerType: 'crawler';
  status: 'queued' | 'running' | 'succeeded' | 'completed_with_errors' | 'failed' | 'stopped';
  startedAt?: string;
  finishedAt?: string;
  lastHeartbeatAt?: string;
  pid?: number;
  logPath?: string;
  errorMessage?: string;
  exitCode?: number | null;
  counters?: Record<string, unknown>;
};

function nowIso(): string {
  return new Date().toISOString();
}

async function readWorkerRuntime(runtimePath: string): Promise<WorkerRuntime | null> {
  try {
    const raw = await readFile(runtimePath, 'utf8');
    return JSON.parse(raw) as WorkerRuntime;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

async function writeWorkerRuntime(runtimePath: string, runtime: WorkerRuntime): Promise<void> {
  await writeFile(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      'run-manifest': { type: 'string' },
      'runtime-path': { type: 'string' },
      'generated-input-path': { type: 'string' },
      'broker-dir': { type: 'string' },
    },
    allowPositionals: false,
  });

  const runManifestPath = parsed.values['run-manifest'];
  const runtimePath = parsed.values['runtime-path'];

  if (!runManifestPath || !runtimePath) {
    throw new Error('--run-manifest and --runtime-path are required.');
  }

  const manifest = runManifestSchema.parse(
    JSON.parse(await readFile(path.resolve(runManifestPath), 'utf8')) as unknown,
  );
  const existingRuntime = await readWorkerRuntime(path.resolve(runtimePath));

  await writeWorkerRuntime(path.resolve(runtimePath), {
    workerType: 'crawler',
    status: 'running',
    startedAt: existingRuntime?.startedAt ?? nowIso(),
    lastHeartbeatAt: nowIso(),
    pid: process.pid,
    logPath: existingRuntime?.logPath,
    counters: {
      ...(existingRuntime?.counters ?? {}),
      generatedInputPath: parsed.values['generated-input-path'],
      brokerDir: parsed.values['broker-dir'],
    },
  });

  const appRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      'src/main.ts',
      '--',
      '--search-space',
      manifest.searchSpaceSnapshot.id,
      '--max-items',
      String(manifest.searchSpaceSnapshot.maxItemsDefault),
      '--max-concurrency',
      String(manifest.runtimeProfileSnapshot.crawlerMaxConcurrency),
      '--max-requests-per-minute',
      String(manifest.runtimeProfileSnapshot.crawlerMaxRequestsPerMinute),
      ...(manifest.runtimeProfileSnapshot.debugLog ? ['--debug-log'] : []),
      ...(manifest.searchSpaceSnapshot.allowInactiveMarkingOnPartialRuns
        ? ['--allow-inactive-marking-on-partial-runs']
        : []),
    ],
    {
      cwd: appRootDir,
      env: process.env,
      stdio: 'inherit',
    },
  );

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });

  const summaryPath =
    typeof process.env.CRAWL_RUN_SUMMARY_FILE_PATH === 'string'
      ? process.env.CRAWL_RUN_SUMMARY_FILE_PATH
      : null;
  const summaryRaw = summaryPath ? await readFile(summaryPath, 'utf8').catch(() => null) : null;
  const summary = summaryRaw ? (JSON.parse(summaryRaw) as Record<string, unknown>) : null;
  const runStatus =
    summary && typeof summary.status === 'string' && summary.status.length > 0
      ? summary.status
      : exitCode === 0
        ? 'succeeded'
        : 'failed';

  await writeWorkerRuntime(path.resolve(runtimePath), {
    workerType: 'crawler',
    status:
      runStatus === 'completed_with_errors' || runStatus === 'succeeded' || runStatus === 'failed'
        ? runStatus
        : exitCode === 0
          ? 'succeeded'
          : 'failed',
    startedAt: existingRuntime?.startedAt ?? nowIso(),
    finishedAt: nowIso(),
    lastHeartbeatAt: nowIso(),
    pid: process.pid,
    logPath: existingRuntime?.logPath,
    exitCode,
    counters: {
      ...(existingRuntime?.counters ?? {}),
      summaryPath,
    },
  });

  if (exitCode && exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

void main().catch(async (error) => {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      'runtime-path': { type: 'string' },
    },
    allowPositionals: false,
  });
  const runtimePath = parsed.values['runtime-path'];

  if (runtimePath) {
    const existingRuntime = await readWorkerRuntime(path.resolve(runtimePath)).catch(() => null);
    await writeWorkerRuntime(path.resolve(runtimePath), {
      workerType: 'crawler',
      status: 'failed',
      startedAt: existingRuntime?.startedAt ?? nowIso(),
      finishedAt: nowIso(),
      lastHeartbeatAt: nowIso(),
      pid: process.pid,
      logPath: existingRuntime?.logPath,
      errorMessage: error instanceof Error ? error.message : 'Unknown crawler worker error.',
      exitCode: 1,
      counters: existingRuntime?.counters ?? {},
    }).catch(() => undefined);
  }

  throw error;
});
