## What this changes

<!-- One or two sentences. If it fixes an issue, "Fixes #123". -->

## Why

<!-- The problem, not the patch. What was wrong or missing? -->

## How it was verified

<!--
Say what you actually ran, not what could be run. If it touches:
  - the graph or a service → the commands you ran and what you saw
  - the visualiser → a screenshot, and which theme(s)
  - packaging → `pnpm --filter cognitive-mirror build` and a tarball install
  - anything security-relevant → the negative case too (the request that
    should be rejected, and that it was)
-->

## Checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass
- [ ] Comments explain *why*, where the reasoning isn't obvious from the code
- [ ] Docs updated if behaviour or setup changed
- [ ] No secrets, personal paths, or graph contents in the diff
