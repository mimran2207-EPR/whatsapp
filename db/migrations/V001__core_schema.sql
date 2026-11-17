-- V001: core entities (spec §8). tenant_id on every table. All times UTC.
CREATE TABLE Tenant (
    tenant_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    name NVARCHAR(200) NOT NULL,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE Audience (
    audience_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    name NVARCHAR(200) NOT NULL,
    audience_kind VARCHAR(20) NOT NULL CHECK (audience_kind IN ('FILE','SQL','API','SAVED_FILTER','REUSABLE')),
    owner_id VARCHAR(100) NULL,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Audience_Tenant UNIQUE (tenant_id, audience_id)
);

CREATE TABLE AudienceVersion (
    audience_version_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    audience_id UNIQUEIDENTIFIER NOT NULL,
    version_no INT NOT NULL,
    source_loaded_at DATETIME2(3) NULL,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_AudienceVersion UNIQUE (tenant_id, audience_id, version_no),
    CONSTRAINT UQ_AudienceVersion_Tenant UNIQUE (tenant_id, audience_version_id),
    CONSTRAINT FK_AudienceVersion_Audience FOREIGN KEY (tenant_id, audience_id) REFERENCES Audience(tenant_id, audience_id)
);

-- Immutable once created (created at approval).
CREATE TABLE AudienceSnapshot (
    audience_snapshot_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    audience_version_id UNIQUEIDENTIFIER NOT NULL,
    frozen_at DATETIME2(3) NOT NULL,
    CONSTRAINT UQ_AudienceSnapshot_Tenant UNIQUE (tenant_id, audience_snapshot_id),
    CONSTRAINT FK_AudienceSnapshot_Version FOREIGN KEY (tenant_id, audience_version_id) REFERENCES AudienceVersion(tenant_id, audience_version_id)
);
-- Tenant isolation in the data layer (spec §15): every child FK is composite (tenant_id, parent_id),
-- so a row can never reference a parent of another tenant.

CREATE TABLE Campaign (
    campaign_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    department_id VARCHAR(50) NOT NULL,
    campaign_name NVARCHAR(200) NOT NULL,
    campaign_description NVARCHAR(2000) NULL,
    campaign_type VARCHAR(20) NOT NULL CHECK (campaign_type IN ('MANUAL','SCHEDULED','API','EVENT','CHILD')),
    communication_purpose VARCHAR(20) NOT NULL CHECK (communication_purpose IN ('SERVICE','OPERATIONAL','PUBLIC_INFO','EMERGENCY','PROMOTIONAL')),
    campaign_state VARCHAR(30) NOT NULL,
    parent_campaign_id UNIQUEIDENTIFIER NULL,
    created_by VARCHAR(100) NOT NULL,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Campaign_Tenant UNIQUE (tenant_id, campaign_id),
    CONSTRAINT FK_Campaign_Parent FOREIGN KEY (tenant_id, parent_campaign_id) REFERENCES Campaign(tenant_id, campaign_id)
);

CREATE TABLE CampaignRevision (
    campaign_revision_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    campaign_id UNIQUEIDENTIFIER NOT NULL,
    revision_no INT NOT NULL,
    audience_snapshot_id UNIQUEIDENTIFIER NULL,
    approval_package_hash CHAR(64) NULL,           -- canonical hash: audience + content + documents + channels + schedule + policy version
    scheduled_at DATETIME2(3) NULL,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_CampaignRevision UNIQUE (tenant_id, campaign_id, revision_no),
    CONSTRAINT UQ_CampaignRevision_Tenant UNIQUE (tenant_id, campaign_revision_id),
    CONSTRAINT FK_CampaignRevision_Campaign FOREIGN KEY (tenant_id, campaign_id) REFERENCES Campaign(tenant_id, campaign_id),
    CONSTRAINT FK_CampaignRevision_Snapshot FOREIGN KEY (tenant_id, audience_snapshot_id) REFERENCES AudienceSnapshot(tenant_id, audience_snapshot_id)
);

CREATE TABLE Approval (
    approval_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    campaign_revision_id UNIQUEIDENTIFIER NOT NULL,
    approval_package_hash CHAR(64) NOT NULL,
    decision VARCHAR(20) NOT NULL CHECK (decision IN ('APPROVED','RETURNED')),
    decided_by VARCHAR(100) NOT NULL,
    decided_at DATETIME2(3) NOT NULL,
    invalidated_at DATETIME2(3) NULL,              -- set when a material change creates a new revision
    note NVARCHAR(2000) NULL,
    CONSTRAINT FK_Approval_Revision FOREIGN KEY (tenant_id, campaign_revision_id) REFERENCES CampaignRevision(tenant_id, campaign_revision_id)
);

-- One frozen recipient per snapshot. A re-approved audience creates a new snapshot holding the same people,
-- so uniqueness is per snapshot, not per campaign (spec §4, §21.2). Shared contact details never merge recipients (spec §0).
CREATE TABLE CampaignRecipient (
    campaign_recipient_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    campaign_id UNIQUEIDENTIFIER NOT NULL,
    audience_snapshot_id UNIQUEIDENTIFIER NOT NULL,
    source_recipient_id NVARCHAR(100) NOT NULL,    -- string; leading zeros kept
    approved_identity_key NVARCHAR(200) NOT NULL,
    eligibility_state VARCHAR(30) NULL,
    primary_exclusion_reason VARCHAR(50) NULL,
    CONSTRAINT UQ_CampaignRecipient UNIQUE (tenant_id, audience_snapshot_id, approved_identity_key),
    CONSTRAINT UQ_CampaignRecipient_Tenant UNIQUE (tenant_id, campaign_recipient_id),
    CONSTRAINT FK_CampaignRecipient_Campaign FOREIGN KEY (tenant_id, campaign_id) REFERENCES Campaign(tenant_id, campaign_id),
    CONSTRAINT FK_CampaignRecipient_Snapshot FOREIGN KEY (tenant_id, audience_snapshot_id) REFERENCES AudienceSnapshot(tenant_id, audience_snapshot_id)
);

-- Logical message = recipient × channel × sequence step (spec §21.3).
CREATE TABLE Message (
    message_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    campaign_id UNIQUEIDENTIFIER NOT NULL,
    campaign_revision_id UNIQUEIDENTIFIER NOT NULL,
    campaign_recipient_id UNIQUEIDENTIFIER NOT NULL,
    parent_message_id UNIQUEIDENTIFIER NULL,       -- fallback only
    channel VARCHAR(10) NOT NULL CHECK (channel IN ('WHATSAPP','SMS','EMAIL')),
    channel_sequence_no INT NOT NULL,
    idempotency_key VARCHAR(200) NOT NULL,
    destination_raw NVARCHAR(320) NULL,
    destination_value NVARCHAR(320) NOT NULL,      -- E.164 or email
    template_id UNIQUEIDENTIFIER NULL,
    template_version VARCHAR(50) NULL,
    content_ref VARCHAR(400) NULL,                 -- encrypted reference, not content
    content_hash CHAR(64) NULL,
    provider_id VARCHAR(50) NULL,
    provider_message_id VARCHAR(200) NULL,
    provider_status_raw NVARCHAR(200) NULL,
    processing_state VARCHAR(25) NOT NULL CHECK (processing_state IN ('REJECTED_BEFORE_SEND','PENDING','QUEUED','IN_PROGRESS','CANCELED')),
    handoff_state VARCHAR(20) NOT NULL CHECK (handoff_state IN ('NOT_HANDED_OFF','HANDED_OFF','ACCEPTED','REJECTED','UNKNOWN')),
    delivery_state VARCHAR(20) NOT NULL CHECK (delivery_state IN ('NOT_REPORTED','SENT_PER_PROVIDER','DELIVERED','FAILED','UNKNOWN')),
    data_quality VARCHAR(15) NOT NULL CHECK (data_quality IN ('CURRENT','PARTIAL','LATE','CONFLICTING','UNSUPPORTED')),
    read_at DATETIME2(3) NULL, opened_at DATETIME2(3) NULL, clicked_at DATETIME2(3) NULL,
    replied_at DATETIME2(3) NULL, opted_out_at DATETIME2(3) NULL,
    status_mapping_version VARCHAR(50) NULL,
    created_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Message_Logical UNIQUE (tenant_id, campaign_id, campaign_revision_id, campaign_recipient_id, channel, channel_sequence_no),
    CONSTRAINT UQ_Message_Idempotency UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT UQ_Message_Tenant UNIQUE (tenant_id, message_id),
    CONSTRAINT FK_Message_Campaign FOREIGN KEY (tenant_id, campaign_id) REFERENCES Campaign(tenant_id, campaign_id),
    CONSTRAINT FK_Message_Revision FOREIGN KEY (tenant_id, campaign_revision_id) REFERENCES CampaignRevision(tenant_id, campaign_revision_id),
    CONSTRAINT FK_Message_Recipient FOREIGN KEY (tenant_id, campaign_recipient_id) REFERENCES CampaignRecipient(tenant_id, campaign_recipient_id),
    CONSTRAINT FK_Message_Parent FOREIGN KEY (tenant_id, parent_message_id) REFERENCES Message(tenant_id, message_id)
);

-- Retry = new attempt, not new message.
CREATE TABLE SendAttempt (
    attempt_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    message_id UNIQUEIDENTIFIER NOT NULL,
    attempt_number INT NOT NULL,
    attempt_reason VARCHAR(20) NOT NULL CHECK (attempt_reason IN ('INITIAL','CONTROLLED_RETRY')),
    request_started_at DATETIME2(3) NOT NULL,
    response_received_at DATETIME2(3) NULL,
    attempt_outcome VARCHAR(20) NULL CHECK (attempt_outcome IN ('ACCEPTED','REJECTED','LOCAL_FAILURE','AMBIGUOUS')),
    acceptance_ambiguous BIT NOT NULL DEFAULT 0,
    provider_message_id VARCHAR(200) NULL,
    provider_response_code VARCHAR(50) NULL,
    provider_error_code VARCHAR(100) NULL,
    retry_not_before DATETIME2(3) NULL,
    CONSTRAINT UQ_SendAttempt UNIQUE (message_id, attempt_number),
    CONSTRAINT UQ_SendAttempt_Tenant UNIQUE (tenant_id, attempt_id),
    CONSTRAINT FK_SendAttempt_Message FOREIGN KEY (tenant_id, message_id) REFERENCES Message(tenant_id, message_id)
);

-- Append-only event log. message_id NULL = unattributed (never guessed).
CREATE TABLE MessageEvent (
    event_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    message_id UNIQUEIDENTIFIER NULL,
    attempt_id UNIQUEIDENTIFIER NULL,
    provider_event_id VARCHAR(200) NULL,
    deduplication_key VARCHAR(200) NOT NULL,
    event_type_raw NVARCHAR(200) NOT NULL,
    event_type VARCHAR(30) NOT NULL,
    event_source VARCHAR(20) NOT NULL CHECK (event_source IN ('WEBHOOK','POLLING','API','RECONCILIATION','INTERNAL')),
    occurred_at DATETIME2(3) NULL,                 -- never invented
    received_at DATETIME2(3) NOT NULL,
    processed_at DATETIME2(3) NOT NULL,
    signature_valid BIT NOT NULL,
    correlation_quality VARCHAR(20) NULL,
    payload_ref VARCHAR(400) NULL,
    CONSTRAINT UQ_MessageEvent_Dedup UNIQUE (tenant_id, deduplication_key),
    CONSTRAINT FK_MessageEvent_Message FOREIGN KEY (tenant_id, message_id) REFERENCES Message(tenant_id, message_id),
    CONSTRAINT FK_MessageEvent_Attempt FOREIGN KEY (tenant_id, attempt_id) REFERENCES SendAttempt(tenant_id, attempt_id)
);
GO

CREATE TRIGGER TR_MessageEvent_AppendOnly ON MessageEvent
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    THROW 51000, 'MessageEvent is append-only.', 1;
END;
GO

-- Match key: tenant + campaign + campaign_recipient_id + document_key (spec §7).
CREATE TABLE Document (
    document_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    campaign_id UNIQUEIDENTIFIER NOT NULL,
    campaign_recipient_id UNIQUEIDENTIFIER NOT NULL,
    document_key NVARCHAR(200) NOT NULL,
    document_template_id UNIQUEIDENTIFIER NULL,
    document_template_version VARCHAR(50) NULL,
    generation_state VARCHAR(20) NOT NULL CHECK (generation_state IN ('PLANNED','GENERATED','FAILED','PURGED')),
    recipient_match_state VARCHAR(20) NOT NULL CHECK (recipient_match_state IN ('UNCHECKED','MATCHED','UNMATCHED','AMBIGUOUS')),
    content_sha256 CHAR(64) NULL,
    generated_at DATETIME2(3) NULL,
    CONSTRAINT UQ_Document_Match UNIQUE (tenant_id, campaign_id, campaign_recipient_id, document_key),
    CONSTRAINT UQ_Document_Tenant UNIQUE (tenant_id, document_id),
    CONSTRAINT FK_Document_Campaign FOREIGN KEY (tenant_id, campaign_id) REFERENCES Campaign(tenant_id, campaign_id),
    CONSTRAINT FK_Document_Recipient FOREIGN KEY (tenant_id, campaign_recipient_id) REFERENCES CampaignRecipient(tenant_id, campaign_recipient_id)
);

CREATE TABLE MessageDocumentLink (
    message_document_link_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES Tenant(tenant_id),
    message_id UNIQUEIDENTIFIER NOT NULL,
    document_id UNIQUEIDENTIFIER NOT NULL,
    delivery_mode VARCHAR(20) NOT NULL CHECK (delivery_mode IN ('ATTACHMENT','SECURE_LINK')),
    attachment_or_link_state VARCHAR(20) NOT NULL,
    link_expires_at DATETIME2(3) NULL,
    CONSTRAINT UQ_MessageDocumentLink UNIQUE (message_id, document_id),
    CONSTRAINT FK_Link_Message FOREIGN KEY (tenant_id, message_id) REFERENCES Message(tenant_id, message_id),
    CONSTRAINT FK_Link_Document FOREIGN KEY (tenant_id, document_id) REFERENCES Document(tenant_id, document_id)
);
GO
