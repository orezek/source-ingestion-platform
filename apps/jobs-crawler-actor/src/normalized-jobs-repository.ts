import { MongoClient, type AnyBulkWriteOperation, type Collection } from 'mongodb';

export type ListingSnapshot = {
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

type NormalizedJobDoc = {
  id: string;
  source: string;
  sourceId: string;
  searchSpaceId: string;
  isActive: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  firstSeenRunId: string;
  lastSeenRunId: string;
  adUrl?: string;
  scrapedAt?: string;
  listing?: {
    jobTitle: string;
    companyName: string | null;
    locationText: string | null;
    salaryText: string | null;
    publishedInfoText: string | null;
  };
  updatedAt?: string;
};

export type NormalizedJobsRepositoryConfig = {
  mongoUri: string;
  dbName: string;
  collectionName: string;
};

export type ReconcileListingsInput = {
  source: string;
  searchSpaceId: string;
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
  existingSeenUpdatedCount: number;
};

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

export class NormalizedJobsRepository {
  private readonly client: MongoClient;

  private connected = false;

  constructor(private readonly config: NormalizedJobsRepositoryConfig) {
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

  private collection(): Collection<NormalizedJobDoc> {
    return this.client
      .db(this.config.dbName)
      .collection<NormalizedJobDoc>(this.config.collectionName);
  }

  async ensureIndexes(): Promise<void> {
    const collection = this.collection();
    await collection.createIndexes([
      { key: { id: 1 }, name: 'id_unique', unique: true },
      { key: { source: 1, sourceId: 1 }, name: 'source_sourceId' },
      { key: { searchSpaceId: 1, isActive: 1 }, name: 'searchSpaceId_isActive' },
      { key: { searchSpaceId: 1, lastSeenRunId: 1 }, name: 'searchSpaceId_lastSeenRunId' },
      { key: { searchSpaceId: 1, updatedAt: 1 }, name: 'searchSpaceId_updatedAt' },
    ]);
  }

  async reconcileListings(input: ReconcileListingsInput): Promise<ReconcileListingsResult> {
    const { source, searchSpaceId, crawlRunId, observedAtIso, listings } = input;
    const collection = this.collection();

    const activeFilter = { source, searchSpaceId, isActive: true };
    const activeBeforeCount = await collection.countDocuments(activeFilter);

    if (listings.length === 0) {
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
        const inactiveResult = await collection.updateMany(activeFilter, {
          $set: {
            isActive: false,
            updatedAt: observedAtIso,
          },
        });
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
        existingSeenUpdatedCount: 0,
      };
    }

    const seenSourceIds = listings.map((item) => item.sourceId);
    const existingSourceIds = new Set<string>();

    for (const sourceIdsChunk of chunkArray(seenSourceIds, DEFAULT_IN_QUERY_CHUNK_SIZE)) {
      const docs = await collection
        .find(
          {
            source,
            searchSpaceId,
            sourceId: { $in: sourceIdsChunk },
          },
          { projection: { _id: 0, sourceId: 1 } },
        )
        .toArray();

      for (const doc of docs) {
        if (typeof doc.sourceId === 'string') {
          existingSourceIds.add(doc.sourceId);
        }
      }
    }

    const newListings = listings.filter((listing) => !existingSourceIds.has(listing.sourceId));
    const existingListings = listings.filter((listing) => existingSourceIds.has(listing.sourceId));
    const existingCount = existingListings.length;

    const updateExistingOperations: AnyBulkWriteOperation<NormalizedJobDoc>[] =
      existingListings.map((listing) => ({
        updateOne: {
          filter: { source, searchSpaceId, sourceId: listing.sourceId },
          update: {
            $set: {
              isActive: true,
              lastSeenAt: observedAtIso,
              lastSeenRunId: crawlRunId,
              adUrl: listing.adUrl,
              scrapedAt: observedAtIso,
              listing: {
                jobTitle: listing.jobTitle,
                companyName: listing.companyName || null,
                locationText: listing.location || null,
                salaryText: listing.salary,
                publishedInfoText: listing.publishedInfoText || null,
              },
              updatedAt: observedAtIso,
            },
          },
        },
      }));

    if (updateExistingOperations.length > 0) {
      await collection.bulkWrite(updateExistingOperations, { ordered: false });
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
          ...activeFilter,
          sourceId: { $nin: seenSourceIds },
        },
        {
          $set: {
            isActive: false,
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
      existingSeenUpdatedCount: existingListings.length,
    };
  }
}
