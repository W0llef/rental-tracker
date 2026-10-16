# Working agreement — Rental Unit Tracker

Read this first in every session. It tells you what the project is, the owner's rules, and exactly how a milestone is run and handed off.

## The project

A personal, map-first web app for tracking rental units in Minneapolis–St. Paul. It runs entirely in the browser (IndexedDB), has no backend, and is deployed to GitHub Pages.

| File                        | What it is                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SPEC.md`                   | The owner's product spec (the "what"). Don't edit it; record changes in `PLAN.md`.                                                                                        |
| `PLAN.md`                   | How it's built: stack, data model, services, milestones (§9), decisions (§11), change log (§12), workflow (§13), **progress and session log (§14)**. The source of truth. |
| `DESIGN.md`                 | Look and feel: tokens, pins, layouts, keyboard shortcuts. Direction C (Wayfinding).                                                                                       |
| `mockups/c-wayfinding.html` | Reference mockup of the main screen and map layers panel.                                                                                                                 |
| `README.md`                 | Plain instructions for running, deploying and backing up.                                                                                                                 |

## The owner's rules

1. Everything runs in the browser on the owner's device: no backend, no server, no paid services.
2. Phase 1 must work with no API keys.
3. Don't build features from a later phase early (§7 of `PLAN.md` lists what's in Phase 1).
4. If the spec or plan is ambiguous, ask instead of guessing. Add the question to `PLAN.md` §11.2.
5. Build one milestone at a time. Run it, test it, report, then **wait for the owner's OK**.
6. Keep `README.md` current and update `PLAN.md` whenever anything changes.
7. Phase 1 is done when it passes the acceptance test in `SPEC.md` §12.

## Starting a session

1. Read `CLAUDE.md`, then `PLAN.md` §14 (status and the newest session-log entry), §11 (decisions) and the §9 row for the milestone you're asked to build. Read the other `PLAN.md` and `DESIGN.md` sections that milestone touches.
2. Check the repo: `git status`, `git log --oneline -10`, open branches.
   If the prompt has a `Model:` line and you are a different model, say so in your first message and ask whether to continue (the owner picks the model in the app; the prompt can only remind them).
3. In one short message, say which milestone you're building, the approach, and any owner notes you're taking into account. Ask only if something is genuinely unclear; otherwise start.

## Running a milestone

1. Branch from `main`: `m<N>-<short-name>` (e.g. `m3-map`). Set the `package.json` version to `0.<N>.0` on the branch (fixes after release: `0.<N>.1`, …), so the footer shows the right version.
2. Build in small commits. Every data write goes through `commands/`; every data-format change gets a new Dexie version, a migration in `db/migrations/`, a fixture and a test (`PLAN.md` §3.7). Never edit a released migration.
3. Run `npm run lint`, `npm test` and `npm run e2e`; all must pass. In the cloud workspace: `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run e2e`.
4. Push the branch; the workflow deploys it to `…/rental-tracker/preview/` (separate database, "Preview" banner). Check the preview yourself (screenshots at laptop and phone width). **Check the live build too**: the live variant in the e2e tests (port 4174, no banner) and that the live site still works.
5. Report to the owner, briefly:
   - what works, and how to try it (preview link and steps);
   - what isn't included yet, and known issues;
   - **whether the data format changed** (if yes: "download a backup before approving");
   - anything in the plan that changed.
6. Fix requests from the owner go on the same branch; repeat 3–5.

## When the owner approves

1. Merge the branch into `main` (merge commit, not squash) and push `main`.
2. The GitHub access here refuses tag pushes and branch deletes (HTTP 403), so **ask the owner** to create the tag `v0.<N>.0` on `main` on GitHub (Releases → Draft a new release → new tag; fixes after release: `v0.<N>.1`, …) and to delete the merged branch.
3. Confirm the live site deployed and shows the new version in the footer.
4. Update `PLAN.md` §14: set the milestone's status, version and date, and add a session-log entry (newest first) with: what was built, known issues, data format changed yes/no, and notes for the next milestone. Commit to `main`.
5. Tell the owner the milestone is live and give them the prompt for the next chat (below), filled in, including the `Model:` line (default: the model in the current prompt; suggest a different one only with a reason). Then check that the owner created the tag and deleted the branch (`git ls-remote --tags --heads origin`).

## Conventions

- TypeScript strict; zod schemas are the data model; pure logic in `domain/` with unit tests.
- New dependencies are listed in `PLAN.md` §1 with a one-line reason.
- Commit messages: imperative, prefixed with the milestone (`M3: add fan-out for grouped buildings`).
- Never commit secrets, API keys, or the owner's rental data or photos. The repo is public.
- Plain, sentence-case UI copy (`DESIGN.md` §6).

## Prompt for a new chat

The owner starts each milestone chat with this (filled in):

```text
We're building the Rental Unit Tracker. Repo: github.com/<owner>/rental-tracker.
Model: <model> (pick it in the model menu before sending this).
Add the repo, read CLAUDE.md and follow it.
Build: M<N> — <milestone name>.
Notes since last time: <changes, bugs noticed, or "none">.
```

The `Model:` line is a reminder for the owner and a check for the chat: the prompt itself can't switch models. M0 and M1 were built with Claude Opus 5.5.
