package protocol

// CommandBuilder provides a fluent interface for building commands
type CommandBuilder struct {
	command Command
}

// NewCommandBuilder creates a new command builder
func NewCommandBuilder(cmdType CommandType) *CommandBuilder {
	return &CommandBuilder{
		command: NewCommand(cmdType, nil),
	}
}

// WithPayload sets the command payload
func (b *CommandBuilder) WithPayload(payload interface{}) *CommandBuilder {
	b.command.Payload = payload
	return b
}

// Build validates and returns the command
func (b *CommandBuilder) Build() (Command, error) {
	if err := ValidateCommand(b.command); err != nil {
		return Command{}, err
	}
	return b.command, nil
}

// Session command builders

// CreateSession builds a create session command
func CreateSession(name, agent string) *CommandBuilder {
	return NewCommandBuilder(CmdCreateSession).
		WithPayload(CreateSessionCommand{
			Name:  name,
			Agent: agent,
		})
}

// DeleteSession builds a delete session command
func DeleteSession(sessionID string, force bool) *CommandBuilder {
	return NewCommandBuilder(CmdDeleteSession).
		WithPayload(DeleteSessionCommand{
			SessionID: sessionID,
			Force:     force,
		})
}

// UpdateSession builds an update session command
func UpdateSession(sessionID string, updates map[string]interface{}) *CommandBuilder {
	return NewCommandBuilder(CmdUpdateSession).
		WithPayload(UpdateSessionCommand{
			SessionID: sessionID,
			Updates:   updates,
		})
}

// SetFocus builds a set focus command
func SetFocus(sessionID string) *CommandBuilder {
	return NewCommandBuilder(CmdSetFocus).
		WithPayload(SetFocusCommand{
			SessionID: sessionID,
		})
}

// Agent command builders

// StartAgent builds a start agent command
func StartAgent(sessionID string) *CommandBuilder {
	return NewCommandBuilder(CmdStartAgent).
		WithPayload(StartAgentCommand{
			SessionID: sessionID,
		})
}

// StopAgent builds a stop agent command
func StopAgent(sessionID string, graceful bool) *CommandBuilder {
	return NewCommandBuilder(CmdStopAgent).
		WithPayload(StopAgentCommand{
			SessionID: sessionID,
			Graceful:  graceful,
		})
}

// RestartAgent builds a restart agent command
func RestartAgent(sessionID string) *CommandBuilder {
	return NewCommandBuilder(CmdRestartAgent).
		WithPayload(RestartAgentCommand{
			SessionID: sessionID,
		})
}

// System command builders

// Shutdown builds a shutdown command
func Shutdown() *CommandBuilder {
	return NewCommandBuilder(CmdShutdown)
}

// HealthCheck builds a health check command
func HealthCheck(includeDetails bool) *CommandBuilder {
	return NewCommandBuilder(CmdHealthCheck).
		WithPayload(HealthCheckCommand{
			IncludeDetails: includeDetails,
		})
}

// UI command builders

// ToggleMinimal builds a toggle minimal mode command
func ToggleMinimal() *CommandBuilder {
	return NewCommandBuilder(CmdToggleMinimal)
}

// SetPreference builds a set preference command
func SetPreference(key string, value interface{}) *CommandBuilder {
	return NewCommandBuilder(CmdSetPreference).
		WithPayload(SetPreferenceCommand{
			Key:   key,
			Value: value,
		})
}