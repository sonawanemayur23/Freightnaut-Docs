CREATE TABLE number_series (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),document_type text NOT NULL CHECK(document_type IN ('invoice','packing-list')),
 config jsonb NOT NULL,revision integer NOT NULL DEFAULT 1,changed_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,tenant_id)
);
CREATE UNIQUE INDEX number_series_name_idx ON number_series(tenant_id,document_type,lower(config->>'name'));
CREATE TABLE number_counters (
 series_id uuid NOT NULL,tenant_id uuid NOT NULL,branch_scope text NOT NULL,period text NOT NULL,next_value bigint NOT NULL CHECK(next_value BETWEEN 1 AND 1000000000),
 PRIMARY KEY(series_id,branch_scope,period),FOREIGN KEY(series_id,tenant_id) REFERENCES number_series(id,tenant_id)
);
CREATE TABLE number_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),shipment_id uuid NOT NULL,series_id uuid NOT NULL,
 document_type text NOT NULL CHECK(document_type IN ('invoice','packing-list')),number text NOT NULL CHECK(length(number) BETWEEN 1 AND 200),
 branch text NOT NULL,sequence bigint NOT NULL,period text NOT NULL,series_revision integer NOT NULL,config_snapshot jsonb NOT NULL,
 requested_by uuid NOT NULL REFERENCES users(id),idempotency_key uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','voided')),void_reason text,voided_by uuid REFERENCES users(id),voided_at timestamptz,
 FOREIGN KEY(shipment_id,tenant_id) REFERENCES shipments(id,tenant_id),FOREIGN KEY(series_id,tenant_id) REFERENCES number_series(id,tenant_id),
 UNIQUE(tenant_id,requested_by,idempotency_key),UNIQUE(tenant_id,document_type,number),
 CHECK((status='reserved' AND void_reason IS NULL AND voided_by IS NULL AND voided_at IS NULL) OR (status='voided' AND length(trim(void_reason)) BETWEEN 3 AND 500 AND voided_by IS NOT NULL AND voided_at IS NOT NULL))
);
CREATE UNIQUE INDEX number_reservation_active_idx ON number_reservations(shipment_id,document_type) WHERE status='reserved';
CREATE INDEX number_reservation_history_idx ON number_reservations(tenant_id,shipment_id,created_at DESC);
-- Only reserved account administrator roles gain this account-scoped capability. Custom roles are unchanged.
UPDATE roles r SET permissions=array_append(r.permissions,'document.number.reserve') FROM tenants t
 WHERE r.tenant_id=t.id AND t.kind='account' AND r.key='owner' AND r.reserved AND NOT 'document.number.reserve'=ANY(r.permissions);
ALTER TABLE number_series ENABLE ROW LEVEL SECURITY; ALTER TABLE number_series FORCE ROW LEVEL SECURITY;
CREATE POLICY number_series_read ON number_series FOR SELECT USING(has_permission(tenant_id,'tenant.settings.write') OR has_permission(tenant_id,'document.number.reserve'));
CREATE POLICY number_series_insert ON number_series FOR INSERT WITH CHECK(has_permission(tenant_id,'tenant.settings.write') AND changed_by=NULLIF(current_setting('app.user_id',true),'')::uuid);
CREATE POLICY number_series_update ON number_series FOR UPDATE USING(has_permission(tenant_id,'tenant.settings.write')) WITH CHECK(has_permission(tenant_id,'tenant.settings.write'));
ALTER TABLE number_counters ENABLE ROW LEVEL SECURITY; ALTER TABLE number_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY number_counter_read ON number_counters FOR SELECT USING(has_permission(tenant_id,'tenant.settings.write') OR has_permission(tenant_id,'document.number.reserve'));
CREATE POLICY number_counter_insert ON number_counters FOR INSERT WITH CHECK(has_permission(tenant_id,'document.number.reserve'));
CREATE POLICY number_counter_update ON number_counters FOR UPDATE USING(has_permission(tenant_id,'document.number.reserve')) WITH CHECK(has_permission(tenant_id,'document.number.reserve'));
ALTER TABLE number_reservations ENABLE ROW LEVEL SECURITY; ALTER TABLE number_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY number_reservation_read ON number_reservations FOR SELECT USING(has_permission(tenant_id,'shipment.read',shipment_id));
CREATE POLICY number_reservation_insert ON number_reservations FOR INSERT WITH CHECK(has_permission(tenant_id,'document.number.reserve') AND has_permission(tenant_id,'shipment.write',shipment_id) AND requested_by=NULLIF(current_setting('app.user_id',true),'')::uuid);
CREATE POLICY number_reservation_update ON number_reservations FOR UPDATE USING(has_permission(tenant_id,'document.number.reserve')) WITH CHECK(has_permission(tenant_id,'document.number.reserve'));
CREATE FUNCTION guard_number_counter() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.next_value<=OLD.next_value THEN RAISE EXCEPTION 'Number counters cannot move backwards' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER number_counter_forward_only BEFORE UPDATE ON number_counters FOR EACH ROW EXECUTE FUNCTION guard_number_counter();
CREATE FUNCTION guard_number_void() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status<>'reserved' OR NEW.status<>'voided' OR NEW.voided_by IS DISTINCT FROM NULLIF(current_setting('app.user_id',true),'')::uuid
 THEN RAISE EXCEPTION 'Number reservations can only be voided once by the current actor' USING ERRCODE='42501'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER number_reservation_terminal_void BEFORE UPDATE ON number_reservations FOR EACH ROW EXECUTE FUNCTION guard_number_void();
