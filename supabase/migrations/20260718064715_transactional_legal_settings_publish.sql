begin;

create or replace function public.legal_settings_publish_rpc(
  p_settings jsonb,
  p_published_by text default 'developer'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_version_number integer;
  v_version_label text;
begin
  if p_settings is null or pg_catalog.jsonb_typeof(p_settings) <> 'object' then
    raise exception 'LEGAL_SETTINGS_INVALID_PAYLOAD';
  end if;

  if p_published_by is null
     or pg_catalog.btrim(p_published_by) = ''
     or pg_catalog.length(p_published_by) > 200 then
    raise exception 'LEGAL_SETTINGS_INVALID_PUBLISHER';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('legal-settings-publish', 0)
  );

  select coalesce(pg_catalog.max(version_number), 0) + 1
    into v_version_number
  from public.legal_settings_versions;

  v_version_label := 'v' || v_version_number::text;

  update public.legal_settings_versions
  set is_current = false
  where is_current = true;

  insert into public.legal_settings_versions (
    version_number,
    version_label,
    snapshot,
    is_current,
    published_at,
    published_by
  ) values (
    v_version_number,
    v_version_label,
    p_settings,
    true,
    v_now,
    pg_catalog.btrim(p_published_by)
  );

  insert into public.legal_settings (
    id,
    draft,
    is_complete,
    current_version_number,
    published_at,
    published_by,
    updated_by,
    updated_at
  ) values (
    1,
    p_settings,
    true,
    v_version_number,
    v_now,
    pg_catalog.btrim(p_published_by),
    pg_catalog.btrim(p_published_by),
    v_now
  )
  on conflict (id) do update set
    draft = excluded.draft,
    is_complete = excluded.is_complete,
    current_version_number = excluded.current_version_number,
    published_at = excluded.published_at,
    published_by = excluded.published_by,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  return pg_catalog.jsonb_build_object(
    'version_number', v_version_number,
    'version_label', v_version_label,
    'published_at', v_now
  );
end;
$$;

revoke all on function public.legal_settings_publish_rpc(jsonb, text) from public, anon, authenticated;
grant execute on function public.legal_settings_publish_rpc(jsonb, text) to service_role;

commit;
