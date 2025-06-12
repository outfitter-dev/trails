package protocol

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestValidateCommand(t *testing.T) {
	tests := []struct {
		name    string
		command Command
		wantErr bool
		errMsg  string
	}{
		{
			name: "valid create session command",
			command: Command{
				ID:        "01234567890123456789012345",
				Type:      CmdCreateSession,
				Timestamp: time.Now(),
				Payload: CreateSessionCommand{
					Name:  "test-session",
					Agent: "claude",
				},
			},
			wantErr: false,
		},
		{
			name: "missing command ID",
			command: Command{
				Type:      CmdCreateSession,
				Timestamp: time.Now(),
				Payload: CreateSessionCommand{
					Name:  "test",
					Agent: "claude",
				},
			},
			wantErr: true,
			errMsg:  "missing command ID",
		},
		{
			name: "missing command type",
			command: Command{
				ID:        "01234567890123456789012345",
				Timestamp: time.Now(),
			},
			wantErr: true,
			errMsg:  "missing command type",
		},
		{
			name: "missing timestamp",
			command: Command{
				ID:   "01234567890123456789012345",
				Type: CmdCreateSession,
			},
			wantErr: true,
			errMsg:  "missing timestamp",
		},
		{
			name: "unknown command type",
			command: Command{
				ID:        "01234567890123456789012345",
				Type:      "unknown.command",
				Timestamp: time.Now(),
			},
			wantErr: true,
			errMsg:  "unknown command type",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateCommand(tt.command)
			if tt.wantErr {
				assert.Error(t, err)
				if tt.errMsg != "" {
					assert.Contains(t, err.Error(), tt.errMsg)
				}
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestValidateCreateSession(t *testing.T) {
	tests := []struct {
		name    string
		payload interface{}
		wantErr bool
		errMsg  string
	}{
		{
			name: "valid payload",
			payload: CreateSessionCommand{
				Name:  "test-session",
				Agent: "claude",
			},
			wantErr: false,
		},
		{
			name: "empty name",
			payload: CreateSessionCommand{
				Name:  "",
				Agent: "claude",
			},
			wantErr: true,
			errMsg:  "name cannot be empty",
		},
		{
			name: "name too long",
			payload: CreateSessionCommand{
				Name:  "this-is-a-very-long-session-name-that-exceeds-fifty-characters",
				Agent: "claude",
			},
			wantErr: true,
			errMsg:  "name too long",
		},
		{
			name: "invalid characters in name",
			payload: CreateSessionCommand{
				Name:  "test@session!",
				Agent: "claude",
			},
			wantErr: true,
			errMsg:  "name contains invalid characters",
		},
		{
			name: "empty agent",
			payload: CreateSessionCommand{
				Name:  "test-session",
				Agent: "",
			},
			wantErr: true,
			errMsg:  "agent cannot be empty",
		},
		{
			name: "unsupported agent",
			payload: CreateSessionCommand{
				Name:  "test-session",
				Agent: "unknown-agent",
			},
			wantErr: true,
			errMsg:  "unsupported agent",
		},
		{
			name:    "wrong payload type",
			payload: "not a command",
			wantErr: true,
			errMsg:  "expected CreateSessionCommand",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateCreateSession(tt.payload)
			if tt.wantErr {
				assert.Error(t, err)
				if tt.errMsg != "" {
					assert.Contains(t, err.Error(), tt.errMsg)
				}
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestValidateDeleteSession(t *testing.T) {
	tests := []struct {
		name    string
		payload interface{}
		wantErr bool
		errMsg  string
	}{
		{
			name: "valid payload",
			payload: DeleteSessionCommand{
				SessionID: "01HQJW5X7CT4HN3X5V4DKREZJ8",
				Force:     false,
			},
			wantErr: false,
		},
		{
			name: "empty session ID",
			payload: DeleteSessionCommand{
				SessionID: "",
				Force:     false,
			},
			wantErr: true,
			errMsg:  "session ID cannot be empty",
		},
		{
			name: "invalid ULID format",
			payload: DeleteSessionCommand{
				SessionID: "not-a-ulid",
				Force:     false,
			},
			wantErr: true,
			errMsg:  "invalid ULID format",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateDeleteSession(tt.payload)
			if tt.wantErr {
				assert.Error(t, err)
				if tt.errMsg != "" {
					assert.Contains(t, err.Error(), tt.errMsg)
				}
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestIsValidSessionName(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  bool
	}{
		{"alphanumeric", "test123", true},
		{"with spaces", "test session", true},
		{"with hyphens", "test-session", true},
		{"with underscores", "test_session", true},
		{"mixed case", "TestSession123", true},
		{"special chars", "test@session", false},
		{"exclamation", "test!", false},
		{"parentheses", "test(session)", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isValidSessionName(tt.input)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestIsValidAgent(t *testing.T) {
	tests := []struct {
		agent string
		want  bool
	}{
		{"claude", true},
		{"gpt-4", true},
		{"custom", true},
		{"unknown", false},
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.agent, func(t *testing.T) {
			got := isValidAgent(tt.agent)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestIsValidULID(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  bool
	}{
		{"valid ULID", "01HQJW5X7CT4HN3X5V4DKREZJ8", true},
		{"too short", "01HQJW5X7CT4HN3X5V4DKREZ", false},
		{"too long", "01HQJW5X7CT4HN3X5V4DKREZJ8X", false},
		{"lowercase", "01hqjw5x7ct4hn3x5v4dkrezj8", false},
		{"invalid chars", "01HQJW5X7CT4HN3X5V4DKREZJ&", false},
		{"empty", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isValidULID(tt.input)
			assert.Equal(t, tt.want, got)
		})
	}
}