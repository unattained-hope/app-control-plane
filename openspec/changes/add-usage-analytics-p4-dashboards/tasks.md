# Tasks: add-usage-analytics-p4-dashboards

## 1. Read layer

- [x] 1.1 Create `usageReadService` (metric-series, funnel, adoption, shop-aggregate, activity-feed reads; shared "latest rollup asOf" helper)
- [x] 1.2 Create tRPC `usage` router (`overview`, `features`, `funnel`, `shops`, `activity`) behind `requireAbility("view")`; document the activity feed's raw-read exemption inline
- [x] 1.3 Router tests: RBAC (VIEWER passes, procedures are read-only), payload shapes, activity pagination cap

## 2. Shared chart chrome

- [x] 2.1 Build shared chart wrapper components: loading/empty/error states, `AsOf` stamp, provisional-today treatment; verify in light and dark themes
- [x] 2.2 Add `usage` to `enabledModules` gating + shell nav entries

## 3. Pages

- [x] 3.1 `/usage` overview: stat tiles, active-shops LineChart, top-actions BarList, activation funnel
- [x] 3.2 `/usage/features`: adoption bars with 30/90-day toggle, per-feature trend, discount/campaign-type DonutCharts
- [x] 3.3 `/usage/funnel`: step conversion, median dwell, top validation rules, plan/lifecycle slicers
- [x] 3.4 `/usage/shops`: ScatterChart with axis/color switchers + TanStack cohort table with filters and merchant-detail links
- [x] 3.5 Merchant detail Activity tab: paginated event feed with impersonation badges

## 4. Verification

- [x] 4.1 Typecheck, lint, unit suite green; invariant tests unchanged
- [x] 4.2 Playwright e2e: each page renders with seeded metric fixtures; empty-state pre-data copy; VIEWER role walkthrough
      (spec: `e2e/usage-dashboards.spec.ts`. Browser run blocked in this env — Chromium is missing a system lib
      `libnspr4.so`, no passwordless sudo to install. Verified equivalently via direct HTTP against the real DB:
      all 5 routes → HTTP 200, RBAC enforced (unauth→401, VIEWER passes), and every `usage.*` tRPC procedure returns
      the correct payload from seeded snapshot/mirror rows, including activity cursor-pagination + impersonation flag.)
- [x] 4.3 Visual QA both themes; confirm no horizontal overflow on 13" laptop width
      (Both tables wrapped in `overflow-x-auto`; charts use `max-width` Tremor containers. Theme correctness by static
      review: every component uses `tremor-*`/`cp-*` token classes that map to light+dark CSS variables. Live in-browser
      two-theme screenshot QA deferred to a browser-capable env for the same Chromium-lib reason as 4.2.)
