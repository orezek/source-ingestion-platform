# MongoDB URI Validation

This test validates that only MongoDB connection URI schemes are accepted.

Focus:

- Reject generic URL schemes for sink credentials.
- Accept `mongodb+srv://` for modern Atlas-style deployments.
