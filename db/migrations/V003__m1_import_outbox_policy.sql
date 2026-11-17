-- V003: M1 — tenant policy, import, suppression, message content, outbox. Composite tenant FKs as in V001.
CREATE TABLE TenantPolicy (
    tenant_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY REFERENCES Tenant(tenant_id),
    send_window_start TIME(0) NOT NULL DEFAULT '08:00',
    send_window_end TIME(0) NOT NULL DEFAULT '20:00',
    time_zone VARCHAR(50) NOT NULL DEFAULT 'Asia/Jerusalem',
    self_approval_max_recipients INT NOT NULL DEFAULT 1000,
    duplicate_window_days INT NOT NULL DEFAULT 7,
    policy_version INT NOT NULL DEFAULT 1
);

CREATE TABLE ImportRun (
    import_run_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    audience_version_id UNIQUEIDENTIFIER NOT NULL,
    source_object_name NVARCHAR(260) NOT NULL,
    source_sha256 CHAR(64) NOT NULL,
    detected_encoding VARCHAR(30) NULL,
    sheet_name NVARCHAR(100) NULL,
    row_count INT NOT NULL,
    valid_count INT NOT NULL,
    created_by VARCHAR(100) NOT NULL,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_ImportRun_Version FOREIGN KEY (tenant_id, audience_version_id) REFERENCES AudienceVersion(tenant_id, audience_version_id)
);

CREATE TABLE AudienceMember (
    audience_member_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    audience_version_id UNIQUEIDENTIFIER NOT NULL,
    source_row_number INT NOT NULL,
    source_recipient_id NVARCHAR(100) NOT NULL,
    approved_identity_key NVARCHAR(200) NOT NULL,
    recipient_name NVARCHAR(200) NULL,
    phone_raw NVARCHAR(100) NULL,
    phone_normalized VARCHAR(20) NULL,
    email_raw NVARCHAR(320) NULL,
    email_normalized NVARCHAR(320) NULL,
    variables_json NVARCHAR(MAX) NULL,
    validation_state VARCHAR(10) NOT NULL CHECK (validation_state IN ('VALID','WARNING','INVALID')),
    validation_codes VARCHAR(400) NULL,
    CONSTRAINT UQ_AudienceMember_Identity UNIQUE (tenant_id, audience_version_id, approved_identity_key),
    CONSTRAINT FK_AudienceMember_Version FOREIGN KEY (tenant_id, audience_version_id) REFERENCES AudienceVersion(tenant_id, audience_version_id)
);

CREATE TABLE SuppressionEntry (
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    channel VARCHAR(10) NOT NULL CHECK (channel IN ('WHATSAPP','SMS','EMAIL')),
    destination_normalized NVARCHAR(320) NOT NULL,
    reason VARCHAR(30) NOT NULL,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_SuppressionEntry PRIMARY KEY (tenant_id, channel, destination_normalized)
);

ALTER TABLE CampaignRevision ADD
    audience_version_id UNIQUEIDENTIFIER NULL,
    channel VARCHAR(10) NULL CHECK (channel IN ('WHATSAPP','SMS','EMAIL')),
    content_text NVARCHAR(2000) NULL,
    field_defaults_json NVARCHAR(MAX) NULL;
GO
ALTER TABLE CampaignRevision ADD CONSTRAINT FK_CampaignRevision_AudienceVersion
    FOREIGN KEY (tenant_id, audience_version_id) REFERENCES AudienceVersion(tenant_id, audience_version_id);
GO

-- Rendered content kept apart from Message so it can be purged by retention policy (spec §15, §21.6).
CREATE TABLE MessageContent (
    message_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    rendered_text NVARCHAR(2000) NULL,     -- NULL after purge
    purged_at DATETIME2(3) NULL,
    CONSTRAINT FK_MessageContent_Message FOREIGN KEY (tenant_id, message_id) REFERENCES Message(tenant_id, message_id)
);

CREATE TABLE OutboxMessage (
    outbox_id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    message_type VARCHAR(50) NOT NULL,          -- e.g. 'dispatch.sms'
    aggregate_id UNIQUEIDENTIFIER NOT NULL,     -- message_id
    payload NVARCHAR(MAX) NULL,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    available_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    locked_until DATETIME2(3) NULL,
    processed_at DATETIME2(3) NULL,
    attempts INT NOT NULL DEFAULT 0,
    last_error NVARCHAR(400) NULL,
    CONSTRAINT UQ_Outbox_Aggregate UNIQUE (message_type, aggregate_id)
);
CREATE INDEX IX_Outbox_Pending ON OutboxMessage(available_at) WHERE processed_at IS NULL;
GO
