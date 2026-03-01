# Ramadan UI Revamp — v1.0.0 Design Doc

**Date:** 2026-03-01
**Target release:** v1.0.0

## Goal

Revamp all 11 screens of Iftaroot with a Ramadan-themed, elegant, modern aesthetic that delivers a great player and host experience. This revamp constitutes the first official release of the project.

## Design Source

Figma design files provided as exported code files. Implementation uses the `frontend-design` skill, taking Figma code as the reference for each screen.

## Approach

**Design system first, then screens.**

Sub-issue 1 extracts Figma design tokens (colors, typography, spacing, shadows) into CSS custom properties. Tailwind v4's native CSS variable support means these tokens integrate directly with utility classes. Every subsequent screen sub-issue builds on this foundation, ensuring visual consistency across the app.

## GitHub Structure

### Milestone
`v1.0.0 — Ramadan UI Revamp`

### Epic
`[Epic] Ramadan-themed UI Revamp — v1.0.0`
Labels: `epic`, `priority:high`

### Sub-issues

| # | Title | Screens | Size |
|---|-------|---------|------|
| 1 | Design system & Figma tokens | CSS custom props, typography, palette, shadows | S |
| 2 | Auth screens | LoginPage, RegisterPage | S |
| 3 | Join page | JoinPage | S |
| 4 | Admin hub | AdminDashboardPage, SessionHistoryPage | M |
| 5 | Quiz management | QuizListPage, QuizFormPage | M |
| 6 | Host flow | HostLobbyPage, HostGamePage | M |
| 7 | Player flow | PlayerLobbyPage, PlayerGamePage | M |
| 8 | Shared game components | LeaderboardDisplay, PodiumScreen, ConfirmModal | M |

All sub-issues: labels `feature`, `priority:high`, linked to epic, assigned to milestone.

## Implementation Workflow (per sub-issue)

1. User provides Figma code files for the screens in scope
2. Create branch `feat/<issue#>-<screen>-ramadan-ui`
3. Invoke `frontend-design` skill with Figma code as reference
4. Implement screens — design system tokens applied throughout
5. Run `./scripts/check.sh` inside Docker
6. PR → CI → merge

Sub-issues are worked in order (1 → 8) since later screens depend on the design system tokens established in sub-issue 1.

## Release

Once all 8 sub-issues are merged to `main`:
- Tag `v1.0.0` on main
- Create GitHub Release with changelog
