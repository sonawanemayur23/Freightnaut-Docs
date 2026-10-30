-- Expand only: retain every existing bytea PDF and its hash unchanged.
ALTER TABLE document_files ALTER COLUMN bytes DROP NOT NULL;
ALTER TABLE document_files ADD COLUMN object_key text;
ALTER TABLE document_files ADD COLUMN object_bucket text;
ALTER TABLE document_files ADD COLUMN object_version text;
ALTER TABLE document_files ADD COLUMN byte_size integer;
ALTER TABLE document_files ADD CONSTRAINT document_file_location CHECK (
 (bytes IS NOT NULL AND object_key IS NULL AND object_bucket IS NULL AND object_version IS NULL)
 OR (bytes IS NULL AND object_key IS NOT NULL AND object_bucket IS NOT NULL AND byte_size BETWEEN 5 AND 10485760)
);
CREATE UNIQUE INDEX document_object_location_idx ON document_files(object_bucket,object_key) WHERE object_key IS NOT NULL;
