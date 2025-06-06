package session

import (
	"testing"
	"time"
)

func TestNewSession(t *testing.T) {
	name := "test-session"
	agent := "codex"

	session := NewSession(name, agent)

	if session.Name != name {
		t.Errorf("Expected name %s, got %s", name, session.Name)
	}

	if session.Agent != agent {
		t.Errorf("Expected agent %s, got %s", agent, session.Agent)
	}

	if session.Status != StatusReady {
		t.Errorf("Expected status %v, got %v", StatusReady, session.Status)
	}

	if session.ID == "" {
		t.Error("Expected non-empty ID")
	}

	if session.Environment == nil {
		t.Error("Expected non-nil Environment map")
	}
}

func TestSessionUpdateStatus(t *testing.T) {
	session := NewSession("test", "codex")
	originalTime := session.LastActivity

	// Wait a bit to ensure time difference
	time.Sleep(1 * time.Millisecond)

	session.UpdateStatus(StatusWorking)

	if session.Status != StatusWorking {
		t.Errorf("Expected status %v, got %v", StatusWorking, session.Status)
	}

	if !session.LastActivity.After(originalTime) {
		t.Error("Expected LastActivity to be updated")
	}
}

func TestSessionGetDisplayName(t *testing.T) {
	tests := []struct {
		name     string
		agent    string
		expected string
	}{
		{"custom-name", "codex", "custom-name"},
		{"", "codex", "codex"},
		{"", "aider", "aider"},
	}

	for _, tt := range tests {
		session := NewSession(tt.name, tt.agent)
		if got := session.GetDisplayName(); got != tt.expected {
			t.Errorf("GetDisplayName() = %v, want %v", got, tt.expected)
		}
	}
}

func TestSessionIsActionable(t *testing.T) {
	tests := []struct {
		status   Status
		expected bool
	}{
		{StatusReady, true},
		{StatusError, true},
		{StatusWorking, false},
		{StatusWaiting, false},
		{StatusThinking, false},
	}

	for _, tt := range tests {
		session := NewSession("test", "codex")
		session.Status = tt.status
		if got := session.IsActionable(); got != tt.expected {
			t.Errorf("IsActionable() with status %v = %v, want %v", tt.status, got, tt.expected)
		}
	}
}

func TestStatusString(t *testing.T) {
	tests := []struct {
		status   Status
		expected string
	}{
		{StatusReady, "ready"},
		{StatusWorking, "working"},
		{StatusWaiting, "waiting"},
		{StatusError, "error"},
		{StatusThinking, "thinking"},
	}

	for _, tt := range tests {
		if got := tt.status.String(); got != tt.expected {
			t.Errorf("Status.String() = %v, want %v", got, tt.expected)
		}
	}
}
