package protocol

// EventWithMetadata represents an event enriched with full metadata
// This is the primary event type used throughout the system, providing
// correlation tracking, causation chains, and audit information.
type EventWithMetadata = EnhancedEvent

// The EnhancedEvent name is kept for backward compatibility but
// EventWithMetadata should be preferred in new code as it's more descriptive.