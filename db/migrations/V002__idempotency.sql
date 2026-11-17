-- V002: API idempotency (spec §21.4). Scope = tenant + operation type.
CREATE TABLE IdempotencyRecord (
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    operation_type VARCHAR(100) NOT NULL,
    idempotency_key VARCHAR(200) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    result_ref VARCHAR(400) NULL,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_IdempotencyRecord PRIMARY KEY (tenant_id, operation_type, idempotency_key)
);
GO

-- @Outcome: 0 = new claim, 1 = replay of the same request, 2 = conflict (same key, different request).
CREATE PROCEDURE dbo.usp_ClaimIdempotencyKey
    @TenantId UNIQUEIDENTIFIER,
    @OperationType VARCHAR(100),
    @Key VARCHAR(200),
    @RequestHash CHAR(64),
    @Outcome TINYINT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        INSERT IdempotencyRecord(tenant_id, operation_type, idempotency_key, request_hash)
        VALUES (@TenantId, @OperationType, @Key, @RequestHash);
        SET @Outcome = 0;
    END TRY
    BEGIN CATCH
        IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
        SELECT @Outcome = CASE WHEN request_hash = @RequestHash THEN 1 ELSE 2 END
        FROM IdempotencyRecord
        WHERE tenant_id = @TenantId AND operation_type = @OperationType AND idempotency_key = @Key;
    END CATCH
END;
GO
