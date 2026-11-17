-- V004: store the full response (status + body) of an idempotent request so a replay returns it verbatim.
-- result_ref (VARCHAR(400)) from V002 is too small for a response body and is left untouched.
ALTER TABLE IdempotencyRecord ADD
    response_status INT NULL,
    response_body NVARCHAR(MAX) NULL;
GO

CREATE PROCEDURE dbo.usp_SetIdempotencyResult
    @TenantId UNIQUEIDENTIFIER,
    @OperationType VARCHAR(100),
    @Key VARCHAR(200),
    @ResponseStatus INT,
    @ResponseBody NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE IdempotencyRecord
    SET response_status = @ResponseStatus, response_body = @ResponseBody
    WHERE tenant_id = @TenantId AND operation_type = @OperationType AND idempotency_key = @Key;
END;
GO

-- Releases a claim whose request failed before producing a result (so the client can retry with the same key).
-- Never removes a claim that already has a stored result.
CREATE PROCEDURE dbo.usp_ReleaseIdempotencyKey
    @TenantId UNIQUEIDENTIFIER,
    @OperationType VARCHAR(100),
    @Key VARCHAR(200)
AS
BEGIN
    SET NOCOUNT ON;
    DELETE IdempotencyRecord
    WHERE tenant_id = @TenantId AND operation_type = @OperationType AND idempotency_key = @Key
      AND response_status IS NULL;
END;
GO
