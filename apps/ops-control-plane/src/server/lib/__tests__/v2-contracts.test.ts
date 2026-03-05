import {
  crawlRunSummaryProjectionV2Fixture,
  crawlRunSummaryProjectionV2Schema,
  crawlerStartRunRequestV2Fixture,
  crawlerStartRunRequestV2Schema,
  ingestionRunSummaryProjectionV2Fixture,
  ingestionRunSummaryProjectionV2Schema,
  ingestionStartRunRequestV2Fixture,
  ingestionStartRunRequestV2Schema,
  ingestionTriggerRequestProjectionV2Fixture,
  ingestionTriggerRequestProjectionV2Schema,
  startRunAcceptedResponseV2Fixture,
  startRunResponseV2Schema,
  workerLifecycleEventV2Fixtures,
  workerLifecycleEventV2Schema,
} from '@repo/control-plane-contracts';
import { describe, expect, it } from 'vitest';

describe('v2 control-plane contracts', () => {
  it('validates crawler and ingestion StartRun fixtures', () => {
    expect(crawlerStartRunRequestV2Schema.parse(crawlerStartRunRequestV2Fixture)).toEqual(
      crawlerStartRunRequestV2Fixture,
    );
    expect(ingestionStartRunRequestV2Schema.parse(ingestionStartRunRequestV2Fixture)).toEqual(
      ingestionStartRunRequestV2Fixture,
    );
  });

  it('rejects ingestion StartRun payload missing inputRef', () => {
    const invalidRequest = {
      ...ingestionStartRunRequestV2Fixture,
      inputRef: undefined,
    };
    const result = ingestionStartRunRequestV2Schema.safeParse(invalidRequest);
    expect(result.success).toBe(false);
  });

  it('validates v2 StartRun response fixture', () => {
    expect(startRunResponseV2Schema.parse(startRunAcceptedResponseV2Fixture)).toEqual(
      startRunAcceptedResponseV2Fixture,
    );
  });

  it('validates v2 worker lifecycle event fixtures', () => {
    expect(workerLifecycleEventV2Fixtures).toHaveLength(2);
    for (const event of workerLifecycleEventV2Fixtures) {
      expect(workerLifecycleEventV2Schema.parse(event)).toEqual(event);
    }
  });

  it('validates v2 persistence projection fixtures', () => {
    expect(crawlRunSummaryProjectionV2Schema.parse(crawlRunSummaryProjectionV2Fixture)).toEqual(
      crawlRunSummaryProjectionV2Fixture,
    );
    expect(
      ingestionRunSummaryProjectionV2Schema.parse(ingestionRunSummaryProjectionV2Fixture),
    ).toEqual(ingestionRunSummaryProjectionV2Fixture);
    expect(
      ingestionTriggerRequestProjectionV2Schema.parse(ingestionTriggerRequestProjectionV2Fixture),
    ).toEqual(ingestionTriggerRequestProjectionV2Fixture);
  });
});
