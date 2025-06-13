package protocol

import (
	"errors"
	"fmt"
	"strings"
)

// Validation errors
var (
	ErrInvalidCommand     = errors.New("invalid command")
	ErrMissingPayload     = errors.New("missing command payload")
	ErrInvalidPayload     = errors.New("invalid command payload")
	ErrUnknownCommandType = errors.New("unknown command type")
	ErrInvalidSessionID   = errors.New("invalid session ID")
	ErrInvalidSessionName = errors.New("invalid session name")
	ErrInvalidAgent       = errors.New("invalid agent")
)

// ValidateCommand validates a command and its payload
func ValidateCommand(cmd Command) error {
	if cmd.ID == "" {
		return fmt.Errorf("%w: missing command ID", ErrInvalidCommand)
	}

	if cmd.Type == "" {
		return fmt.Errorf("%w: missing command type", ErrInvalidCommand)
	}

	if cmd.Timestamp.IsZero() {
		return fmt.Errorf("%w: missing timestamp", ErrInvalidCommand)
	}

	// Validate payload based on command type
	switch cmd.Type {
	case CmdCreateSession:
		return validateCreateSession(cmd.Payload)
	case CmdDeleteSession:
		return validateDeleteSession(cmd.Payload)
	case CmdUpdateSession:
		return validateUpdateSession(cmd.Payload)
	case CmdSetFocus:
		return validateSetFocus(cmd.Payload)
	case CmdStartAgent:
		return validateStartAgent(cmd.Payload)
	case CmdStopAgent:
		return validateStopAgent(cmd.Payload)
	case CmdRestartAgent:
		return validateRestartAgent(cmd.Payload)
	case CmdListSessions, CmdToggleMinimal, CmdNextActionable, CmdShutdown:
		// These commands don't require payload validation
		return nil
	case CmdSetPreference:
		return validateSetPreference(cmd.Payload)
	case CmdHealthCheck:
		// Health check payload is optional
		return nil
	default:
		return fmt.Errorf("%w: %s", ErrUnknownCommandType, cmd.Type)
	}
}

func validateCreateSession(payload interface{}) error {
	cmd, ok := payload.(CreateSessionCommand)
	if !ok {
		return fmt.Errorf("%w: expected CreateSessionCommand", ErrInvalidPayload)
	}

	if cmd.Name == "" {
		return fmt.Errorf("%w: name cannot be empty", ErrInvalidSessionName)
	}

	if len(cmd.Name) > MaxSessionNameLength {
		return fmt.Errorf("%w: name too long (max %d chars)", ErrInvalidSessionName, MaxSessionNameLength)
	}

	if !isValidSessionName(cmd.Name) {
		return fmt.Errorf("%w: name contains invalid characters", ErrInvalidSessionName)
	}

	if cmd.Agent == "" {
		return fmt.Errorf("%w: agent cannot be empty", ErrInvalidAgent)
	}

	if !isValidAgent(cmd.Agent) {
		return fmt.Errorf("%w: unsupported agent: %s", ErrInvalidAgent, cmd.Agent)
	}

	// Validate environment variables if provided
	if cmd.Environment != nil {
		for key, value := range cmd.Environment {
			if key == "" {
				return fmt.Errorf("%w: environment key cannot be empty", ErrInvalidPayload)
			}
			if len(key) > 100 {
				return fmt.Errorf("%w: environment key too long", ErrInvalidPayload)
			}
			if len(value) > 1000 {
				return fmt.Errorf("%w: environment value too long", ErrInvalidPayload)
			}
		}
	}

	return nil
}

func validateDeleteSession(payload interface{}) error {
	cmd, ok := payload.(DeleteSessionCommand)
	if !ok {
		return fmt.Errorf("%w: expected DeleteSessionCommand", ErrInvalidPayload)
	}

	if cmd.SessionID == "" {
		return fmt.Errorf("%w: session ID cannot be empty", ErrInvalidSessionID)
	}

	if !isValidULID(cmd.SessionID) {
		return fmt.Errorf("%w: invalid ULID format", ErrInvalidSessionID)
	}

	return nil
}

func validateUpdateSession(payload interface{}) error {
	cmd, ok := payload.(UpdateSessionCommand)
	if !ok {
		return fmt.Errorf("%w: expected UpdateSessionCommand", ErrInvalidPayload)
	}

	if cmd.SessionID == "" {
		return fmt.Errorf("%w: session ID cannot be empty", ErrInvalidSessionID)
	}

	if !isValidULID(cmd.SessionID) {
		return fmt.Errorf("%w: invalid ULID format", ErrInvalidSessionID)
	}

	if len(cmd.Updates) == 0 {
		return fmt.Errorf("%w: no updates provided", ErrInvalidPayload)
	}

	return nil
}

func validateSetFocus(payload interface{}) error {
	cmd, ok := payload.(SetFocusCommand)
	if !ok {
		return fmt.Errorf("%w: expected SetFocusCommand", ErrInvalidPayload)
	}

	if cmd.SessionID == "" {
		return fmt.Errorf("%w: session ID cannot be empty", ErrInvalidSessionID)
	}

	if !isValidULID(cmd.SessionID) {
		return fmt.Errorf("%w: invalid ULID format", ErrInvalidSessionID)
	}

	return nil
}

func validateStartAgent(payload interface{}) error {
	cmd, ok := payload.(StartAgentCommand)
	if !ok {
		return fmt.Errorf("%w: expected StartAgentCommand", ErrInvalidPayload)
	}

	if cmd.SessionID == "" {
		return fmt.Errorf("%w: session ID cannot be empty", ErrInvalidSessionID)
	}

	if !isValidULID(cmd.SessionID) {
		return fmt.Errorf("%w: invalid ULID format", ErrInvalidSessionID)
	}

	return nil
}

func validateStopAgent(payload interface{}) error {
	cmd, ok := payload.(StopAgentCommand)
	if !ok {
		return fmt.Errorf("%w: expected StopAgentCommand", ErrInvalidPayload)
	}

	if cmd.SessionID == "" {
		return fmt.Errorf("%w: session ID cannot be empty", ErrInvalidSessionID)
	}

	if !isValidULID(cmd.SessionID) {
		return fmt.Errorf("%w: invalid ULID format", ErrInvalidSessionID)
	}

	return nil
}

func validateRestartAgent(payload interface{}) error {
	cmd, ok := payload.(RestartAgentCommand)
	if !ok {
		return fmt.Errorf("%w: expected RestartAgentCommand", ErrInvalidPayload)
	}

	if cmd.SessionID == "" {
		return fmt.Errorf("%w: session ID cannot be empty", ErrInvalidSessionID)
	}

	if !isValidULID(cmd.SessionID) {
		return fmt.Errorf("%w: invalid ULID format", ErrInvalidSessionID)
	}

	return nil
}

func validateSetPreference(payload interface{}) error {
	cmd, ok := payload.(SetPreferenceCommand)
	if !ok {
		return fmt.Errorf("%w: expected SetPreferenceCommand", ErrInvalidPayload)
	}

	if cmd.Key == "" {
		return fmt.Errorf("%w: preference key cannot be empty", ErrInvalidPayload)
	}

	return nil
}

// Helper functions

// Performance optimizations:
// The validation functions below use pre-computed lookup tables
// instead of string operations for better performance.
// This is especially important for ULID validation which happens frequently.

// sessionNameCharLookup is a lookup table for valid session name characters
var sessionNameCharLookup = func() [256]bool {
	var lookup [256]bool
	// Add lowercase letters
	for c := 'a'; c <= 'z'; c++ {
		lookup[c] = true
	}
	// Add uppercase letters
	for c := 'A'; c <= 'Z'; c++ {
		lookup[c] = true
	}
	// Add digits
	for c := '0'; c <= '9'; c++ {
		lookup[c] = true
	}
	// Add special allowed characters
	lookup[' '] = true
	lookup['-'] = true
	lookup['_'] = true
	return lookup
}()

func isValidSessionName(name string) bool {
	// Allow alphanumeric, spaces, hyphens, underscores
	// Using lookup table for better performance
	for i := 0; i < len(name); i++ {
		c := name[i]
		if c >= 128 || !sessionNameCharLookup[c] {
			return false
		}
	}
	return true
}

func isValidAgent(agent string) bool {
	for _, supported := range SupportedAgents {
		if agent == supported {
			return true
		}
	}
	return false
}

// ulidCharLookup is a lookup table for valid ULID characters
// This is faster than strings.ContainsRune for repeated lookups
var ulidCharLookup = func() [256]bool {
	var lookup [256]bool
	for _, c := range ULIDCharset {
		lookup[c] = true
		// Also mark lowercase as valid
		if c >= 'A' && c <= 'Z' {
			lookup[c+32] = true // lowercase version
		}
	}
	return lookup
}()

func isValidULID(id string) bool {
	// Basic ULID validation
	if len(id) != ULIDLength {
		return false
	}

	// Fast validation using lookup table
	// This avoids uppercase conversion and string search
	for i := 0; i < len(id); i++ {
		c := id[i]
		if c >= 128 || !ulidCharLookup[c] {
			return false
		}
	}

	return true
}