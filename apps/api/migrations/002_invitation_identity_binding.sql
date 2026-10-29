-- Invitations cannot be redeemed through a different trusted identity provider.
ALTER TABLE invitations ADD COLUMN issuer text;
UPDATE invitations i SET issuer=u.issuer FROM users u WHERE u.id=i.created_by;
ALTER TABLE invitations ALTER COLUMN issuer SET NOT NULL;
