CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), issuer text NOT NULL, subject text NOT NULL,
 email text NOT NULL, email_verified boolean NOT NULL DEFAULT false, name text NOT NULL,
 disabled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(issuer,subject)
);
CREATE TABLE operators (user_id uuid PRIMARY KEY REFERENCES users(id));
CREATE TABLE tenants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN ('partner','account')),
 parent_id uuid REFERENCES tenants(id), name text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 settings jsonb NOT NULL DEFAULT '{}', locks text[] NOT NULL DEFAULT '{}', revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK((kind='partner' AND parent_id IS NULL) OR (kind='account' AND parent_id IS NOT NULL))
);
CREATE FUNCTION check_tenant_parent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.kind='account' AND NOT EXISTS(SELECT 1 FROM tenants WHERE id=NEW.parent_id AND kind='partner') THEN RAISE EXCEPTION 'An account must belong to a partner'; END IF;
 IF TG_OP='UPDATE' AND (NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.kind<>OLD.kind) THEN RAISE EXCEPTION 'Tenant ownership is immutable'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER tenant_parent BEFORE INSERT OR UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION check_tenant_parent();
CREATE TABLE roles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), name text NOT NULL,
 key text, permissions text[] NOT NULL, reserved boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,tenant_id), UNIQUE(tenant_id,name), UNIQUE(tenant_id,key)
);
CREATE TABLE memberships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), tenant_id uuid NOT NULL REFERENCES tenants(id),
 role_id uuid NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(role_id,tenant_id) REFERENCES roles(id,tenant_id), UNIQUE(user_id,tenant_id)
);
CREATE INDEX membership_user_idx ON memberships(user_id,tenant_id) WHERE status='active';
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), csrf_token text NOT NULL, amr text[] NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX session_user_idx ON sessions(user_id);
CREATE TABLE login_transactions (
 token_hash text PRIMARY KEY, provider_id text NOT NULL, state text NOT NULL, nonce text NOT NULL, verifier text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes'
);
CREATE TABLE shipments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),data jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1, created_by uuid NOT NULL REFERENCES users(id), updated_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,tenant_id)
);
CREATE INDEX shipment_tenant_idx ON shipments(tenant_id,updated_at DESC,id);
CREATE TABLE shipment_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),shipment_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id),permissions text[] NOT NULL CHECK(permissions <@ ARRAY['shipment.read','document.download']::text[]),
 expires_at timestamptz NOT NULL,revoked_at timestamptz,created_by uuid NOT NULL REFERENCES users(id),
 FOREIGN KEY(shipment_id,tenant_id) REFERENCES shipments(id,tenant_id),UNIQUE(shipment_id,user_id)
);
CREATE TABLE invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),authority_tenant_id uuid REFERENCES tenants(id),email text NOT NULL,token_hash text NOT NULL UNIQUE,
 role_id uuid,shipment_id uuid, permissions text[] NOT NULL DEFAULT '{}',
 created_by uuid NOT NULL REFERENCES users(id),expires_at timestamptz NOT NULL,accepted_at timestamptz,revoked_at timestamptz,
 FOREIGN KEY(role_id,tenant_id) REFERENCES roles(id,tenant_id),FOREIGN KEY(shipment_id,tenant_id) REFERENCES shipments(id,tenant_id),
 CHECK((role_id IS NOT NULL AND shipment_id IS NULL) OR (role_id IS NULL AND shipment_id IS NOT NULL)),
 CHECK(permissions <@ ARRAY['shipment.read','document.download']::text[])
);
CREATE TABLE settings_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),revision integer NOT NULL,
 settings jsonb NOT NULL,locks text[] NOT NULL,changed_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,revision)
);
CREATE TABLE audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),actor_id uuid NOT NULL REFERENCES users(id),
 action text NOT NULL,resource_id text,metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_tenant_idx ON audit_events(tenant_id,created_at DESC);
-- The application sets a verified user ID using SET LOCAL, inside one transaction.
CREATE FUNCTION has_permission(target_tenant uuid, required_permission text, target_shipment uuid DEFAULT NULL)
 RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM users u JOIN tenants t ON t.id=target_tenant
  WHERE u.id=NULLIF(current_setting('app.user_id',true),'')::uuid AND NOT u.disabled
  AND t.status='active' AND (t.parent_id IS NULL OR EXISTS(SELECT 1 FROM tenants p WHERE p.id=t.parent_id AND p.status='active'))
  AND (EXISTS(SELECT 1 FROM memberships m JOIN roles r ON r.id=m.role_id AND r.tenant_id=m.tenant_id
   WHERE m.user_id=u.id AND m.tenant_id=t.id AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>now()) AND required_permission=ANY(r.permissions))
  OR (target_shipment IS NOT NULL AND EXISTS(SELECT 1 FROM shipment_grants g WHERE g.user_id=u.id AND g.shipment_id=target_shipment AND g.tenant_id=t.id AND g.revoked_at IS NULL AND g.expires_at>now() AND required_permission=ANY(g.permissions))))
 ) $$;
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments FORCE ROW LEVEL SECURITY;
CREATE POLICY shipment_read ON shipments FOR SELECT USING(has_permission(tenant_id,'shipment.read',id));
CREATE POLICY shipment_insert ON shipments FOR INSERT WITH CHECK(has_permission(tenant_id,'shipment.write'));
CREATE POLICY shipment_update ON shipments FOR UPDATE USING(has_permission(tenant_id,'shipment.write')) WITH CHECK(has_permission(tenant_id,'shipment.write'));
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON audit_events FOR SELECT USING(has_permission(tenant_id,'tenant.audit.read'));
CREATE POLICY audit_insert ON audit_events FOR INSERT WITH CHECK(actor_id=NULLIF(current_setting('app.user_id',true),'')::uuid);
ALTER TABLE settings_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY settings_read ON settings_versions FOR SELECT USING(has_permission(tenant_id,'tenant.settings.write'));
CREATE POLICY settings_insert ON settings_versions FOR INSERT WITH CHECK(has_permission(tenant_id,'tenant.settings.write') AND changed_by=NULLIF(current_setting('app.user_id',true),'')::uuid);
