<!--
Every section below is required. A pull request that leaves a section empty,
or replaces it with "n/a" without saying why, will be asked for changes.
Keep the headings — reviewers and automation look for them.
-->

## What changed

<!-- The change itself, in plain language. What a reader of the diff would see.
     If several unrelated things changed, that is a sign this should be more
     than one pull request. -->

## Why

<!-- The problem this solves, not a restatement of the diff. Link the issue if
     one exists. If this came from a bug, describe how it was reproduced. -->

## Impact

<!-- Who or what is affected. Call out explicitly, and write "none" where it
     genuinely does not apply:
     - Breaking changes to the MCP tool surface, CLI flags, or config schema
     - Changes to the security boundary: worktree isolation, path
       sanitization, environment stripping, worker permissions
     - Changes to what ships in the npm package or the standalone binaries
     - Performance or disk-footprint effects -->

## Tests

<!-- What you ran and what it proved. Paste the result, not a claim:
     the `npm test` summary line, or the new test names and what they cover.
     If the change is not covered by tests, say so and explain why. -->

## Author review

<!-- Required by CONTRIBUTING.md § Review policy. -->

- [ ] I read the full diff of this pull request myself, hunk by hunk, before opening it.
- [ ] `npm test`, `npm run typecheck` and `npm run lint` pass on my machine.
- [ ] I verified the behaviour by running it, not only by the test suite passing.
- [ ] Any AI-assisted changes in this diff were reviewed by me line by line, and I can explain every one of them.
