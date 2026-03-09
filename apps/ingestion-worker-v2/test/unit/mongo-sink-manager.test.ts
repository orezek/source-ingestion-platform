import assert from 'node:assert/strict';
import test from 'node:test';
import { MongoClient } from 'mongodb';
import { MongoSinkManager } from '../../src/mongo-sink-manager.js';

function createManager(): MongoSinkManager {
  return new MongoSinkManager({
    maxPoolSize: 5,
    maxConnecting: 2,
    waitQueueTimeoutMs: 5_000,
    idleTtlMs: 1_000,
    maxActiveClients: 4,
    logger: {
      debug() {},
      warn() {},
    },
  });
}

test('acquire closes client and does not retain failed sink when ping fails', async () => {
  const originalConnect = MongoClient.prototype.connect;
  const originalDb = MongoClient.prototype.db;
  const originalClose = MongoClient.prototype.close;

  let connectCalls = 0;
  let closeCalls = 0;

  MongoClient.prototype.connect = (async function (this: MongoClient) {
    connectCalls += 1;
    return this;
  }) as typeof MongoClient.prototype.connect;

  MongoClient.prototype.db = (function (this: MongoClient) {
    return {
      command: async () => {
        throw new Error('ping failed');
      },
    } as unknown as ReturnType<typeof MongoClient.prototype.db>;
  }) as typeof MongoClient.prototype.db;

  MongoClient.prototype.close = (async function (this: MongoClient) {
    closeCalls += 1;
    return this;
  }) as typeof MongoClient.prototype.close;

  try {
    const manager = createManager();
    const sink = {
      mongodbUri: 'mongodb://example.invalid:27017',
      dbName: 'pipeline_db',
    };

    await assert.rejects(() => manager.acquire(sink), /ping failed/);
    await assert.rejects(() => manager.acquire(sink), /ping failed/);

    assert.equal(connectCalls, 2);
    assert.equal(closeCalls, 2);
  } finally {
    MongoClient.prototype.connect = originalConnect;
    MongoClient.prototype.db = originalDb;
    MongoClient.prototype.close = originalClose;
  }
});
