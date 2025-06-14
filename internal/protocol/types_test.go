package protocol

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewCommand(t *testing.T) {
	payload := CreateSessionCommand{
		Name:  "test-session",
		Agent: "claude",
	}

	cmd := NewCommand(CmdCreateSession, payload)

	assert.NotEmpty(t, cmd.ID)
	assert.Equal(t, CmdCreateSession, cmd.Type)
	assert.Equal(t, payload, cmd.Payload)
	assert.WithinDuration(t, time.Now(), cmd.Timestamp, time.Second)
}

func TestNewEvent(t *testing.T) {
	payload := SessionCreatedEvent{
		Session: SessionInfo{
			ID:     "test-id",
			Name:   "test-session",
			Agent:  "claude",
			Status: StatusReady,
		},
	}

	event := NewEvent(EventSessionCreated, payload)

	assert.NotEmpty(t, event.ID)
	assert.Empty(t, event.CommandID)
	assert.Equal(t, EventSessionCreated, event.Type)
	assert.Equal(t, payload, event.Payload)
	assert.WithinDuration(t, time.Now(), event.Timestamp, time.Second)
}

func TestNewEventForCommand(t *testing.T) {
	commandID := "cmd-123"
	payload := SessionCreatedEvent{
		Session: SessionInfo{
			ID:     "test-id",
			Name:   "test-session",
			Agent:  "claude",
			Status: StatusReady,
		},
	}

	event := NewEventForCommand(EventSessionCreated, commandID, payload)

	assert.NotEmpty(t, event.ID)
	assert.Equal(t, commandID, event.CommandID)
	assert.Equal(t, EventSessionCreated, event.Type)
	assert.Equal(t, payload, event.Payload)
}

func TestCommandSerialization(t *testing.T) {
	original := NewCommand(CmdCreateSession, CreateSessionCommand{
		Name:  "test-session",
		Agent: "claude",
	})

	// Serialize
	data, err := json.Marshal(original)
	require.NoError(t, err)

	// Deserialize
	var decoded Command
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	// Verify fields (except payload which needs type assertion)
	assert.Equal(t, original.ID, decoded.ID)
	assert.Equal(t, original.Type, decoded.Type)
	assert.WithinDuration(t, original.Timestamp, decoded.Timestamp, time.Millisecond)
}

func TestEventSerialization(t *testing.T) {
	original := NewEvent(EventSessionCreated, SessionCreatedEvent{
		Session: SessionInfo{
			ID:        "test-id",
			Name:      "test-session",
			Agent:     "claude",
			Status:    StatusReady,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		},
	})

	// Serialize
	data, err := json.Marshal(original)
	require.NoError(t, err)

	// Deserialize
	var decoded Event
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	// Verify fields
	assert.Equal(t, original.ID, decoded.ID)
	assert.Equal(t, original.Type, decoded.Type)
	assert.WithinDuration(t, original.Timestamp, decoded.Timestamp, time.Millisecond)
}

func TestSessionStatusValues(t *testing.T) {
	// Ensure all status values are unique
	statuses := []SessionStatus{
		StatusReady,
		StatusWorking,
		StatusWaiting,
		StatusError,
		StatusThinking,
	}

	seen := make(map[SessionStatus]bool)
	for _, status := range statuses {
		if seen[status] {
			t.Errorf("Duplicate status value: %s", status)
		}
		seen[status] = true
	}
}

func TestCommandTypeValues(t *testing.T) {
	// Ensure all command types follow naming convention
	commandTypes := []CommandType{
		CmdCreateSession,
		CmdDeleteSession,
		CmdUpdateSession,
		CmdListSessions,
		CmdStartAgent,
		CmdStopAgent,
		CmdRestartAgent,
		CmdSetFocus,
		CmdNextActionable,
		CmdToggleMinimal,
		CmdSetPreference,
		CmdShutdown,
		CmdHealthCheck,
	}

	for _, cmdType := range commandTypes {
		assert.Contains(t, string(cmdType), ".")
		assert.NotEmpty(t, cmdType)
	}
}

func TestEventTypeValues(t *testing.T) {
	// Ensure all event types follow naming convention
	eventTypes := []EventType{
		EventSessionCreated,
		EventSessionDeleted,
		EventSessionUpdated,
		EventSessionList,
		EventStatusChanged,
		EventProgressUpdate,
		EventEnvironmentReady,
		EventEnvironmentError,
		EventError,
		EventWarning,
		EventInfo,
		EventStateSnapshot,
		EventHealthStatus,
	}

	for _, eventType := range eventTypes {
		assert.Contains(t, string(eventType), ".")
		assert.NotEmpty(t, eventType)
	}
}