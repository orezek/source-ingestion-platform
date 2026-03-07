# `@repo/control-plane-adapters`

Shared runtime adapters for the OmniCrawl control plane.

This package owns:

- artifact-store helpers for local filesystem and GCS
- structured JSON sink writes for local filesystem and GCS
- broker publishing and consumption for local archive mode and Google Cloud Pub/Sub

It is intentionally runtime-focused so the Next.js app and worker apps do not each reimplement
cloud adapter behavior.
