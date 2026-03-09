import { MongoClient, type Db } from 'mongodb';

type LoggerLike = {
  debug: (obj: Record<string, unknown>, message: string) => void;
  warn: (obj: Record<string, unknown>, message: string) => void;
};

export type MongoSinkRouting = {
  mongodbUri: string;
  dbName: string;
};

export type MongoSinkLease = {
  key: string;
  db: Db;
  dbName: string;
  release: () => Promise<void>;
};

type ManagerOptions = {
  maxPoolSize: number;
  maxConnecting: number;
  waitQueueTimeoutMs: number;
  idleTtlMs: number;
  maxActiveClients: number;
  logger: LoggerLike;
};

type SinkEntry = {
  key: string;
  dbName: string;
  redactedUri: string;
  client: MongoClient;
  db: Db;
  refCount: number;
  idleTimer: NodeJS.Timeout | null;
};

export class MongoSinkCapacityError extends Error {
  public readonly code = 'MONGODB_SINK_CAPACITY_EXCEEDED';
}

function buildSinkKey(input: MongoSinkRouting): string {
  return `${input.mongodbUri}|${input.dbName}`;
}

function redactMongoUri(uri: string): string {
  try {
    const parsed = new URL(uri);
    if (parsed.username || parsed.password) {
      parsed.username = '***';
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return '***';
  }
}

export class MongoSinkManager {
  private readonly entries = new Map<string, SinkEntry>();

  public constructor(private readonly options: ManagerOptions) {}

  public async acquire(target: MongoSinkRouting): Promise<MongoSinkLease> {
    const key = buildSinkKey(target);
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= this.options.maxActiveClients) {
        throw new MongoSinkCapacityError(
          `Worker sink-client limit reached (${this.options.maxActiveClients} distinct sinks).`,
        );
      }

      const client = new MongoClient(target.mongodbUri, {
        maxPoolSize: this.options.maxPoolSize,
        maxConnecting: this.options.maxConnecting,
        waitQueueTimeoutMS: this.options.waitQueueTimeoutMs,
      });
      try {
        await client.connect();
        const db = client.db(target.dbName);
        await db.command({ ping: 1 });
        entry = {
          key,
          dbName: target.dbName,
          redactedUri: redactMongoUri(target.mongodbUri),
          client,
          db,
          refCount: 0,
          idleTimer: null,
        };
        this.entries.set(key, entry);
        this.options.logger.debug(
          {
            sinkKey: key,
            dbName: target.dbName,
            mongodbUri: entry.redactedUri,
            activeSinkClients: this.entries.size,
          },
          'Mongo sink client created.',
        );
      } catch (error) {
        await client.close().catch(() => undefined);
        throw error;
      }
    }

    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    entry.refCount += 1;

    return {
      key: entry.key,
      db: entry.db,
      dbName: entry.dbName,
      release: async () => this.release(entry.key),
    };
  }

  public async closeAll(): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();

    await Promise.all(
      entries.map(async (entry) => {
        if (entry.idleTimer) {
          clearTimeout(entry.idleTimer);
        }
        await entry.client.close().catch(() => undefined);
      }),
    );
  }

  private async release(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }

    entry.refCount = Math.max(0, entry.refCount - 1);
    if (entry.refCount > 0 || entry.idleTimer) {
      return;
    }

    entry.idleTimer = setTimeout(() => {
      void this.closeEntryIfUnused(key);
    }, this.options.idleTtlMs);
  }

  private async closeEntryIfUnused(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry || entry.refCount > 0) {
      return;
    }

    this.entries.delete(key);
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }

    try {
      await entry.client.close();
      this.options.logger.debug(
        {
          sinkKey: key,
          dbName: entry.dbName,
          mongodbUri: entry.redactedUri,
          activeSinkClients: this.entries.size,
        },
        'Mongo sink client closed after idle TTL.',
      );
    } catch (error) {
      this.options.logger.warn(
        {
          err: error,
          sinkKey: key,
          dbName: entry.dbName,
        },
        'Failed to close idle Mongo sink client.',
      );
    }
  }
}
