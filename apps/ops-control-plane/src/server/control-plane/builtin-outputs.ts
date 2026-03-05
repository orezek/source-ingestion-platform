import type { StructuredOutputDestination } from '@repo/control-plane-contracts';
import { nowIso, structuredOutputDestinationSchema } from '@repo/control-plane-contracts';

export const IMPLICIT_DOWNLOADABLE_JSON_DESTINATION_ID = 'downloadable-json';

export function isImplicitDownloadableJsonDestinationId(id: string): boolean {
  return id === IMPLICIT_DOWNLOADABLE_JSON_DESTINATION_ID;
}

export function buildImplicitDownloadableJsonDestination(): StructuredOutputDestination {
  const timestamp = nowIso();
  return structuredOutputDestinationSchema.parse({
    id: IMPLICIT_DOWNLOADABLE_JSON_DESTINATION_ID,
    name: 'Downloadable JSON',
    type: 'downloadable_json',
    config: {},
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
