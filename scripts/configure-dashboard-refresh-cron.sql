-- Fail-fast for plain `psql -f` application without requiring caller flags.
\set ON_ERROR_STOP on

-- Dashboard Shell materialized-view refresh ownership.
--
-- Keep refresh work inside one durable DB-side scheduler, not inside the HTTP
-- report service. Every scheduled refresh/analyze command goes through a shared
-- advisory lock so a slow materialized-view refresh cannot pile up overlapping
-- DB work.
--
-- Health monitoring and this script both own the stable aawm_* job names. Older
-- dashboard_shell_* schedule names for these four jobs are obsolete and are
-- removed by exact name on every apply so a rerun cannot leave dual owners.

CREATE OR REPLACE FUNCTION public.dashboard_shell_maintain_materialized_view(
  p_view_name text,
  p_operation text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  lock_acquired boolean;
BEGIN
  lock_acquired := pg_try_advisory_lock(
    hashtext('dashboard-shell'),
    hashtext('materialized-view-maintenance')
  );

  IF NOT lock_acquired THEN
    RAISE NOTICE
      'dashboard-shell materialized-view maintenance skipped because another maintenance job is active: %.%',
      p_view_name,
      p_operation;
    RETURN;
  END IF;

  BEGIN
    IF p_view_name = 'rate_limit_intervals' AND p_operation = 'refresh' THEN
      REFRESH MATERIALIZED VIEW CONCURRENTLY public.rate_limit_intervals;
    ELSIF p_view_name = 'rate_limit_intervals' AND p_operation = 'analyze' THEN
      ANALYZE public.rate_limit_intervals;
    ELSIF p_view_name = 'provider_latency_health_5m' AND p_operation = 'refresh' THEN
      REFRESH MATERIALIZED VIEW CONCURRENTLY public.provider_latency_health_5m;
    ELSIF p_view_name = 'provider_latency_health_5m' AND p_operation = 'analyze' THEN
      ANALYZE public.provider_latency_health_5m;
    ELSE
      RAISE EXCEPTION
        'unsupported dashboard-shell materialized-view maintenance target: %.%',
        p_view_name,
        p_operation;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM pg_advisory_unlock(
        hashtext('dashboard-shell'),
        hashtext('materialized-view-maintenance')
      );
      RAISE;
  END;

  PERFORM pg_advisory_unlock(
    hashtext('dashboard-shell'),
    hashtext('materialized-view-maintenance')
  );
END;
$$;

-- Remove only the four exact obsolete dashboard_shell_* schedule owners before
-- ensuring the stable aawm_* jobs. Do not wildcard-unschedule other jobs.
DO $$
DECLARE
  obsolete_job record;
BEGIN
  FOR obsolete_job IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE jobname IN (
      'dashboard_shell_rate_limit_intervals_refresh',
      'dashboard_shell_rate_limit_intervals_analyze',
      'dashboard_shell_provider_latency_health_5m_refresh',
      'dashboard_shell_provider_latency_health_5m_analyze'
    )
  LOOP
    PERFORM cron.unschedule(obsolete_job.jobid);
  END LOOP;
END;
$$;

SELECT cron.schedule(
  'aawm_rate_limit_intervals_refresh',
  '1,11,21,31,41,51 * * * *',
  $cmd$SELECT public.dashboard_shell_maintain_materialized_view('rate_limit_intervals', 'refresh')$cmd$
)
WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'aawm_rate_limit_intervals_refresh'
);

SELECT cron.schedule(
  'aawm_rate_limit_intervals_analyze',
  '3,13,23,33,43,53 * * * *',
  $cmd$SELECT public.dashboard_shell_maintain_materialized_view('rate_limit_intervals', 'analyze')$cmd$
)
WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'aawm_rate_limit_intervals_analyze'
);

SELECT cron.schedule(
  'aawm_provider_latency_health_5m_refresh',
  '6,26,46 * * * *',
  $cmd$SELECT public.dashboard_shell_maintain_materialized_view('provider_latency_health_5m', 'refresh')$cmd$
)
WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'aawm_provider_latency_health_5m_refresh'
);

SELECT cron.schedule(
  'aawm_provider_latency_health_5m_analyze',
  '10,30,50 * * * *',
  $cmd$SELECT public.dashboard_shell_maintain_materialized_view('provider_latency_health_5m', 'analyze')$cmd$
)
WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'aawm_provider_latency_health_5m_analyze'
);

DO $$
DECLARE
  bad_jobs text;
BEGIN
  SELECT string_agg(expected_name || ' has ' || job_count || ' jobs', ', ' ORDER BY expected_name)
  INTO bad_jobs
  FROM (
    SELECT
      expected.expected_name,
      count(cron.job.jobid) AS job_count
    FROM (
      VALUES
        ('aawm_rate_limit_intervals_refresh'),
        ('aawm_rate_limit_intervals_analyze'),
        ('aawm_provider_latency_health_5m_refresh'),
        ('aawm_provider_latency_health_5m_analyze')
    ) AS expected(expected_name)
    LEFT JOIN cron.job
      ON cron.job.jobname = expected.expected_name
    GROUP BY expected.expected_name
    HAVING count(cron.job.jobid) <> 1
  ) AS counts;

  IF bad_jobs IS NOT NULL THEN
    RAISE EXCEPTION 'dashboard-shell pg_cron job name invariant failed: %', bad_jobs;
  END IF;
END;
$$;

SELECT cron.alter_job(
  jobid,
  schedule => '1,11,21,31,41,51 * * * *',
  command => $cmd$SELECT public.dashboard_shell_maintain_materialized_view('rate_limit_intervals', 'refresh')$cmd$,
  active => true
)
FROM cron.job
WHERE jobname = 'aawm_rate_limit_intervals_refresh';

SELECT cron.alter_job(
  jobid,
  schedule => '3,13,23,33,43,53 * * * *',
  command => $cmd$SELECT public.dashboard_shell_maintain_materialized_view('rate_limit_intervals', 'analyze')$cmd$,
  active => true
)
FROM cron.job
WHERE jobname = 'aawm_rate_limit_intervals_analyze';

SELECT cron.alter_job(
  jobid,
  schedule => '6,26,46 * * * *',
  command => $cmd$SELECT public.dashboard_shell_maintain_materialized_view('provider_latency_health_5m', 'refresh')$cmd$,
  active => true
)
FROM cron.job
WHERE jobname = 'aawm_provider_latency_health_5m_refresh';

SELECT cron.alter_job(
  jobid,
  schedule => '10,30,50 * * * *',
  command => $cmd$SELECT public.dashboard_shell_maintain_materialized_view('provider_latency_health_5m', 'analyze')$cmd$,
  active => true
)
FROM cron.job
WHERE jobname = 'aawm_provider_latency_health_5m_analyze';

SELECT
  jobid,
  schedule,
  active,
  jobname,
  command
FROM cron.job
WHERE jobname IN (
  'aawm_rate_limit_intervals_refresh',
  'aawm_rate_limit_intervals_analyze',
  'aawm_provider_latency_health_5m_refresh',
  'aawm_provider_latency_health_5m_analyze'
)
ORDER BY jobid;
