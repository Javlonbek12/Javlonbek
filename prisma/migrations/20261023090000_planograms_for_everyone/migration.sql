-- Planograms are open to every role now: switch the section on in the saved role settings
-- (Settings → Roles) for every role that has it off. Roles missing from the saved settings get
-- the new defaults, which include it.
UPDATE "SystemState"
SET "value" = (
  SELECT jsonb_object_agg(
    e.role,
    CASE
      WHEN jsonb_typeof(e.cfg -> 'modules') = 'array' AND NOT (e.cfg -> 'modules') ? 'planograms'
        THEN jsonb_set(e.cfg, '{modules}', (e.cfg -> 'modules') || '["planograms"]'::jsonb)
      ELSE e.cfg
    END
  )::text
  FROM jsonb_each("value"::jsonb) AS e(role, cfg)
),
"updatedAt" = now()
WHERE "key" = 'roles.config';
