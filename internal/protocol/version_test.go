package protocol

import (
	"testing"

	"github.com/Masterminds/semver/v3"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNegotiateVersion(t *testing.T) {
	tests := []struct {
		name         string
		client       string
		server       string
		expected     string
		expectError  bool
		errorMessage string
	}{
		{
			name:     "same versions",
			client:   "1.0.0",
			server:   "1.0.0",
			expected: "1.0.0",
		},
		{
			name:     "client older",
			client:   "1.0.0",
			server:   "1.1.0",
			expected: "1.0.0",
		},
		{
			name:     "server older",
			client:   "1.1.0",
			server:   "1.0.0",
			expected: "1.0.0",
		},
		{
			name:         "client too old",
			client:       "0.9.0",
			server:       "1.0.0",
			expectError:  true,
			errorMessage: "client version 0.9.0 is too old",
		},
		{
			name:         "nil client",
			client:       "",
			server:       "1.0.0",
			expectError:  true,
			errorMessage: "version cannot be nil",
		},
		{
			name:         "nil server",
			client:       "1.0.0",
			server:       "",
			expectError:  true,
			errorMessage: "version cannot be nil",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var client, server *semver.Version
			var err error

			if tt.client != "" {
				client, err = semver.NewVersion(tt.client)
				require.NoError(t, err)
			}

			if tt.server != "" {
				server, err = semver.NewVersion(tt.server)
				require.NoError(t, err)
			}

			result, err := NegotiateVersion(client, server)

			if tt.expectError {
				assert.Error(t, err)
				if tt.errorMessage != "" {
					assert.Contains(t, err.Error(), tt.errorMessage)
				}
			} else {
				assert.NoError(t, err)
				assert.Equal(t, tt.expected, result.String())
			}
		})
	}
}

func TestGetCapabilities(t *testing.T) {
	caps := GetCapabilities()

	assert.Equal(t, CurrentVersion, caps.ServerVersion)
	assert.Equal(t, MinSupportedVersion, caps.MinClientVersion)
	assert.NotEmpty(t, caps.Commands)
	assert.NotEmpty(t, caps.Events)
	assert.NotEmpty(t, caps.Extensions)
	assert.NotEmpty(t, caps.Features)

	// Check that all command types are represented
	commandTypes := make(map[CommandType]bool)
	for _, cmd := range caps.Commands {
		commandTypes[cmd.Type] = true
	}

	expectedCommands := []CommandType{
		CmdCreateSession, CmdDeleteSession, CmdUpdateSession, CmdListSessions,
		CmdStartAgent, CmdStopAgent, CmdRestartAgent,
		CmdSetFocus, CmdNextActionable, CmdToggleMinimal, CmdSetPreference,
		CmdShutdown, CmdHealthCheck,
	}

	for _, expected := range expectedCommands {
		assert.True(t, commandTypes[expected], "Missing command type: %s", expected)
	}

	// Check that all event types are represented
	eventTypes := make(map[EventType]bool)
	for _, event := range caps.Events {
		eventTypes[event.Type] = true
	}

	expectedEvents := []EventType{
		EventSessionCreated, EventSessionDeleted, EventSessionUpdated, EventSessionList,
		EventStatusChanged, EventProgressUpdate, EventEnvironmentReady, EventEnvironmentError,
		EventError, EventWarning, EventInfo, EventStateSnapshot, EventHealthStatus,
	}

	for _, expected := range expectedEvents {
		assert.True(t, eventTypes[expected], "Missing event type: %s", expected)
	}

	// Check essential features
	assert.True(t, caps.Features["authentication"])
	assert.True(t, caps.Features["rate_limiting"])
	assert.True(t, caps.Features["audit_logging"])
	assert.True(t, caps.Features["event_metadata"])
}

func TestCommandInfo(t *testing.T) {
	commands := getAllCommandInfo()

	for _, cmd := range commands {
		assert.NotEmpty(t, cmd.Type)
		assert.NotEmpty(t, cmd.Description)
		assert.NotEmpty(t, cmd.Since)
		assert.False(t, cmd.Deprecated) // None should be deprecated in v1.0.0
	}
}

func TestEventCapability(t *testing.T) {
	events := getAllEventInfo()

	for _, event := range events {
		assert.NotEmpty(t, event.Type)
		assert.NotEmpty(t, event.Description)
		assert.NotEmpty(t, event.Since)
		assert.False(t, event.Deprecated) // None should be deprecated in v1.0.0
	}
}

func TestExtensions(t *testing.T) {
	extensions := getExtensions()

	assert.NotEmpty(t, extensions)

	for _, ext := range extensions {
		assert.NotEmpty(t, ext.Name)
		assert.NotEmpty(t, ext.Description)
		assert.NotEmpty(t, ext.Version)
		// All current extensions should be enabled
		assert.True(t, ext.Enabled)
	}
}