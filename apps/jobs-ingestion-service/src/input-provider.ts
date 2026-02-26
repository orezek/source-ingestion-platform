import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { AppLogger } from './logger.js';
import { sourceListingRecordSchema, type SourceListingRecord } from './schema.js';

const jsonFilePattern = /\.json$/i;

const toListingRecord = (rawRecord: unknown): SourceListingRecord => {
  if (typeof rawRecord === 'string') {
    const parsed = JSON.parse(rawRecord) as unknown;
    return sourceListingRecordSchema.parse(parsed);
  }

  return sourceListingRecordSchema.parse(rawRecord);
};

export type LocalInputRecord = {
  datasetFileName: string;
  datasetRecordIndex: number;
  listingRecord: SourceListingRecord;
  detailHtmlPath: string;
};

export type LoadInputParams = {
  inputRootDir: string;
  recordsDirName: string;
  sampleSize: number | null;
};

export interface JobInputProvider {
  loadInputRecords(params: LoadInputParams): Promise<LocalInputRecord[]>;
}

const ensureSample = <T>(items: T[], sampleSize: number | null): T[] => {
  if (sampleSize === null) {
    return items;
  }

  return items.slice(0, sampleSize);
};

export class LocalScrapedJobsInputProvider implements JobInputProvider {
  constructor(private readonly logger: AppLogger) {}

  async loadInputRecords(params: LoadInputParams): Promise<LocalInputRecord[]> {
    const { inputRootDir, recordsDirName, sampleSize } = params;
    this.logger.info(
      { inputRootDir, recordsDirName, sampleSize: sampleSize ?? 'all' },
      'Loading input records from local scraped dataset',
    );

    const entries = await readdir(inputRootDir, { withFileTypes: true });
    const jsonFiles = entries
      .filter((entry) => entry.isFile() && jsonFilePattern.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, 'en'));
    this.logger.info({ jsonFilesCount: jsonFiles.length }, 'Discovered dataset files');

    const records: LocalInputRecord[] = [];

    for (const jsonFileName of jsonFiles) {
      const datasetPath = path.join(inputRootDir, jsonFileName);
      const rawDataset = await readFile(datasetPath, 'utf8');
      const parsedDataset = JSON.parse(rawDataset) as unknown;
      this.logger.debug(
        { datasetFileName: jsonFileName, datasetPath, datasetSizeBytes: rawDataset.length },
        'Loaded dataset file',
      );

      if (!Array.isArray(parsedDataset)) {
        throw new Error(`Dataset file "${jsonFileName}" is not a JSON array.`);
      }

      parsedDataset.forEach((rawRecord, datasetRecordIndex) => {
        const listingRecord = toListingRecord(rawRecord);
        const detailHtmlPath = path.join(
          inputRootDir,
          recordsDirName,
          listingRecord.htmlDetailPageKey,
        );

        records.push({
          datasetFileName: jsonFileName,
          datasetRecordIndex,
          listingRecord,
          detailHtmlPath,
        });
      });
    }

    const sampledRecords = ensureSample(records, sampleSize);
    this.logger.info(
      { totalRecordsFound: records.length, recordsSelected: sampledRecords.length },
      'Prepared input records',
    );

    return sampledRecords;
  }
}
