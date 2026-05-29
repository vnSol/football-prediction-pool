# Odds Proposal Test Strategy

## Scope

This strategy covers the T-6h missing-odds flow:

- Scheduler finds scheduled matches inside T-6h that do not have locked odds.
- Bot proposes a handicap line to admins with source links for real matches.
- Admin taps Y to confirm and open picks, or N to reject and use `/set_odds`.
- Dry-run uses a synthetic odds proposal for `DRY-` matches instead of public source links.

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

- Scheduler emits `ODDS_ALERT` for missing odds inside T-6h instead of opening with default odds.
- Scheduler does not repeat the odds prompt after `oddsAlertedAt` is set.
- AI odds prompt asks for 1-2 public sources and a JSON-only Asian handicap proposal.
- Odds proposal normalization accepts `HOME`/`AWAY`, numeric handicap, and filters invalid URLs.
- Confirm patch copies stored proposal values into confirmed odds fields.
- Dry-run odds proposal is synthetic and source-free.

## Manual Dry-Run Check

For an exact match such as the C1 final:

```text
/add_match DRY-C1-FINAL-2026 2026-05-30T16:00:00.000Z KNOCKOUT Paris_Saint-Germain vs Arsenal
```

Then run scheduler inside T-6h, or create the match with kickoff inside the next six hours.

Expected:

1. Bot sends a handicap proposal with Y/N buttons.
2. Tap N and confirm the match does not open.
3. Recreate or refresh the dry-run match.
4. Tap Y and confirm the bot writes odds and opens pick.
5. Use `/matches` to confirm the match is visible for players.

## Production Smoke Check

For one real scheduled match inside T-6h without odds:

1. Let `runScheduler()` process the match.
2. Confirm admin receives an AI/search handicap proposal.
3. Verify the source links manually.
4. Tap Y only if the line is correct.
5. Confirm odds are written and picks open automatically.
6. Tap N if sources are unclear, then enter odds manually with `/set_odds`.

## Failure Cases

- Missing OpenAI config or API failure: bot falls back to the manual `/set_odds` prompt.
- Ambiguous public sources: AI should return no line; proposal only offers reject.
- Admin confirms after kickoff: bot refuses because odds can no longer be changed.
- Re-running `/dryrun` clears previous odds proposal state.
