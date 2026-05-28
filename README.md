# World Cup Telegram Prediction Pool

Google Apps Script + Telegram Bot automation for an internal World Cup prediction pool.

## What It Does

- Opens Telegram picks at T-6h after odds are set.
- Lets players change picks through Telegram until kickoff.
- Sends T-30m reminders to players who have not picked.
- Locks at kickoff and defaults missing picks to the favorite side.
- At T+120m, uses AI/web search to propose score, match status, and public source links for admin verification.
- Lets admins confirm final scores after checking the source links.
- Settles points, updates Google Sheets, and sends a cheerful recap + leaderboard.
- Locks Sheets so players cannot overwrite data directly.

## Local Verification

```bash
npm test
```

Syntax check before pushing to Apps Script:

```bash
node --check src/core.js
node --check src/config.js
node --check src/ai.js
node --check src/sheets.js
node --check src/telegram.js
node --check src/main.js
```

## Google Apps Script Setup

1. Create a Google Sheet.
2. Create an Apps Script project bound to that Sheet, or configure `SPREADSHEET_ID` for a standalone script.
3. Add the files in `src/` and `appsscript.json` to the Apps Script project.
4. In Apps Script, set Script Properties:
   - `TELEGRAM_BOT_TOKEN`: Telegram bot token.
   - `ADMIN_CHAT_IDS`: comma-separated admin Telegram chat IDs.
   - `OPENAI_API_KEY`: OpenAI API key for AI lock messages and match recaps.
   - `OPENAI_MODEL`: optional; defaults to `gpt-5-mini`.
   - `RECAP_CHAT_ID`: group/channel chat ID for AI lock summaries and recap messages. If omitted, those broadcasts are skipped.
   - `SPREADSHEET_ID`: optional Sheet ID if the script is not bound to the Sheet.
5. Run `setup()` once from Apps Script. This creates/protects tabs and installs triggers.
6. Deploy as Web App, execute as owner, accessible by Telegram.
7. Run `setTelegramWebhook("YOUR_WEB_APP_URL")` from Apps Script.

Do not store tokens in `.env` or source files.

Apps Script file mapping:

```text
core.gs      <= src/core.js
config.gs    <= src/config.js
ai.gs        <= src/ai.js
sheets.gs    <= src/sheets.js
telegram.gs  <= src/telegram.js
main.gs      <= src/main.js
```

## Sheet Tabs

`setup()` creates these tabs:

- `Players`: `telegramUserId`, `displayName`, `active`, `isAdmin`
- `Matches`: schedule, odds, lock, result, and settlement state
- `Picks`: latest valid pick per player per match
- `Scores`: settled point rows
- `AuditLog`: all bot/admin writes
- `Config`: spare operational config

Example `Matches` row:

```text
matchId: M001
homeTeam: Andoria
awayTeam: New Avalon
kickoffUtc: 2026-06-12T19:00:00.000Z
stage: GROUP
status: SCHEDULED
favoriteSide: HOME
handicapSide: HOME
handicapGoals: -0.5
```

`/set_odds M001 HOME -0.5` stores the raw odds for settlement, but Telegram displays the odds as a positive line: `Kèo: New Avalon chấp Andoria 0.5 Trái`. If the raw odds is positive, the named side is displayed as the team giving the handicap.

Kickoff times are stored as UTC ISO strings and displayed in Telegram as `YYYY-MM-DD HH:mm GMT+7`. The draw button appears only when the handicap is a whole number such as `0`, `1`, or `2`; half/quarter lines hide the draw button.

## Player Commands

- `/commands`: show available commands for the current account role.
- `/matches`: show open matches with each match's remaining time before kickoff.
- `/mypick`: show picks, including missing picks, for matches in the next 6 hours.
- `/mypick <matchId>`: show current pick for one match.
- `/leaderboard`: show leaderboard.
- Inline buttons: choose home/draw/away and toggle star for knockout matches.

## Admin Commands

- `/add_player <telegramUserId> <display name>`
- `/set_player_active <telegramUserId> <true|false>`
- `/add_match <matchId> <kickoffUtc> <GROUP|KNOCKOUT> <home team> vs <away team>`
- `/set_match_time <matchId> <kickoffUtc>`
- `/reset_sheet`
- `/dryrun [baseTimeUtc]`
- `/dryrun_finish`
- `/set_odds <matchId> <HOME|AWAY> <handicap>`
- `/open <matchId>`
- `/lock <matchId>`
- `/result <matchId> <home-away> <event 1; event 2; event 3>`
- `/settle <matchId>`
- `/recap <matchId>`

Manual commands are fallback controls. Normal flow is handled by `runScheduler()`. If `/set_odds` is used for a scheduled match inside T-6h, the bot opens pick immediately.

## AI Messages

The bot uses OpenAI for three automated messages:

- After lock: a suspenseful betting summary based only on Sheet facts.
- At T+120m after kickoff: an admin-only result proposal using web search over 1-2 public sources. The message includes match status, proposed score if available, source links, and a suggested `/result` command. Admin must verify the links and confirm manually.
- After settle: a localized match recap using confirmed match facts, betting results, leaderboard, and web search over at most two public sources.

If OpenAI is not configured or the API call fails, the bot falls back to deterministic template messages so operations continue.

Use `gpt-5-mini` for the default MVP. It is cost-effective for this well-defined writing task. Use `gpt-5.2` only if you want a more polished recap and accept higher cost.

Examples:

```text
/add_player 123456789 Player One
/set_player_active 123456789 true
/add_match T001 2026-06-12T19:00:00.000Z GROUP Andoria vs New_Avalon
/add_match T002 2026-06-13T02:00:00.000Z KNOCKOUT Eastland vs Southmont
/set_match_time T001 2026-06-12T20:00:00.000Z
/dryrun
/dryrun 2026-06-12T00:00:00.000Z
/dryrun_finish
```

Use `_` for spaces in team names when needed; the bot stores `_` as spaces.

`/reset_sheet` shows sheet-name buttons and asks for confirmation before clearing data rows. It keeps headers and protection in place.

### `/dryrun` parameter

Syntax:

```text
/dryrun [baseTimeUtc]
```

`baseTimeUtc` is optional. Use an ISO-8601 UTC timestamp with `Z`, for example:

```text
/dryrun 2026-06-12T00:00:00.000Z
```

If omitted, the bot uses the current time when the command runs. The generated matches are scheduled relative to `baseTimeUtc`, with enough cases to test orchestration: group half handicap, group integer handicap, knockout half handicap, knockout integer/zero handicap, and one scheduled match without odds to trigger the zero-handicap fallback.

`/dryrun` asks the AI model to create 3-5 synthetic matches, normalizes them into orchestration-ready cases with `DRY-` match IDs, upserts them, and runs one scheduler pass so `/matches` can show newly opened picks immediately. Existing `DRY-` matches are refreshed with the new schedule, odds, status, and cleared result fields. If the AI call fails, the bot uses a deterministic fallback set. Use `/reset_sheet` when you want to clear old dry-run picks and score rows too.

Use `/dryrun_finish` to finish all unsettled `DRY-` matches immediately. The bot locks any dry-run match with odds, asks AI for synthetic final scores and match events, writes the result, and settles the matches. If the AI result call fails, it uses a deterministic fallback result for that match.

## Telegram Spam / Retry Recovery

If Telegram repeats the same bot reply many times, check:

```text
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo
```

Spam usually means Telegram is retrying the same update because the webhook did not return a clean 200 response. Common signs:

- `pending_update_count` is greater than `0`
- `last_error_message` contains `302 Moved Temporarily`, timeout, or another webhook error

Recovery:

1. Redeploy the Apps Script web app as a new version.
2. Confirm web app settings:
   - `Execute as`: `Me`
   - `Who has access`: `Anyone`
3. Drop old retry backlog:

```text
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/deleteWebhook?drop_pending_updates=true
```

4. Run `setupWebhook()` again with the current `/exec` Web App URL.
5. Recheck `getWebhookInfo`.

The code also stores a short-lived Telegram update dedupe key so webhook retries do not process the same update repeatedly.

Implementation note: `doPost()` returns `HtmlService.createHtmlOutput("ok")`. Do not change this back to `ContentService.createTextOutput("ok")`; ContentService can make Apps Script answer through a temporary redirect, and Telegram records that as `302 Moved Temporarily`.
