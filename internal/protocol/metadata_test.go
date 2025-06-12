package protocol

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestEventBuilder(t *testing.T) {
	t.Run("basic event building", func(t *testing.T) {
		payload := SessionCreatedEvent{
			Session: SessionInfo{
				ID:     "session-123",
				Name:   "test-session",
				Agent:  "claude",
				Status: StatusReady,
			},
		}

		event := NewEventBuilder(EventSessionCreated).
			WithPayload(payload).
			Build()

		assert.Equal(t, EventSessionCreated, event.Type)
		assert.Equal(t, payload, event.Payload)
		assert.NotEmpty(t, event.Metadata.EventID)
		assert.Equal(t, "trails-engine", event.Metadata.Source)
		assert.WithinDuration(t, time.Now(), event.Metadata.Timestamp, time.Second)

		// Correlation ID should default to event ID
		assert.Equal(t, event.Metadata.EventID, event.Metadata.CorrelationID)
		// Causation ID should default to event ID when no command
		assert.Equal(t, event.Metadata.EventID, event.Metadata.CausationID)
	})

	t.Run("event with command", func(t *testing.T) {
		commandID := "cmd-456"
		
		event := NewEventBuilder(EventSessionCreated).
			WithCommandID(commandID).
			WithPayload(SessionCreatedEvent{}).
			Build()

		assert.Equal(t, commandID, event.Metadata.CommandID)
		// Causation ID should be set to command ID
		assert.Equal(t, commandID, event.Metadata.CausationID)
	})

	t.Run("event with full metadata", func(t *testing.T) {
		event := NewEventBuilder(EventSessionCreated).
			WithCommandID("cmd-123").
			WithCorrelation("corr-456").
			WithCausation("cause-789").
			WithUserID("user-abc").
			WithSessionID("session-def").
			WithSource("test-source").
			WithTag("key1", "value1").
			WithTag("key2", "value2").
			WithPayload(SessionCreatedEvent{}).
			Build()

		assert.Equal(t, "cmd-123", event.Metadata.CommandID)
		assert.Equal(t, "corr-456", event.Metadata.CorrelationID)
		assert.Equal(t, "cause-789", event.Metadata.CausationID)
		assert.Equal(t, "user-abc", event.Metadata.UserID)
		assert.Equal(t, "session-def", event.Metadata.SessionID)
		assert.Equal(t, "test-source", event.Metadata.Source)
		assert.Equal(t, "value1", event.Metadata.Tags["key1"])
		assert.Equal(t, "value2", event.Metadata.Tags["key2"])
	})

	t.Run("tags initialization", func(t *testing.T) {
		event := NewEventBuilder(EventInfo).
			WithTag("first", "value").
			Build()

		assert.NotNil(t, event.Metadata.Tags)
		assert.Equal(t, "value", event.Metadata.Tags["first"])
	})

	t.Run("multiple tags", func(t *testing.T) {
		event := NewEventBuilder(EventInfo).
			WithTag("tag1", "value1").
			WithTag("tag2", "value2").
			WithTag("tag3", "value3").
			Build()

		assert.Len(t, event.Metadata.Tags, 3)
		assert.Equal(t, "value1", event.Metadata.Tags["tag1"])
		assert.Equal(t, "value2", event.Metadata.Tags["tag2"])
		assert.Equal(t, "value3", event.Metadata.Tags["tag3"])
	})
}

func TestNewEnhancedEvent(t *testing.T) {
	payload := InfoEvent{Message: "test message"}
	event := NewEnhancedEvent(EventInfo, payload)

	assert.Equal(t, EventInfo, event.Type)
	assert.Equal(t, payload, event.Payload)
	assert.NotEmpty(t, event.Metadata.EventID)
	assert.Equal(t, "trails-engine", event.Metadata.Source)
}

func TestNewEnhancedEventForCommand(t *testing.T) {
	commandID := "cmd-789"
	payload := SessionDeletedEvent{SessionID: "session-123"}
	
	event := NewEnhancedEventForCommand(EventSessionDeleted, commandID, payload)

	assert.Equal(t, EventSessionDeleted, event.Type)
	assert.Equal(t, payload, event.Payload)
	assert.Equal(t, commandID, event.Metadata.CommandID)
	assert.Equal(t, commandID, event.Metadata.CausationID)
	assert.NotEmpty(t, event.Metadata.EventID)
}

func TestEventMetadata(t *testing.T) {
	metadata := EventMetadata{
		EventID:       "event-123",
		CommandID:     "cmd-456",
		CorrelationID: "corr-789",
		CausationID:   "cause-abc",
		Timestamp:     time.Now(),
		Source:        "test-source",
		UserID:        "user-def",
		SessionID:     "session-ghi",
		Tags: map[string]string{
			"environment": "test",
			"version":     "1.0.0",
		},
	}

	assert.Equal(t, "event-123", metadata.EventID)
	assert.Equal(t, "cmd-456", metadata.CommandID)
	assert.Equal(t, "corr-789", metadata.CorrelationID)
	assert.Equal(t, "cause-abc", metadata.CausationID)
	assert.Equal(t, "test-source", metadata.Source)
	assert.Equal(t, "user-def", metadata.UserID)
	assert.Equal(t, "session-ghi", metadata.SessionID)
	assert.Equal(t, "test", metadata.Tags["environment"])
	assert.Equal(t, "1.0.0", metadata.Tags["version"])
}

func TestEnhancedEvent(t *testing.T) {
	metadata := EventMetadata{
		EventID:   "event-456",
		Source:    "test-engine",
		Timestamp: time.Now(),
	}

	payload := WarningEvent{
		Code:    "WARN001",
		Message: "Test warning",
		Details: "Additional details",
	}

	event := EnhancedEvent{
		Metadata: metadata,
		Type:     EventWarning,
		Payload:  payload,
	}

	assert.Equal(t, metadata, event.Metadata)
	assert.Equal(t, EventWarning, event.Type)
	assert.Equal(t, payload, event.Payload)
}