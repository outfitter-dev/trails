package protocol

import (
	"time"

	"github.com/oklog/ulid/v2"
)

// EventMetadata contains tracking information for events
type EventMetadata struct {
	EventID       string            `json:"event_id"`
	CommandID     string            `json:"command_id,omitempty"`
	CorrelationID string            `json:"correlation_id"`
	CausationID   string            `json:"causation_id"`
	Timestamp     time.Time         `json:"timestamp"`
	Source        string            `json:"source"`
	UserID        string            `json:"user_id,omitempty"`
	SessionID     string            `json:"session_id,omitempty"`
	Tags          map[string]string `json:"tags,omitempty"`
}

// EnhancedEvent wraps events with metadata
type EnhancedEvent struct {
	Metadata EventMetadata `json:"metadata"`
	Type     EventType     `json:"type"`
	Payload  interface{}   `json:"payload"`
}

// EventBuilder provides fluent interface for building events
type EventBuilder struct {
	event EnhancedEvent
}

// NewEventBuilder creates a new event builder
func NewEventBuilder(eventType EventType) *EventBuilder {
	return &EventBuilder{
		event: EnhancedEvent{
			Metadata: EventMetadata{
				EventID:   ulid.Make().String(),
				Timestamp: time.Now(),
				Source:    "trails-engine",
			},
			Type: eventType,
		},
	}
}

// WithCommandID links event to a command
func (b *EventBuilder) WithCommandID(id string) *EventBuilder {
	b.event.Metadata.CommandID = id
	return b
}

// WithCorrelation sets correlation ID
func (b *EventBuilder) WithCorrelation(id string) *EventBuilder {
	b.event.Metadata.CorrelationID = id
	return b
}

// WithCausation sets causation ID
func (b *EventBuilder) WithCausation(id string) *EventBuilder {
	b.event.Metadata.CausationID = id
	return b
}

// WithUserID sets user ID
func (b *EventBuilder) WithUserID(id string) *EventBuilder {
	b.event.Metadata.UserID = id
	return b
}

// WithSessionID sets session ID
func (b *EventBuilder) WithSessionID(id string) *EventBuilder {
	b.event.Metadata.SessionID = id
	return b
}

// WithSource sets event source
func (b *EventBuilder) WithSource(source string) *EventBuilder {
	b.event.Metadata.Source = source
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

// WithPayload sets event payload
func (b *EventBuilder) WithPayload(payload interface{}) *EventBuilder {
	b.event.Payload = payload
	return b
}

// Build returns the constructed event
func (b *EventBuilder) Build() EnhancedEvent {
	// Set correlation ID if not set
	if b.event.Metadata.CorrelationID == "" {
		b.event.Metadata.CorrelationID = b.event.Metadata.EventID
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
	return NewEventBuilder(eventType).WithPayload(payload).Build()
}

// NewEnhancedEventForCommand creates event in response to command
func NewEnhancedEventForCommand(eventType EventType, commandID string, payload interface{}) EnhancedEvent {
	return NewEventBuilder(eventType).
		WithCommandID(commandID).
		WithPayload(payload).
		Build()
}