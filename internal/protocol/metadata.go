package protocol

import (
	"time"

	"github.com/oklog/ulid/v2"
)

// EventMetadata contains event metadata for tracing and auditing
type EventMetadata struct {
	EventID       string            `json:"event_id"`       // Unique identifier for this event
	CommandID     string            `json:"command_id"`     // ID of originating command (if any)
	SessionID     string            `json:"session_id"`     // Session this event relates to (if any)
	Source        string            `json:"source"`         // Component that generated this event
	Timestamp     time.Time         `json:"timestamp"`      // When this event occurred
	CorrelationID string            `json:"correlation_id"` // For grouping related events
	CausationID   string            `json:"causation_id"`   // What caused this event
	Tags          map[string]string `json:"tags,omitempty"` // Additional metadata
}

// EnhancedEvent wraps events with rich metadata
type EnhancedEvent struct {
	Type     EventType     `json:"type"`
	Payload  interface{}   `json:"payload"`
	Metadata EventMetadata `json:"metadata"`
}

// EventBuilder helps construct events with proper metadata
type EventBuilder struct {
	event EnhancedEvent
}

// NewEventBuilder creates a new event builder
func NewEventBuilder(eventType EventType) *EventBuilder {
	return &EventBuilder{
		event: EnhancedEvent{
			Type: eventType,
			Metadata: EventMetadata{
				EventID:   ulid.Make().String(),
				Timestamp: time.Now(),
				Tags:      make(map[string]string),
			},
		},
	}
}

// WithCommandID sets the command ID that triggered this event
func (b *EventBuilder) WithCommandID(commandID string) *EventBuilder {
	b.event.Metadata.CommandID = commandID
	return b
}

// WithSessionID sets the session ID this event relates to
func (b *EventBuilder) WithSessionID(sessionID string) *EventBuilder {
	b.event.Metadata.SessionID = sessionID
	return b
}

// WithSource sets the component that generated this event
func (b *EventBuilder) WithSource(source string) *EventBuilder {
	b.event.Metadata.Source = source
	return b
}

// WithCorrelationID sets the correlation ID for event grouping
func (b *EventBuilder) WithCorrelationID(correlationID string) *EventBuilder {
	b.event.Metadata.CorrelationID = correlationID
	return b
}

// WithCausationID sets what caused this event
func (b *EventBuilder) WithCausationID(causationID string) *EventBuilder {
	b.event.Metadata.CausationID = causationID
	return b
}

// WithPayload sets the event payload
func (b *EventBuilder) WithPayload(payload interface{}) *EventBuilder {
	b.event.Payload = payload
	return b
}

// WithTag adds a metadata tag
func (b *EventBuilder) WithTag(key, value string) *EventBuilder {
	if b.event.Metadata.Tags == nil {
		b.event.Metadata.Tags = make(map[string]string)
	}
	b.event.Metadata.Tags[key] = value
	return b
}

// WithTags adds multiple metadata tags
func (b *EventBuilder) WithTags(tags map[string]string) *EventBuilder {
	if b.event.Metadata.Tags == nil {
		b.event.Metadata.Tags = make(map[string]string)
	}
	for k, v := range tags {
		b.event.Metadata.Tags[k] = v
	}
	return b
}

// Build returns the constructed event
func (b *EventBuilder) Build() EnhancedEvent {
	// Set correlation ID if not set
	if b.event.Metadata.CorrelationID == "" {
		if b.event.Metadata.CommandID != "" {
			b.event.Metadata.CorrelationID = b.event.Metadata.CommandID
		} else {
			b.event.Metadata.CorrelationID = b.event.Metadata.EventID
		}
	}
	
	// Set causation ID if not set
	if b.event.Metadata.CausationID == "" {
		if b.event.Metadata.CommandID != "" {
			b.event.Metadata.CausationID = b.event.Metadata.CommandID
		} else {
			b.event.Metadata.CausationID = b.event.Metadata.EventID
		}
	}
	
	return b.event
}

// NewEnhancedEvent creates event with metadata (backwards compatibility)
func NewEnhancedEvent(eventType EventType, payload interface{}) EnhancedEvent {
	return NewEventBuilder(eventType).
		WithPayload(payload).
		Build()
}

// NewEnhancedEventForCommand creates event with command context
func NewEnhancedEventForCommand(eventType EventType, commandID string, payload interface{}) EnhancedEvent {
	return NewEventBuilder(eventType).
		WithCommandID(commandID).
		WithPayload(payload).
		Build()
}

// NewEnhancedEventForSession creates event with session context
func NewEnhancedEventForSession(eventType EventType, sessionID string, payload interface{}) EnhancedEvent {
	return NewEventBuilder(eventType).
		WithSessionID(sessionID).
		WithPayload(payload).
		Build()
}