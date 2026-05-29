# Result Proposal Test Strategy

## Scope

This strategy covers the T+120 result proposal flow:

- Production scheduler prompts admin with AI/web-search result proposal and public source links.
- `/dryrun` creates synthetic `DRY-` matches for orchestration checks.
- `/dryrun_finish` simulates T+120 by sending synthetic result proposals with Y/N buttons.

## Goals

- Admin verifies sources, then taps Y to confirm and auto-settle, or taps N to reject.
- Bot writes production final scores only after an admin taps Y on a stored proposal.
- T+120 proposals include status, score when clear, short summary, and source links for real matches.
- Dry-run can exercise the admin-confirm workflow without depending on real public match sources.

## Automated Tests

Run locally before deploy:

```bash
npm test
node --check src/core.js
node --check src/config.js
node --check src/ai.js
node --check src/sheets.js
node --check src/telegram.js
node --check src/main.js
```

Coverage focus:

- Scheduler emits `PROMPT_RESULT` at T+120 only for locked matches without final score.
- AI result proposal prompt requires 1-2 public sources and JSON output.
- Proposal normalization rejects partial scores and filters invalid source URLs.
- Admin proposal formatting includes source links and Y/N confirm controls.
- Proposal patches persist proposed score, summary, sources, and decision fields separately from final result fields.
- Confirm patch copies the stored proposal into final result fields before settlement.
- Dry-run result proposal is synthetic, has no public source links, and settles only after Y confirmation.
- Command help describes `/dryrun_finish` as a T+120 proposal step with button confirmation.

## Manual Dry-Run Check

1. Run `/dryrun`.
2. Confirm the bot reports created/refreshed `DRY-` matches and says to use `/dryrun_finish` for T+120 proposals.
3. Use `/matches` and make at least one pick if desired.
4. Run `/dryrun_finish`.
5. Confirm the bot sends one proposal per unsettled `DRY-` match.
6. Tap N on one proposal and confirm the match is not settled.
7. Tap Y on one proposal.
8. Confirm the bot writes the proposed final score, settles the match, and sends recap.

## Production Smoke Check

For one real locked match after T+120:

1. Let `runScheduler()` process the match.
2. Confirm admin receives an AI/search proposal.
3. Verify the message contains 1-2 public source links when sources are available.
4. Check those links manually.
5. Tap Y only if the score is correct, then confirm result and recap are produced automatically.
6. Tap N if the score is wrong or unclear, then enter the result manually with `/result` and `/settle`.

## Failure Cases

- Missing OpenAI config or API failure: bot falls back to the manual result prompt.
- Ambiguous public sources: AI should return `UNKNOWN` or no score; the proposal only allows reject, and admin must enter result manually.
- Invalid AI URLs: normalizer filters them out of the admin message.
- Re-running `/dryrun` refreshes previous `DRY-` result and prompt state.
