import {
  artifactStorageSnapshotSchema,
  downloadableJsonDeliveryConfigSchema,
  type ArtifactStorageSnapshot,
  type DownloadableJsonDeliveryConfig,
} from '@repo/control-plane-contracts';
import { env } from '@/server/env';
import { defaultArtifactRootDir, defaultJsonOutputRootDir } from '@/server/control-plane/paths';

function requireConfiguredValue(value: string | undefined, label: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${label} must be configured for the selected storage backend.`);
  }

  return value.trim();
}

export function buildManagedArtifactStorageSnapshot(): ArtifactStorageSnapshot {
  if (env.CONTROL_PLANE_ARTIFACT_STORAGE_BACKEND === 'gcs') {
    return artifactStorageSnapshotSchema.parse({
      type: 'gcs',
      config: {
        bucket: requireConfiguredValue(
          env.CONTROL_PLANE_ARTIFACT_STORAGE_GCS_BUCKET,
          'CONTROL_PLANE_ARTIFACT_STORAGE_GCS_BUCKET',
        ),
        prefix: env.CONTROL_PLANE_ARTIFACT_STORAGE_GCS_PREFIX,
      },
    });
  }

  return artifactStorageSnapshotSchema.parse({
    type: 'local_filesystem',
    config: {
      basePath: defaultArtifactRootDir,
    },
  });
}

export function buildManagedDownloadableJsonDeliveryConfig(): DownloadableJsonDeliveryConfig {
  if (env.CONTROL_PLANE_DOWNLOADABLE_OUTPUT_BACKEND === 'gcs') {
    return downloadableJsonDeliveryConfigSchema.parse({
      storageType: 'gcs',
      bucket: requireConfiguredValue(
        env.CONTROL_PLANE_DOWNLOADABLE_OUTPUT_GCS_BUCKET,
        'CONTROL_PLANE_DOWNLOADABLE_OUTPUT_GCS_BUCKET',
      ),
      prefix: env.CONTROL_PLANE_DOWNLOADABLE_OUTPUT_GCS_PREFIX,
    });
  }

  return downloadableJsonDeliveryConfigSchema.parse({
    storageType: 'local_filesystem',
    basePath: defaultJsonOutputRootDir,
  });
}
