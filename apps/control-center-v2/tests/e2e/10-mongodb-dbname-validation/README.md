# MongoDB Database Name Validation

This test validates database-name safety rules for operator sink configuration.

Focus:

- Enforce allowed charset (`A-Z`, `a-z`, `0-9`, `_`, `-`).
- Enforce MongoDB-safe max byte length (38 bytes).
