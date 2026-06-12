# Odds Proposal Test Strategy

## Scope

This strategy covers the T-24h missing-odds flow:

- Scheduler finds scheduled matches inside T-24h that do not have locked odds.
- Bot auto-applies a handicap line when the fixed source kqbd.mobi/keo-bong-da provides one, then opens picks.
- Bot notifies admins with source links and the applied/defaulted line; admins can adjust later with `/set_odds`.
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

- Scheduler emits `ODDS_ALERT` for missing odds inside T-24h so the bot can fetch/apply odds before opening.
- Scheduler does not repeat the odds prompt after `oddsAlertedAt` is set.
- AI odds prompt asks for the fixed kqbd.mobi/keo-bong-da full-match handicap line and a JSON-only Asian handicap payload.
- Odds proposal normalization accepts `HOME`/`AWAY`, numeric handicap, and filters invalid URLs.
- Auto-apply patch copies clear proposal values into confirmed odds fields with `AUTO_APPLIED`.
- Missing/unclear source line defaults to HOME 0 with `DEFAULTED`.
- Dry-run odds proposal is synthetic and source-free.

## Manual Dry-Run Check

For an exact match such as the C1 final:

```text
/add_match DRY-C1-FINAL-2026 2026-05-30T16:00:00.000Z KNOCKOUT Paris_Saint-Germain vs Arsenal
```

Then run scheduler inside T-24h, or create the match with kickoff inside the next 24 hours.

Expected:

1. Bot sends an admin handicap summary without Y/N buttons.
2. Bot writes the proposed odds automatically.
3. Bot opens pick immediately.
4. Use `/matches` to confirm the match is visible for players.
5. If the line is wrong, use `/set_odds <matchId> <HOME|AWAY> <handicap>` and confirm players get the odds update.

## Production Smoke Check

For one real scheduled match inside T-24h without odds:

1. Let `runScheduler()` process the match.
2. Confirm admin receives an AI/search handicap summary.
3. Verify the source links manually.
4. Confirm odds are written and picks open automatically.
5. If the line is wrong or sources are unclear, enter corrected odds with `/set_odds`.

## Failure Cases

- Missing OpenAI config or API failure: bot opens with default HOME 0 and notifies admins to adjust with `/set_odds`.
- Ambiguous public sources: AI should return no line; bot defaults HOME 0 and notifies admins.
- Admin corrects after kickoff: bot refuses because odds can no longer be changed.
- Re-running `/dryrun` clears previous odds proposal state.
