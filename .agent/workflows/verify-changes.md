---
description: Verify changes before notifying the user
---

Before notifying the user of completion, perform the following verification steps:

1. **Static Analysis (Required)**
   Run the TypeScript compiler to check for type errors and undefined variables.
   ```powershell
   cd client
   npx tsc --noEmit
   ```
   If there are errors, FIX THEM before proceeding.

2. **Linting (Recommended)**
   Run the linter to catch common issues.
    ```powershell
   cd client
   npm run lint
   ```

3. **Browser Smoke Test (If Applicable)**
   If the changes involve UI flow, use the `browser_subagent` to click through the critical path.
   - Example: Open the modified modal, click the button, verify the result.
   - If `browser_subagent` fails due to environment, rely on Static Analysis and manual code review, but mention this to the user.

4. **Self-Correction**
   If any verification step fails, fix the code and RE-RUN the verification.
