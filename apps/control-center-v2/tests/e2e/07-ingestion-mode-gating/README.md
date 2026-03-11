# Ingestion Mode Gating

This test validates `crawl_only` mode disables ingestion tuning and strips ingestion runtime
from the create payload.

Focus:

- Prevent ingestion settings from leaking into crawl-only pipelines.
- Confirm create flow remains non-executing.
