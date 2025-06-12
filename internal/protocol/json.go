package protocol

import (
	"encoding/json"
	"fmt"
	"reflect"
)

// commandPayloadRegistry maps command types to their payload types
var commandPayloadRegistry = map[CommandType]reflect.Type{
	CmdCreateSession:    reflect.TypeOf(CreateSessionCommand{}),
	CmdDeleteSession:    reflect.TypeOf(DeleteSessionCommand{}),
	CmdUpdateSession:    reflect.TypeOf(UpdateSessionCommand{}),
	CmdListSessions:     reflect.TypeOf(ListSessionsCommand{}),
	CmdSetFocus:         reflect.TypeOf(SetFocusCommand{}),
	CmdStartAgent:       reflect.TypeOf(StartAgentCommand{}),
	CmdStopAgent:        reflect.TypeOf(StopAgentCommand{}),
	CmdRestartAgent:     reflect.TypeOf(RestartAgentCommand{}),
	CmdSetPreference:    reflect.TypeOf(SetPreferenceCommand{}),
	CmdHealthCheck:      reflect.TypeOf(HealthCheckCommand{}),
	CmdToggleMinimal:    nil, // No payload
	CmdNextActionable:   nil, // No payload
	CmdShutdown:         nil, // No payload
}

// eventPayloadRegistry maps event types to their payload types
var eventPayloadRegistry = map[EventType]reflect.Type{
	EventSessionCreated:   reflect.TypeOf(SessionCreatedEvent{}),
	EventSessionDeleted:   reflect.TypeOf(SessionDeletedEvent{}),
	EventSessionUpdated:   reflect.TypeOf(SessionUpdatedEvent{}),
	EventSessionList:      reflect.TypeOf(SessionListEvent{}),
	EventStatusChanged:    reflect.TypeOf(StatusChangedEvent{}),
	EventProgressUpdate:   reflect.TypeOf(ProgressUpdateEvent{}),
	EventEnvironmentReady: reflect.TypeOf(EnvironmentReadyEvent{}),
	EventEnvironmentError: reflect.TypeOf(EnvironmentErrorEvent{}),
	EventError:            reflect.TypeOf(ErrorEvent{}),
	EventWarning:          reflect.TypeOf(WarningEvent{}),
	EventInfo:             reflect.TypeOf(InfoEvent{}),
	EventStateSnapshot:    reflect.TypeOf(StateSnapshotEvent{}),
	EventHealthStatus:     reflect.TypeOf(HealthStatusEvent{}),
}

// MarshalCommand marshals a command to JSON
func MarshalCommand(cmd Command) ([]byte, error) {
	return json.Marshal(cmd)
}

// UnmarshalCommand unmarshals JSON to a command with proper payload type
func UnmarshalCommand(data []byte) (Command, error) {
	// First, unmarshal to get the type
	var raw struct {
		ID        string          `json:"id"`
		Type      CommandType     `json:"type"`
		Timestamp json.RawMessage `json:"timestamp"`
		Payload   json.RawMessage `json:"payload"`
	}
	
	if err := json.Unmarshal(data, &raw); err != nil {
		return Command{}, fmt.Errorf("unmarshal command envelope: %w", err)
	}
	
	cmd := Command{
		ID:   raw.ID,
		Type: raw.Type,
	}
	
	// Unmarshal timestamp
	if err := json.Unmarshal(raw.Timestamp, &cmd.Timestamp); err != nil {
		return Command{}, fmt.Errorf("unmarshal timestamp: %w", err)
	}
	
	// Get the payload type
	payloadType, exists := commandPayloadRegistry[raw.Type]
	if !exists {
		return Command{}, fmt.Errorf("unknown command type: %s", raw.Type)
	}
	
	// Handle commands with no payload
	if payloadType == nil {
		cmd.Payload = nil
		return cmd, nil
	}
	
	// Create new instance of the payload type
	payloadPtr := reflect.New(payloadType)
	
	// Unmarshal payload
	if len(raw.Payload) > 0 && string(raw.Payload) != "null" {
		if err := json.Unmarshal(raw.Payload, payloadPtr.Interface()); err != nil {
			return Command{}, fmt.Errorf("unmarshal payload for %s: %w", raw.Type, err)
		}
		cmd.Payload = payloadPtr.Elem().Interface()
	}
	
	return cmd, nil
}

// MarshalEvent marshals an event to JSON
func MarshalEvent(event Event) ([]byte, error) {
	return json.Marshal(event)
}

// UnmarshalEvent unmarshals JSON to an event with proper payload type
func UnmarshalEvent(data []byte) (Event, error) {
	// First, unmarshal to get the type
	var raw struct {
		ID        string          `json:"id"`
		CommandID string          `json:"command_id,omitempty"`
		Type      EventType       `json:"type"`
		Timestamp json.RawMessage `json:"timestamp"`
		Payload   json.RawMessage `json:"payload"`
	}
	
	if err := json.Unmarshal(data, &raw); err != nil {
		return Event{}, fmt.Errorf("unmarshal event envelope: %w", err)
	}
	
	event := Event{
		ID:        raw.ID,
		CommandID: raw.CommandID,
		Type:      raw.Type,
	}
	
	// Unmarshal timestamp
	if err := json.Unmarshal(raw.Timestamp, &event.Timestamp); err != nil {
		return Event{}, fmt.Errorf("unmarshal timestamp: %w", err)
	}
	
	// Get the payload type
	payloadType, exists := eventPayloadRegistry[raw.Type]
	if !exists {
		return Event{}, fmt.Errorf("unknown event type: %s", raw.Type)
	}
	
	// Create new instance of the payload type
	payloadPtr := reflect.New(payloadType)
	
	// Unmarshal payload
	if len(raw.Payload) > 0 && string(raw.Payload) != "null" {
		if err := json.Unmarshal(raw.Payload, payloadPtr.Interface()); err != nil {
			return Event{}, fmt.Errorf("unmarshal payload for %s: %w", raw.Type, err)
		}
		event.Payload = payloadPtr.Elem().Interface()
	}
	
	return event, nil
}

// MarshalEnhancedEvent marshals an enhanced event to JSON
func MarshalEnhancedEvent(event EnhancedEvent) ([]byte, error) {
	return json.Marshal(event)
}

// UnmarshalEnhancedEvent unmarshals JSON to an enhanced event with proper payload type
func UnmarshalEnhancedEvent(data []byte) (EnhancedEvent, error) {
	// First, unmarshal to get the type
	var raw struct {
		Metadata EventMetadata   `json:"metadata"`
		Type     EventType       `json:"type"`
		Payload  json.RawMessage `json:"payload"`
	}
	
	if err := json.Unmarshal(data, &raw); err != nil {
		return EnhancedEvent{}, fmt.Errorf("unmarshal enhanced event envelope: %w", err)
	}
	
	event := EnhancedEvent{
		Metadata: raw.Metadata,
		Type:     raw.Type,
	}
	
	// Get the payload type
	payloadType, exists := eventPayloadRegistry[raw.Type]
	if !exists {
		return EnhancedEvent{}, fmt.Errorf("unknown event type: %s", raw.Type)
	}
	
	// Create new instance of the payload type
	payloadPtr := reflect.New(payloadType)
	
	// Unmarshal payload
	if len(raw.Payload) > 0 && string(raw.Payload) != "null" {
		if err := json.Unmarshal(raw.Payload, payloadPtr.Interface()); err != nil {
			return EnhancedEvent{}, fmt.Errorf("unmarshal payload for %s: %w", raw.Type, err)
		}
		event.Payload = payloadPtr.Elem().Interface()
	}
	
	return event, nil
}