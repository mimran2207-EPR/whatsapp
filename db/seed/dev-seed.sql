-- Dev seed (idempotent). Applied by DbMigrator --seed-dev, only to database 'whatsapp'.
IF NOT EXISTS (SELECT 1 FROM Tenant WHERE tenant_id = '11111111-1111-1111-1111-111111111111')
    INSERT Tenant(tenant_id, name) VALUES ('11111111-1111-1111-1111-111111111111', N'מועצה אזורית דוגמה');
IF NOT EXISTS (SELECT 1 FROM TenantPolicy WHERE tenant_id = '11111111-1111-1111-1111-111111111111')
    INSERT TenantPolicy(tenant_id) VALUES ('11111111-1111-1111-1111-111111111111');
