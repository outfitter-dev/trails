package protocol

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateSessionBuilder(t *testing.T) {
	cmd, err := CreateSession("test-session", "claude").Build()
	require.NoError(t, err)

	assert.Equal(t, CmdCreateSession, cmd.Type)
	assert.NotEmpty(t, cmd.ID)
	assert.NotZero(t, cmd.Timestamp)

	payload, ok := cmd.Payload.(CreateSessionCommand)
	require.True(t, ok)
	assert.Equal(t, "test-session", payload.Name)
	assert.Equal(t, "claude", payload.Agent)
}

func TestDeleteSessionBuilder(t *testing.T) {
	sessionID := "01HQJW5X7CT4HN3X5V4DKREZJ8"
	cmd, err := DeleteSession(sessionID, true).Build()
	require.NoError(t, err)

	assert.Equal(t, CmdDeleteSession, cmd.Type)

	payload, ok := cmd.Payload.(DeleteSessionCommand)
	require.True(t, ok)
	assert.Equal(t, sessionID, payload.SessionID)
	assert.True(t, payload.Force)
}

func TestUpdateSessionBuilder(t *testing.T) {
	sessionID := "01HQJW5X7CT4HN3X5V4DKREZJ8"
	updates := map[string]interface{}{
		"name":   "updated-name",
		"status": StatusWorking,
	}

	cmd, err := UpdateSession(sessionID, updates).Build()
	require.NoError(t, err)

	assert.Equal(t, CmdUpdateSession, cmd.Type)

	payload, ok := cmd.Payload.(UpdateSessionCommand)
	require.True(t, ok)
	assert.Equal(t, sessionID, payload.SessionID)
	assert.Equal(t, updates, payload.Updates)
}

func TestSetFocusBuilder(t *testing.T) {
	sessionID := "01HQJW5X7CT4HN3X5V4DKREZJ8"
	cmd, err := SetFocus(sessionID).Build()
	require.NoError(t, err)

	assert.Equal(t, CmdSetFocus, cmd.Type)

	payload, ok := cmd.Payload.(SetFocusCommand)
	require.True(t, ok)
	assert.Equal(t, sessionID, payload.SessionID)
}

func TestStartAgentBuilder(t *testing.T) {
	sessionID := "01HQJW5X7CT4HN3X5V4DKREZJ8"
	cmd, err := StartAgent(sessionID).Build()
	require.NoError(t, err)

	assert.Equal(t, CmdStartAgent, cmd.Type)

	payload, ok := cmd.Payload.(StartAgentCommand)
	require.True(t, ok)
	assert.Equal(t, sessionID, payload.SessionID)
}

func TestStopAgentBuilder(t *testing.T) {
	sessionID := "01HQJW5X7CT4HN3X5V4DKREZJ8"
	cmd, err := StopAgent(sessionID, true).Build()
	require.NoError(t, err)

	assert.Equal(t, CmdStopAgent, cmd.Type)

	payload, ok := cmd.Payload.(StopAgentCommand)
	require.True(t, ok)
	assert.Equal(t, sessionID, payload.SessionID)
	assert.True(t, payload.Graceful)
}

func TestRestartAgentBuilder(t *testing.T) {
	sessionID := "01HQJW5X7CT4HN3X5V4DKREZJ8"
	cmd, err := RestartAgent(sessionID).Build()
	require.NoError(t, err)

	assert.Equal(t, CmdRestartAgent, cmd.Type)

	payload, ok := cmd.Payload.(RestartAgentCommand)
	require.True(t, ok)
	assert.Equal(t, sessionID, payload.SessionID)
}

func TestShutdownBuilder(t *testing.T) {
	cmd, err := Shutdown().Build()
	require.NoError(t, err)

	assert.Equal(t, CmdShutdown, cmd.Type)
	assert.Equal(t, struct{}{}, cmd.Payload)
}

func TestHealthCheckBuilder(t *testing.T) {
	cmd, err := HealthCheck(true).Build()
	require.NoError(t, err)

	assert.Equal(t, CmdHealthCheck, cmd.Type)

	payload, ok := cmd.Payload.(HealthCheckCommand)
	require.True(t, ok)
	assert.True(t, payload.IncludeDetails)
}

func TestToggleMinimalBuilder(t *testing.T) {
	cmd, err := ToggleMinimal().Build()
	require.NoError(t, err)

	assert.Equal(t, CmdToggleMinimal, cmd.Type)
	assert.Equal(t, struct{}{}, cmd.Payload)
}

func TestSetPreferenceBuilder(t *testing.T) {
	cmd, err := SetPreference("theme", "dark").Build()
	require.NoError(t, err)

	assert.Equal(t, CmdSetPreference, cmd.Type)

	payload, ok := cmd.Payload.(SetPreferenceCommand)
	require.True(t, ok)
	assert.Equal(t, "theme", payload.Key)
	assert.Equal(t, "dark", payload.Value)
}

func TestBuilderValidation(t *testing.T) {
	// Test that builder validates the command
	_, err := CreateSession("", "claude").Build()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "name cannot be empty")

	_, err = CreateSession("valid-name", "").Build()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "agent cannot be empty")

	_, err = CreateSession("valid-name", "unknown-agent").Build()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported agent")
}