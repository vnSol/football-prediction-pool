# World Cup Telegram Prediction Pool

Google Apps Script + Telegram Bot automation for an internal World Cup prediction pool.

## What It Does

- At T-24h, uses AI/web search to summarize missing handicap odds from Bet365, Unibet, and Bwin, applies the proposed line automatically, and opens picks.
- Notifies admins with the odds/source summary so they can adjust later with `/set_odds` if needed.
- Lets players change picks through Telegram until kickoff.
- Lets players self-register by messaging the bot directly with `/join`.
- Sends T-2h and T-30m reminders to players who have not picked.
- Locks at kickoff, defaults missing picks to the favorite side, and posts a group lock summary with every player's final pick.
- At T+120m, uses AI/web search to propose the settlement score, match status, and public source links for admin verification.
- Lets admins confirm settlement scores after checking the source links. Settlement scores are 90 minutes plus stoppage time, excluding extra time and penalty shootouts.
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
4. In Apps Script, open `Project Settings > Script properties` and add:
   - `TELEGRAM_BOT_TOKEN`: create a bot with [@BotFather](https://t.me/BotFather), run `/newbot`, and copy the token it returns.
   - `ADMIN_CHAT_IDS`: comma-separated Telegram IDs allowed to run admin commands. To find an ID, send a message or command to the bot, open `https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates`, and copy `message.from.id` for a user admin or `message.chat.id` for an admin chat/group.
   - `OPENAI_API_KEY`: create an API key at the [OpenAI API keys page](https://platform.openai.com/api-keys) and paste the secret key value.
   - `OPENAI_MODEL`: optional model ID override. Leave unset to use `gpt-5-mini`.
   - `RECAP_CHAT_ID`: group/channel chat ID for AI lock summaries and recap messages. Add the bot to the target group/channel, post a message, call `getUpdates`, and copy `message.chat.id` or `channel_post.chat.id`. If omitted, those broadcasts are skipped.
   - `SPREADSHEET_ID`: optional Sheet ID if the script is not bound to the Sheet. Copy the value between `/d/` and `/edit` in the Google Sheets URL.
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
- `/join`: join the pool and activate the Telegram account for scoring.
- `/rules`: show the full game rules again.
- `/matches`: show open matches with each match's remaining time before kickoff.
- `/mypick`: show picks, including missing picks, for matches in the next 24 hours.
- `/mypick <matchId>`: show current pick for one match.
- `/leaderboard`: show leaderboard.
- Inline buttons: group matches show home/draw/away as available; knockout matches show home, away, home + star, and away + star.

Use player commands and pick buttons in direct messages with the bot. The bot ignores `/join`, `/matches`, `/mypick`, `/commands`, and pick callbacks in group chats to avoid group spam.

## Admin Commands

- `/add_player <telegramUserId> <display name>`
- `/set_player_active <telegramUserId> <true|false>`
- `/add_match <matchId> <kickoffUtc> <GROUP|KNOCKOUT> <home team> vs <away team>`
- `/set_match_time <matchId> <kickoffUtc>`
- `/reset_sheet`
- `/dryrun [baseTimeUtc]`
- `/dryrun_finish`
- `/ai_matches <prompt>`
- `/set_odds <matchId> <HOME|AWAY> <handicap>`
- `/open <matchId>`
- `/lock <matchId>`
- `/lock_summary <matchId>`
- `/ai_result <matchId>`
- `/result <matchId> <home-away after 90m+stoppage, no ET/penalties> <event 1; event 2; event 3>`
- `/settle <matchId>`
- `/reset_latest_settle`
- `/recap <matchId>`

Manual commands are fallback controls. Normal flow is handled by `runScheduler()`. If `/set_odds` is used for a scheduled match inside T-24h, the bot opens pick immediately.

`/ai_matches <prompt>` lets an admin trigger AI/web search for a fixture list, for example `/ai_matches lấy các trận đấu vòng loại của World cup 2026`. The bot sends candidate matches with toggle buttons and a submit button; selected matches are appended to `Matches`. If no suitable fixtures are found, the bot tells the admin.

AI-imported match IDs are generated by the bot, not copied from AI/source data: `WCQ_YYYYMMDDHHMMSS_HOME_TEAM-AWAY_TEAM`, for example `WCQ_20260612020000_MEXICO-SOUTH_AFRICA`.

Players can direct-message `/join` to add themselves to `Players` with `active=true`. The bot uses their Telegram profile name when available, then immediately replies with current open matches so late joiners can pick without waiting for another broadcast. Admins are notified when `/join` creates a new player or reactivates an inactive player.

## AI Messages

The bot uses OpenAI for four automated messages:

- At T-24h before kickoff when odds are missing: an admin-only handicap summary using web search over fixed Bet365, Unibet, and Bwin sources. The bot averages available lines from those three sources, applies the proposed line, opens picks immediately, and links any source it found. If all three are missing or unclear, it opens with the default HOME 0 line. Admins can review the message and adjust with `/set_odds`.
- After lock: a suspenseful betting summary based only on Sheet facts, followed by a deterministic list of every player's final pick.
- At T+120m after kickoff: an admin-only result proposal using web search over 1-2 public sources. The message includes match status, proposed score if available, source links, and Y/N buttons. Admin verifies the links, taps Y to auto-write the result and settle, or taps N to reject.
- After settle: a localized match recap using confirmed match facts, betting results, leaderboard, and web search over at most two public sources.

Admins can also trigger `/ai_matches <prompt>` on demand. This uses web search to collect fixture candidates, then requires admin approval before writing anything to Google Sheets.

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
/ai_matches lấy các trận đấu vòng loại của World cup 2026
```

Use `_` for spaces in team names when needed; the bot stores `_` as spaces.

`/reset_sheet` shows sheet-name buttons and asks for confirmation before clearing data rows. It keeps headers and protection in place.

`/reset_latest_settle` undoes the most recently settled match: it clears that match's rows from `Scores`, moves the match back to `LOCKED`, and clears `handicapOutcome`/`settledAt`. The entered result stays in `Matches`, so `/settle <matchId>` can be run again after corrections.

### `/dryrun` parameter

Syntax:

```text
/dryrun [baseTimeUtc]
```

`baseTimeUtc` is optional. Use an ISO-8601 UTC timestamp with `Z`, for example:

```text
/dryrun 2026-06-12T00:00:00.000Z
```

If omitted, the bot uses the current time when the command runs. The generated matches are scheduled relative to `baseTimeUtc`, with enough cases to test orchestration: group half handicap, group integer handicap, knockout half handicap, knockout integer/zero handicap, and one scheduled match without odds to trigger the AI/search odds proposal flow.

`/dryrun` asks the AI model to create 3-5 synthetic matches, normalizes them into orchestration-ready cases with `DRY-` match IDs, upserts them, and runs one scheduler pass so `/matches` can show newly opened picks immediately. Existing `DRY-` matches are refreshed with the new schedule, odds, status, admin odds/result prompt markers, and cleared proposal/result fields. If the AI call fails, the bot uses a deterministic fallback set. Use `/reset_sheet` when you want to clear old dry-run picks and score rows too. For synthetic missing-odds dry-run matches, the bot sends a synthetic handicap summary, auto-applies the proposed odds, and opens picks.

Use `/dryrun_finish` to simulate the T+120 result-proposal step for all unsettled `DRY-` matches. The bot locks any unfinished dry-run match and sends synthetic result proposals with Y/N buttons to the admin chat. Tapping Y writes the proposed settlement score and auto-settles; tapping N rejects the proposal. Because dry-run matches are synthetic, these proposals do not include public source links; production T+120 prompts still use AI/web search over 1-2 public sources.

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
