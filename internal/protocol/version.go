package protocol

import (
	"errors"
	"fmt"

	"github.com/Masterminds/semver/v3"
)

// CurrentVersion is the current protocol version
var CurrentVersion = semver.MustParse("1.0.0")

// MinSupportedVersion is the minimum supported protocol version
var MinSupportedVersion = semver.MustParse("1.0.0")

// ProtocolVersion represents version information
type ProtocolVersion struct {
	Version      *semver.Version `json:"version"`
	MinSupported *semver.Version `json:"min_supported"`
}

// CapabilityRequest for capability discovery
type CapabilityRequest struct {
	ClientVersion *semver.Version `json:"client_version"`
}

// CapabilityResponse describes server capabilities
type CapabilityResponse struct {
	ServerVersion    *semver.Version  `json:"server_version"`
	MinClientVersion *semver.Version  `json:"min_client_version"`
	Commands         []CommandInfo    `json:"commands"`
	Events           []EventCapability `json:"events"`
	Extensions       []ExtensionInfo  `json:"extensions"`
	Features         map[string]bool  `json:"features"`
}

// CommandInfo describes a supported command
type CommandInfo struct {
	Type        CommandType `json:"type"`
	Description string      `json:"description"`
	Schema      interface{} `json:"schema"`
	Since       string      `json:"since"`
	Deprecated  bool        `json:"deprecated"`
}

// EventCapability describes a supported event
type EventCapability struct {
	Type        EventType `json:"type"`
	Description string    `json:"description"`
	Schema      interface{} `json:"schema"`
	Since       string    `json:"since"`
	Deprecated  bool       `json:"deprecated"`
}

// ExtensionInfo describes optional protocol extensions
type ExtensionInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Version     string `json:"version"`
	Enabled     bool   `json:"enabled"`
}

// NegotiateVersion finds compatible protocol version
func NegotiateVersion(client, server *semver.Version) (*semver.Version, error) {
	if client == nil || server == nil {
		return nil, errors.New("version cannot be nil")
	}

	// Check if client version is supported
	if client.LessThan(MinSupportedVersion) {
		return nil, fmt.Errorf("client version %s is too old, minimum supported is %s", 
			client, MinSupportedVersion)
	}

	// Use the lower of client/server versions for compatibility
	if client.LessThan(server) {
		return client, nil
	}
	return server, nil
}

// GetCapabilities returns current server capabilities
func GetCapabilities() CapabilityResponse {
	return CapabilityResponse{
		ServerVersion:    CurrentVersion,
		MinClientVersion: MinSupportedVersion,
		Commands:         getAllCommandInfo(),
		Events:           getAllEventInfo(),
		Extensions:       getExtensions(),
		Features: map[string]bool{
			"authentication":   true,
			"rate_limiting":    true,
			"audit_logging":    true,
			"event_metadata":   true,
			"batch_commands":   false,
			"compression":      false,
			"encryption":       true,
		},
	}
}

func getAllCommandInfo() []CommandInfo {
	return []CommandInfo{
		{Type: CmdCreateSession, Description: "Create a new agent session", Since: "1.0.0"},
		{Type: CmdDeleteSession, Description: "Delete an existing session", Since: "1.0.0"},
		{Type: CmdUpdateSession, Description: "Update session properties", Since: "1.0.0"},
		{Type: CmdListSessions, Description: "List all sessions", Since: "1.0.0"},
		{Type: CmdStartAgent, Description: "Start an agent in a session", Since: "1.0.0"},
		{Type: CmdStopAgent, Description: "Stop a running agent", Since: "1.0.0"},
		{Type: CmdRestartAgent, Description: "Restart an agent", Since: "1.0.0"},
		{Type: CmdSetFocus, Description: "Set UI focus to a session", Since: "1.0.0"},
		{Type: CmdNextActionable, Description: "Navigate to next actionable session", Since: "1.0.0"},
		{Type: CmdToggleMinimal, Description: "Toggle minimal UI mode", Since: "1.0.0"},
		{Type: CmdSetPreference, Description: "Set a UI preference", Since: "1.0.0"},
		{Type: CmdShutdown, Description: "Shutdown the system", Since: "1.0.0"},
		{Type: CmdHealthCheck, Description: "Check system health", Since: "1.0.0"},
	}
}

func getAllEventInfo() []EventCapability {
	return []EventCapability{
		{Type: EventSessionCreated, Description: "Session was created", Since: "1.0.0"},
		{Type: EventSessionDeleted, Description: "Session was deleted", Since: "1.0.0"},
		{Type: EventSessionUpdated, Description: "Session was updated", Since: "1.0.0"},
		{Type: EventSessionList, Description: "Session list response", Since: "1.0.0"},
		{Type: EventStatusChanged, Description: "Session status changed", Since: "1.0.0"},
		{Type: EventProgressUpdate, Description: "Progress update", Since: "1.0.0"},
		{Type: EventEnvironmentReady, Description: "Environment is ready", Since: "1.0.0"},
		{Type: EventEnvironmentError, Description: "Environment error occurred", Since: "1.0.0"},
		{Type: EventError, Description: "General error occurred", Since: "1.0.0"},
		{Type: EventWarning, Description: "Warning message", Since: "1.0.0"},
		{Type: EventInfo, Description: "Informational message", Since: "1.0.0"},
		{Type: EventStateSnapshot, Description: "Complete state snapshot", Since: "1.0.0"},
		{Type: EventHealthStatus, Description: "Health check response", Since: "1.0.0"},
	}
}

func getExtensions() []ExtensionInfo {
	return []ExtensionInfo{
		{
			Name:        "audit_trail",
			Description: "Comprehensive audit logging",
			Version:     "1.0.0",
			Enabled:     true,
		},
		{
			Name:        "rate_limiting",
			Description: "Per-session rate limiting",
			Version:     "1.0.0",
			Enabled:     true,
		},
	}
}