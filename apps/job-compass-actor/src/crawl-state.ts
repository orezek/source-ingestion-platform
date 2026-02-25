import { MongoClient, type AnyBulkWriteOperation, type Collection } from 'mongodb';

type ListingSnapshot = {
  adUrl: string;
  jobTitle: string;
  companyName: string;
  location: string;
  salary: string | null;
  publishedInfoText: string;
};

export type CrawlListingRecord = ListingSnapshot & {
  source: string;
  sourceId: string;
};

export type CrawlDetailSnapshot = {
  sourceId: string;
  requestedDetailUrl: string;
  finalDetailUrl: string;
  finalDetailHost: string;
  detailRedirected: boolean;
  detailRenderType: 'jobscz-template' | 'widget' | 'vacancy-detail' | 'unknown';
  detailRenderSignal: 'none' | 'widget_container_text' | 'vacancy_detail_text';
  detailRenderTextChars: number;
  detailRenderWaitMs: number;
  detailRenderComplete: boolean;
  htmlDetailPageKey: string;
  detailHtmlByteSize: number;
  detailHtmlSha256: string;
  scrapedAt: string;
};

export type CrawlJobsStateDoc = {
  _id: string;
  source: string;
  sourceId: string;
  isActive: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  firstSeenRunId: string;
  lastSeenRunId: string;
  lastInactiveRunId?: string;
  inactiveAt?: string;
  listing: ListingSnapshot;
  detail?: CrawlDetailSnapshot;
  createdAt: string;
  updatedAt: string;
};

export type CrawlStateRepositoryConfig = {
  mongoUri: string;
  dbName: string;
  collectionName: string;
};

export type ReconcileListingsInput = {
  source: string;
  crawlRunId: string;
  observedAtIso: string;
  listings: CrawlListingRecord[];
  forceSkipInactiveMarking?: boolean;
  forceSkipInactiveMarkingReason?: string;
  massInactivationGuardMinActiveCount: number;
  massInactivationGuardMinSeenRatio: number;
};

export type ReconcileListingsResult = {
  totalSeen: number;
  newListings: CrawlListingRecord[];
  existingCount: number;
  activeBeforeCount: number;
  inactiveMarkedCount: number;
  inactiveMarkingSkipped: boolean;
  inactiveMarkingSkipReason: string | null;
};

type ExistingSourceIdDoc = Pick<CrawlJobsStateDoc, 'sourceId'>;

const DEFAULT_IN_QUERY_CHUNK_SIZE = 1000;

const chunkArray = <T>(items: T[], chunkSize: number): T[][] => {
  if (items.length === 0) {
    return [];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

const crawlJobDocId = (source: string, sourceId: string): string => `${source}:${sourceId}`;

export class CrawlStateRepository {
  private readonly client: MongoClient;

  private connected = false;

  constructor(private readonly config: CrawlStateRepositoryConfig) {
    this.client = new MongoClient(config.mongoUri);
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    await this.client.connect();
    this.connected = true;
  }

  async close(): Promise<void> {
    if (!this.connected) {
      return;
    }

    await this.client.close();
    this.connected = false;
  }

  private collection(): Collection<CrawlJobsStateDoc> {
    return this.client
      .db(this.config.dbName)
      .collection<CrawlJobsStateDoc>(this.config.collectionName);
  }

  async ensureIndexes(): Promise<void> {
    const collection = this.collection();
    await collection.createIndexes([
      { key: { source: 1, sourceId: 1 }, name: 'source_sourceId_unique', unique: true },
      { key: { source: 1, isActive: 1 }, name: 'source_isActive' },
      { key: { source: 1, lastSeenRunId: 1 }, name: 'source_lastSeenRunId' },
      { key: { source: 1, updatedAt: 1 }, name: 'source_updatedAt' },
    ]);
  }

  async reconcileListings(input: ReconcileListingsInput): Promise<ReconcileListingsResult> {
    const { source, crawlRunId, observedAtIso, listings } = input;
    const collection = this.collection();

    if (listings.length === 0) {
      const activeBeforeCount = await collection.countDocuments({ source, isActive: true });
      const shouldSkipInactiveMarking =
        input.forceSkipInactiveMarking ||
        (activeBeforeCount >= input.massInactivationGuardMinActiveCount &&
          input.massInactivationGuardMinSeenRatio > 0);

      let inactiveMarkedCount = 0;
      let inactiveMarkingSkipped = false;
      let inactiveMarkingSkipReason: string | null = null;

      if (shouldSkipInactiveMarking) {
        inactiveMarkingSkipped = true;
        inactiveMarkingSkipReason =
          input.forceSkipInactiveMarkingReason ??
          (input.forceSkipInactiveMarking ? 'forced_skip' : 'zero_listings_seen_guard');
      } else {
        const inactiveResult = await collection.updateMany(
          { source, isActive: true },
          {
            $set: {
              isActive: false,
              inactiveAt: observedAtIso,
              lastInactiveRunId: crawlRunId,
              updatedAt: observedAtIso,
            },
          },
        );
        inactiveMarkedCount = inactiveResult.modifiedCount;
      }

      return {
        totalSeen: 0,
        newListings: [],
        existingCount: 0,
        activeBeforeCount,
        inactiveMarkedCount,
        inactiveMarkingSkipped,
        inactiveMarkingSkipReason,
      };
    }

    const sourceIds = listings.map((item) => item.sourceId);
    const existingSourceIds = new Set<string>();
    for (const sourceIdsChunk of chunkArray(sourceIds, DEFAULT_IN_QUERY_CHUNK_SIZE)) {
      const docs = await collection
        .find<ExistingSourceIdDoc>(
          {
            source,
            sourceId: { $in: sourceIdsChunk },
          },
          { projection: { _id: 0, sourceId: 1 } },
        )
        .toArray();

      for (const doc of docs) {
        existingSourceIds.add(doc.sourceId);
      }
    }

    const newListings = listings.filter((listing) => !existingSourceIds.has(listing.sourceId));
    const existingCount = listings.length - newListings.length;

    const activeBeforeCount = await collection.countDocuments({ source, isActive: true });

    const upsertOperations: AnyBulkWriteOperation<CrawlJobsStateDoc>[] = listings.map((listing) => ({
      updateOne: {
        filter: { source, sourceId: listing.sourceId },
        update: {
          $set: {
            source,
            sourceId: listing.sourceId,
            isActive: true,
            lastSeenAt: observedAtIso,
            lastSeenRunId: crawlRunId,
            listing: {
              adUrl: listing.adUrl,
              jobTitle: listing.jobTitle,
              companyName: listing.companyName,
              location: listing.location,
              salary: listing.salary,
              publishedInfoText: listing.publishedInfoText,
            },
            updatedAt: observedAtIso,
          },
          $setOnInsert: {
            _id: crawlJobDocId(source, listing.sourceId),
            firstSeenAt: observedAtIso,
            firstSeenRunId: crawlRunId,
            createdAt: observedAtIso,
          },
          $unset: {
            inactiveAt: 1,
            lastInactiveRunId: 1,
          },
        },
        upsert: true,
      },
    }));

    if (upsertOperations.length > 0) {
      await collection.bulkWrite(upsertOperations, { ordered: false });
    }

    const seenRatio = activeBeforeCount > 0 ? listings.length / activeBeforeCount : 1;
    const inactiveMarkingSkipped =
      input.forceSkipInactiveMarking ||
      (activeBeforeCount >= input.massInactivationGuardMinActiveCount &&
        seenRatio < input.massInactivationGuardMinSeenRatio);

    let inactiveMarkedCount = 0;
    let inactiveMarkingSkipReason: string | null = null;

    if (inactiveMarkingSkipped) {
      inactiveMarkingSkipReason =
        input.forceSkipInactiveMarkingReason ??
        (input.forceSkipInactiveMarking ? 'forced_skip' : 'mass_inactivation_guard');
    } else {
      const inactiveResult = await collection.updateMany(
        {
          source,
          isActive: true,
          lastSeenRunId: { $ne: crawlRunId },
        },
        {
          $set: {
            isActive: false,
            inactiveAt: observedAtIso,
            lastInactiveRunId: crawlRunId,
            updatedAt: observedAtIso,
          },
        },
      );
      inactiveMarkedCount = inactiveResult.modifiedCount;
    }

    return {
      totalSeen: listings.length,
      newListings,
      existingCount,
      activeBeforeCount,
      inactiveMarkedCount,
      inactiveMarkingSkipped,
      inactiveMarkingSkipReason,
    };
  }

  async updateDetailSnapshots(params: {
    source: string;
    detailSnapshots: CrawlDetailSnapshot[];
    updatedAtIso: string;
  }): Promise<number> {
    const { source, detailSnapshots, updatedAtIso } = params;
    if (detailSnapshots.length === 0) {
      return 0;
    }

    const collection = this.collection();
    const operations: AnyBulkWriteOperation<CrawlJobsStateDoc>[] = detailSnapshots.map((detailSnapshot) => ({
      updateOne: {
        filter: { source, sourceId: detailSnapshot.sourceId },
        update: {
          $set: {
            detail: detailSnapshot,
            updatedAt: updatedAtIso,
          },
        },
      },
    }));

    const result = await collection.bulkWrite(operations, { ordered: false });
    return result.modifiedCount + result.upsertedCount;
  }
}
