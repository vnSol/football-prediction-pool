# Odds Proposal Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI/search handicap proposal at T-6h for matches without odds, with admin Y/N confirmation and automatic opening on Y.

**Architecture:** Reuse the existing scheduler/admin callback pattern. Store proposed odds in `Matches` columns separate from confirmed odds, send Telegram inline buttons, and only write `favoriteSide`/`handicapGoals` after admin confirmation.

**Tech Stack:** Google Apps Script JavaScript, Telegram inline callbacks, OpenAI Responses web search, Node test runner.

---

### Task 1: Core Odds Proposal Helpers

**Files:**
- Modify: `src/core.js`
- Test: `test/core.test.js`

- [ ] Write failing tests for AI odds prompt, proposal normalization, Telegram formatting, confirm keyboard, confirm patch, and dry-run odds proposal.
- [ ] Implement helpers: `buildAiOddsProposalPrompt`, `normalizeAiOddsProposal`, `formatAdminOddsProposal`, `buildOddsProposalPatch`, `buildOddsProposalConfirmKeyboard`, `buildConfirmOddsProposalPatch`, `buildDryRunOddsProposal`.
- [ ] Export helpers for tests.
- [ ] Run `npm test`.

### Task 2: Scheduler and Callback Wiring

**Files:**
- Modify: `src/core.js`
- Modify: `src/ai.js`
- Modify: `src/main.js`
- Modify: `src/telegram.js`
- Modify: `src/sheets.js`
- Test: `test/core.test.js`

- [ ] Change T-6h missing-odds scheduler behavior from default open to odds proposal action.
- [ ] Add `generateAiOddsProposal(match)` with web search.
- [ ] Update `alertMissingOdds()` to store proposal and send Y/N buttons.
- [ ] Add `odds_confirm` and `odds_reject` callback handling.
- [ ] Confirm path writes odds, marks decision, and opens pick when inside T-6h.
- [ ] Reject path marks decision and leaves manual `/set_odds` available.
- [ ] Add odds proposal columns to `Matches`.
- [ ] Run `npm test`.

### Task 3: Docs and Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/result-proposal-test-strategy.md`

- [ ] Document the odds proposal flow and dry-run behavior.
- [ ] Run `npm test`.
- [ ] Run `node --check src/core.js src/config.js src/ai.js src/sheets.js src/telegram.js src/main.js`.
