-- V005: provider events find their message by (provider_id, provider_message_id); without an index every event scans Message. Unique: a duplicate provider id must never make the event lookup ambiguous.
CREATE UNIQUE INDEX IX_Message_ProviderMessageId ON Message(provider_id, provider_message_id) WHERE provider_message_id IS NOT NULL;
GO
