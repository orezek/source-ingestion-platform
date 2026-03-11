# Required Fields Gate

This test verifies the create-pipeline form blocks submission when required fields are missing.

Focus:

- Prevent empty pipeline artifacts from being created.
- Ensure inline validation appears before any API call is made.
- Confirm pipeline creation never triggers run-start behavior.
