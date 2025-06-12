package protocol

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCommandJSONRoundtrip(t *testing.T) {
	tests := []struct {
		name    string
		command Command
	}{
		{
			name: "CreateSession command",
			command: Command{
				ID:        "cmd-123",
				Type:      CmdCreateSession,
				Timestamp: time.Now().Truncate(time.Second),
				Payload: CreateSessionCommand{
					Name:  "test-session",
					Agent: "claude",
					Branch: "main",
					Environment: map[string]string{
						"DEBUG": "true",
						"ENV":   "test",
					},
				},
			},
		},
		{
			name: "DeleteSession command",
			command: Command{
				ID:        "cmd-456",
				Type:      CmdDeleteSession,
				Timestamp: time.Now().Truncate(time.Second),
				Payload: DeleteSessionCommand{
					SessionID: "01HQJW5X7CT4HN3X5V4DKREZJ8",
					Force:     true,
				},
			},
		},
		{
			name: "Command with no payload",
			command: Command{
				ID:        "cmd-789",
				Type:      CmdShutdown,
				Timestamp: time.Now().Truncate(time.Second),
				Payload:   nil,
			},
		},
		{
			name: "SetFocus command",
			command: Command{
				ID:        "cmd-abc",
				Type:      CmdSetFocus,
				Timestamp: time.Now().Truncate(time.Second),
				Payload: SetFocusCommand{
					SessionID: "01HQJW5X7CT4HN3X5V4DKREZJ8",
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Marshal
			data, err := MarshalCommand(tt.command)
			require.NoError(t, err)

			// Unmarshal
			decoded, err := UnmarshalCommand(data)
			require.NoError(t, err)

			// Compare
			assert.Equal(t, tt.command.ID, decoded.ID)
			assert.Equal(t, tt.command.Type, decoded.Type)
			assert.WithinDuration(t, tt.command.Timestamp, decoded.Timestamp, time.Second)
			assert.Equal(t, tt.command.Payload, decoded.Payload)
		})
	}
}

func TestEventJSONRoundtrip(t *testing.T) {
	tests := []struct {
		name  string
		event Event
	}{
		{
			name: "SessionCreated event",
			event: Event{
				ID:        "event-123",
				CommandID: "cmd-456",
				Type:      EventSessionCreated,
				Timestamp: time.Now().Truncate(time.Second),
				Payload: SessionCreatedEvent{
					Session: SessionInfo{
						ID:            "session-789",
						Name:          "test-session",
						Agent:         "claude",
						Status:        StatusReady,
						EnvironmentID: "env-abc",
						Branch:        "main",
						CreatedAt:     time.Now().Truncate(time.Second),
						UpdatedAt:     time.Now().Truncate(time.Second),
					},
				},
			},
		},
		{
			name: "Error event",
			event: Event{
				ID:        "event-def",
				Type:      EventError,
				Timestamp: time.Now().Truncate(time.Second),
				Payload: ErrorEvent{
					Code:        "ERR001",
					Message:     "Test error",
					Details:     "Additional details",
					Recoverable: true,
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Marshal
			data, err := MarshalEvent(tt.event)
			require.NoError(t, err)

			// Unmarshal
			decoded, err := UnmarshalEvent(data)
			require.NoError(t, err)

			// Compare
			assert.Equal(t, tt.event.ID, decoded.ID)
			assert.Equal(t, tt.event.CommandID, decoded.CommandID)
			assert.Equal(t, tt.event.Type, decoded.Type)
			assert.WithinDuration(t, tt.event.Timestamp, decoded.Timestamp, time.Second)
			assert.Equal(t, tt.event.Payload, decoded.Payload)
		})
	}
}

func TestEnhancedEventJSONRoundtrip(t *testing.T) {
	event := EnhancedEvent{
		Metadata: EventMetadata{
			EventID:       "event-123",
			CommandID:     "cmd-456",
			CorrelationID: "corr-789",
			CausationID:   "cause-abc",
			Timestamp:     time.Now().Truncate(time.Second),
			Source:        "test-engine",
			UserID:        "user-def",
			SessionID:     "session-ghi",
			Tags: map[string]string{
				"env":     "test",
				"version": "1.0.0",
			},
		},
		Type: EventStatusChanged,
		Payload: StatusChangedEvent{
			SessionID: "session-ghi",
			OldStatus: StatusReady,
			NewStatus: StatusWorking,
			Reason:    "Agent started",
		},
	}

	// Marshal
	data, err := MarshalEnhancedEvent(event)
	require.NoError(t, err)

	// Unmarshal
	decoded, err := UnmarshalEnhancedEvent(data)
	require.NoError(t, err)

	// Compare metadata
	assert.Equal(t, event.Metadata.EventID, decoded.Metadata.EventID)
	assert.Equal(t, event.Metadata.CommandID, decoded.Metadata.CommandID)
	assert.Equal(t, event.Metadata.CorrelationID, decoded.Metadata.CorrelationID)
	assert.Equal(t, event.Metadata.CausationID, decoded.Metadata.CausationID)
	assert.Equal(t, event.Metadata.Source, decoded.Metadata.Source)
	assert.Equal(t, event.Metadata.UserID, decoded.Metadata.UserID)
	assert.Equal(t, event.Metadata.SessionID, decoded.Metadata.SessionID)
	assert.Equal(t, event.Metadata.Tags, decoded.Metadata.Tags)

	// Compare event
	assert.Equal(t, event.Type, decoded.Type)
	assert.Equal(t, event.Payload, decoded.Payload)
}

func TestUnmarshalCommandErrors(t *testing.T) {
	t.Run("invalid JSON", func(t *testing.T) {
		_, err := UnmarshalCommand([]byte("invalid json"))
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "unmarshal command envelope")
	})

	t.Run("unknown command type", func(t *testing.T) {
		data := `{"id":"cmd-123","type":"unknown.command","timestamp":"2023-01-01T00:00:00Z","payload":{}}`
		_, err := UnmarshalCommand([]byte(data))
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "unknown command type")
	})

	t.Run("invalid payload", func(t *testing.T) {
		data := `{"id":"cmd-123","type":"session.create","timestamp":"2023-01-01T00:00:00Z","payload":"invalid"}`
		_, err := UnmarshalCommand([]byte(data))
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "unmarshal payload")
	})

	t.Run("invalid timestamp", func(t *testing.T) {
		data := `{"id":"cmd-123","type":"session.create","timestamp":"invalid","payload":{}}`
		_, err := UnmarshalCommand([]byte(data))
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "unmarshal timestamp")
	})
}

func TestUnmarshalEventErrors(t *testing.T) {
	t.Run("invalid JSON", func(t *testing.T) {
		_, err := UnmarshalEvent([]byte("invalid json"))
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "unmarshal event envelope")
	})

	t.Run("unknown event type", func(t *testing.T) {
		data := `{"id":"event-123","type":"unknown.event","timestamp":"2023-01-01T00:00:00Z","payload":{}}`
		_, err := UnmarshalEvent([]byte(data))
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "unknown event type")
	})
}

func TestCommandWithNullPayload(t *testing.T) {
	// Test commands that should have null payload
	data := `{"id":"cmd-123","type":"system.shutdown","timestamp":"2023-01-01T00:00:00Z","payload":null}`
	
	cmd, err := UnmarshalCommand([]byte(data))
	require.NoError(t, err)
	
	assert.Equal(t, "cmd-123", cmd.ID)
	assert.Equal(t, CmdShutdown, cmd.Type)
	assert.Nil(t, cmd.Payload)
}

func TestJSONWithRealWorldData(t *testing.T) {
	// Test with data that might come from actual JSON marshaling
	cmd := NewCommand(CmdCreateSession, CreateSessionCommand{
		Name:  "my-session",
		Agent: "claude",
		Environment: map[string]string{
			"PATH": "/usr/bin:/bin",
			"HOME": "/home/user",
		},
	})

	// Marshal using standard JSON
	data, err := json.Marshal(cmd)
	require.NoError(t, err)

	// Unmarshal using our function
	decoded, err := UnmarshalCommand(data)
	require.NoError(t, err)

	assert.Equal(t, cmd.ID, decoded.ID)
	assert.Equal(t, cmd.Type, decoded.Type)
	assert.Equal(t, cmd.Payload, decoded.Payload)
}