begin;

-- Keep the historical six-argument function for migration compatibility, but
-- remove direct Data API access. The new nine-argument wrapper is the only
-- supported checkout entry point and executes the old implementation inside
-- the same database transaction.
revoke execute on function public.pos_checkout_rpc(text, text, jsonb, numeric, text, text)
  from public, anon, authenticated, service_role;

create or replace function public.pos_checkout_rpc(
  p_client_request_id text,
  p_payment_method text,
  p_items jsonb,
  p_discount_total numeric,
  p_notes text,
  p_created_by text,
  p_legal_terms_version text,
  p_privacy_policy_version text,
  p_legal_accepted_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_request_id text := pg_catalog.btrim(coalesce(p_client_request_id, ''));
  v_result jsonb;
  v_order_id uuid;
  v_already_processed boolean;
begin
  if v_client_request_id = '' then
    raise exception 'client_request_id is required';
  end if;

  -- Serialize identical business operations before the historical RPC reads
  -- the idempotency key. A replay therefore returns the committed order rather
  -- than racing inventory locks and reporting a false stock conflict.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pos_sale:' || v_client_request_id, 0)
  );

  v_result := public.pos_checkout_rpc(
    p_client_request_id,
    p_payment_method,
    p_items,
    p_discount_total,
    p_notes,
    p_created_by
  );

  v_order_id := nullif(v_result #>> '{order,id}', '')::uuid;
  v_already_processed := coalesce((v_result ->> 'already_processed')::boolean, false);

  if v_order_id is null then
    raise exception 'POS checkout RPC returned no order id';
  end if;

  if not v_already_processed then
    update public.sales_orders
    set
      legal_terms_version = nullif(pg_catalog.btrim(coalesce(p_legal_terms_version, '')), ''),
      privacy_policy_version = nullif(pg_catalog.btrim(coalesce(p_privacy_policy_version, '')), ''),
      legal_accepted_at = case
        when nullif(pg_catalog.btrim(coalesce(p_legal_terms_version, '')), '') is not null
          or nullif(pg_catalog.btrim(coalesce(p_privacy_policy_version, '')), '') is not null
        then coalesce(p_legal_accepted_at, pg_catalog.now())
        else null
      end,
      updated_at = pg_catalog.now()
    where id = v_order_id;

    if not found then
      raise exception 'POS checkout order % disappeared before legal acceptance was recorded', v_order_id;
    end if;
  end if;

  return v_result;
end;
$$;

create or replace function public.pos_runtime_health_rpc()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checkout regprocedure := pg_catalog.to_regprocedure(
    'public.pos_checkout_rpc(text,text,jsonb,numeric,text,text,text,text,timestamp with time zone)'
  );
  v_void regprocedure := pg_catalog.to_regprocedure(
    'public.pos_void_rpc(uuid,text,text,text)'
  );
  v_checkout_executable boolean := false;
  v_void_executable boolean := false;
begin
  if v_checkout is not null then
    v_checkout_executable := pg_catalog.has_function_privilege('service_role', v_checkout, 'EXECUTE');
  end if;
  if v_void is not null then
    v_void_executable := pg_catalog.has_function_privilege('service_role', v_void, 'EXECUTE');
  end if;

  return pg_catalog.jsonb_build_object(
    'ready', v_checkout is not null and v_void is not null and v_checkout_executable and v_void_executable,
    'version', 'pos-transaction-v2',
    'checkout_deployed', v_checkout is not null,
    'checkout_executable', v_checkout_executable,
    'void_deployed', v_void is not null,
    'void_executable', v_void_executable
  );
end;
$$;

revoke execute on function public.pos_checkout_rpc(
  text, text, jsonb, numeric, text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.pos_checkout_rpc(
  text, text, jsonb, numeric, text, text, text, text, timestamptz
) to service_role;

revoke execute on function public.pos_runtime_health_rpc()
  from public, anon, authenticated;
grant execute on function public.pos_runtime_health_rpc()
  to service_role;

commit;
