-- V006: who shaped each campaign revision. The "above N recipients, not self" rule (spec: separation of duties) must hold against
-- everyone who authored the current revision (EDIT) or submitted it (SUBMIT), not only Campaign.created_by.
-- Append-only: an in-place draft edited by two people keeps both. Guarded so a partial manual run can be repeated.
IF OBJECT_ID('dbo.CampaignRevisionActor') IS NULL
CREATE TABLE CampaignRevisionActor (
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    campaign_revision_id UNIQUEIDENTIFIER NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    action VARCHAR(10) NOT NULL CHECK (action IN ('EDIT','SUBMIT')),
    acted_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_CampaignRevisionActor PRIMARY KEY (tenant_id, campaign_revision_id, user_id, action),
    CONSTRAINT FK_CampaignRevisionActor_Revision FOREIGN KEY (tenant_id, campaign_revision_id) REFERENCES CampaignRevision(tenant_id, campaign_revision_id)
);
GO
-- Backfill (conservative): every existing revision counts the campaign creator as its author.
INSERT CampaignRevisionActor(tenant_id, campaign_revision_id, user_id, action)
SELECT r.tenant_id, r.campaign_revision_id, c.created_by, 'EDIT'
FROM CampaignRevision r JOIN Campaign c ON c.tenant_id = r.tenant_id AND c.campaign_id = r.campaign_id
WHERE NOT EXISTS (SELECT 1 FROM CampaignRevisionActor a WHERE a.tenant_id = r.tenant_id AND a.campaign_revision_id = r.campaign_revision_id
                  AND a.user_id = c.created_by AND a.action = 'EDIT');
GO
