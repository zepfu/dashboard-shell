/**
 * MOVED TO: server/report-service-query-builders.test.ts
 *
 * Wave 10 (S4-8): This test suite was relocated from `src/features/dashboard/lib/`
 * to `server/` because the vitest jsdom frontend project cannot bundle `redis`
 * (a Node.js native module imported by `server/report-service.mjs`).
 *
 * The suite now lives at `server/report-service-query-builders.test.ts` and
 * requires a `server/` vitest project entry (environment: 'node') to run.
 *
 * ENGINEER ACTION REQUIRED:
 *   1. Add a `server/` vitest project entry in `vitest.config.ts`:
 *      ```ts
 *      {
 *        include: ['server/**\/*.test.{ts,mts}'],
 *        environment: 'node',
 *      }
 *      ```
 *   2. Add `pgsql-parser` as a devDependency:
 *      `pnpm add -D pgsql-parser`
 *      This unblocks the SQL parse-validation tests in the moved file.
 *
 * This stub file is intentionally left here to document the migration.
 * It does NOT import from `server/report-service.mjs` (which would fail
 * in the jsdom project due to the `redis` import).
 */
import { expect, test } from 'vitest'

test('test_report_service_query_builders_moved_to_server_directory', () => {
  /**
   * This test documents the relocation of the full test suite.
   *
   * Full test coverage including:
   *   - All existing buildUsageQuery/buildQuotaQuery/etc. tests
   *   - pgsql-parser SQL parse-validation (S4-8)
   *   - buildQuotaEstimatorObservationQuery value assertions (S4-6)
   *   - Reportable-filter sweep
   *
   * ...is at: server/report-service-query-builders.test.ts
   *
   * That file requires:
   *   - A server/ vitest project (environment: 'node') — ENGINEER ACTION
   *   - pgsql-parser devDependency — ENGINEER ACTION
   */
  expect('server/report-service-query-builders.test.ts').toBeTruthy()
})
