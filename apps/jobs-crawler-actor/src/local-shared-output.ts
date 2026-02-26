import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type SharedRunOutputPaths = {
  baseDir: string;
  runDir: string;
  recordsDir: string;
  datasetJsonPath: string;
};

export const buildSharedRunOutputPaths = (
  baseDir: string,
  crawlRunId: string,
): SharedRunOutputPaths => {
  const absoluteBaseDir = path.resolve(baseDir);
  const runDir = path.join(absoluteBaseDir, 'runs', crawlRunId);
  const recordsDir = path.join(runDir, 'records');

  return {
    baseDir: absoluteBaseDir,
    runDir,
    recordsDir,
    datasetJsonPath: path.join(runDir, 'dataset.json'),
  };
};

export const prepareSharedRunOutput = async (paths: SharedRunOutputPaths): Promise<void> => {
  await mkdir(paths.recordsDir, { recursive: true });

  await access(paths.runDir);
  const probePath = path.join(paths.runDir, '.write-probe.tmp');
  await writeFile(probePath, 'ok\n', 'utf8');
  await rm(probePath, { force: true });
};

export const writeSharedDetailHtml = async (
  paths: SharedRunOutputPaths,
  htmlDetailPageKey: string,
  html: string,
): Promise<string> => {
  const targetPath = path.join(paths.recordsDir, htmlDetailPageKey);
  await writeFile(targetPath, html, 'utf8');
  return targetPath;
};

export const writeSharedDatasetJson = async (
  paths: SharedRunOutputPaths,
  datasetRecords: unknown[],
): Promise<string> => {
  await writeFile(paths.datasetJsonPath, `${JSON.stringify(datasetRecords, null, 2)}\n`, 'utf8');
  return paths.datasetJsonPath;
};
