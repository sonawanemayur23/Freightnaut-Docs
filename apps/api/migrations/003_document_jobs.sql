-- Snapshots and PDF bytes are immutable. Queue metadata contains no shipment content.
CREATE TABLE document_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),shipment_id uuid NOT NULL,
 requested_by uuid NOT NULL REFERENCES users(id),idempotency_key uuid NOT NULL,
 document_type text NOT NULL CHECK(document_type IN ('invoice','packing-list')),shipment_version integer NOT NULL,
 snapshot jsonb NOT NULL,html text NOT NULL,snapshot_hash text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','ready','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),lease_token uuid,lease_until timestamptz,
 error_code text,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 FOREIGN KEY(shipment_id,tenant_id) REFERENCES shipments(id,tenant_id),UNIQUE(tenant_id,requested_by,idempotency_key)
);
CREATE INDEX document_history_idx ON document_jobs(tenant_id,shipment_id,created_at DESC,id);
CREATE TABLE document_files (
 job_id uuid PRIMARY KEY REFERENCES document_jobs(id),bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 5 AND 10485760),
 sha256 text NOT NULL CHECK(length(sha256)=64),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE document_outbox (
 job_id uuid PRIMARY KEY REFERENCES document_jobs(id),requested_by uuid NOT NULL REFERENCES users(id),available_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_outbox_available_idx ON document_outbox(available_at);
ALTER TABLE document_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY document_job_read ON document_jobs FOR SELECT USING(
 requested_by=NULLIF(current_setting('app.user_id',true),'')::uuid OR
 (has_permission(tenant_id,'shipment.read',shipment_id) AND has_permission(tenant_id,'document.download',shipment_id)));
CREATE POLICY document_job_insert ON document_jobs FOR INSERT WITH CHECK(
 requested_by=NULLIF(current_setting('app.user_id',true),'')::uuid AND
 has_permission(tenant_id,'shipment.read',shipment_id) AND has_permission(tenant_id,'document.download',shipment_id));
CREATE POLICY document_job_update ON document_jobs FOR UPDATE USING(requested_by=NULLIF(current_setting('app.user_id',true),'')::uuid)
 WITH CHECK(requested_by=NULLIF(current_setting('app.user_id',true),'')::uuid);
ALTER TABLE document_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_files FORCE ROW LEVEL SECURITY;
CREATE POLICY document_file_read ON document_files FOR SELECT USING(EXISTS(SELECT 1 FROM document_jobs j WHERE j.id=job_id
 AND has_permission(j.tenant_id,'shipment.read',j.shipment_id) AND has_permission(j.tenant_id,'document.download',j.shipment_id)));
CREATE POLICY document_file_insert ON document_files FOR INSERT WITH CHECK(EXISTS(SELECT 1 FROM document_jobs j WHERE j.id=job_id
 AND j.requested_by=NULLIF(current_setting('app.user_id',true),'')::uuid AND j.status='processing'
 AND has_permission(j.tenant_id,'shipment.read',j.shipment_id) AND has_permission(j.tenant_id,'document.download',j.shipment_id)));
