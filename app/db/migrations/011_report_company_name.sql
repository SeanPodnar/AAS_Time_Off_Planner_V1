-- 011 Reports show the company's legal name. The app role can't read the tenants table, so this
-- returns the legal name of the current company only (the one set by withTenant), nothing else.
create function current_tenant_legal_name() returns text
  language sql stable security definer set search_path = public
  as $$ select legal_name from tenants where id = app_tenant_id() $$;
revoke all on function current_tenant_legal_name() from public;
grant execute on function current_tenant_legal_name() to aas_app;
