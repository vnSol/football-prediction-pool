# Odds Proposal Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI/search handicap proposal at T-24h for matches without odds, with automatic odds application and immediate pick opening.

**Architecture:** Reuse the existing scheduler flow. Store proposed odds in `Matches`, copy clear proposals into confirmed odds immediately, notify admins with source links, and allow later correction through `/set_odds`.

**Tech Stack:** Google Apps Script JavaScript, Telegram inline callbacks, OpenAI Responses web search, Node test runner.

---

### Task 1: Core Odds Proposal Helpers

**Files:**
- Modify: `src/core.js`
- Test: `test/core.test.js`

- [ ] Write failing tests for AI odds prompt, proposal normalization, Telegram formatting, auto-apply patch, and dry-run odds proposal.
- [ ] Implement helpers: `buildAiOddsProposalPrompt`, `normalizeAiOddsProposal`, `formatAdminOddsProposal`, `buildOddsProposalPatch`, `buildAutoApplyOddsProposalPatch`, `buildDryRunOddsProposal`.
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

- [ ] Change T-24h missing-odds scheduler behavior from default open to odds proposal action.
- [ ] Add `generateAiOddsProposal(match)` with web search.
- [ ] Update `alertMissingOdds()` to store proposal, apply odds/defaults, notify admins, and open pick.
- [ ] Keep `/set_odds` available for admin corrections after auto-open.
- [ ] Add odds proposal columns to `Matches`.
- [ ] Run `npm test`.

### Task 3: Docs and Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/result-proposal-test-strategy.md`

- [ ] Document the odds proposal flow and dry-run behavior.
- [ ] Run `npm test`.
- [ ] Run `node --check src/core.js src/config.js src/ai.js src/sheets.js src/telegram.js src/main.js`.
