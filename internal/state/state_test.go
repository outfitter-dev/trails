package state

import (
	"testing"

	"github.com/maybe-good/agentish/internal/session"
)

func TestNewState(t *testing.T) {
	repoPath := "/test/repo"
	state := NewState(repoPath)

	if state.RepoPath != repoPath {
		t.Errorf("Expected RepoPath %s, got %s", repoPath, state.RepoPath)
	}

	if state.Sessions == nil {
		t.Error("Expected non-nil Sessions map")
	}

	if len(state.Sessions) != 0 {
		t.Errorf("Expected empty Sessions map, got %d items", len(state.Sessions))
	}

	if state.MinimalMode != false {
		t.Error("Expected MinimalMode to be false")
	}

	if state.SessionOrder == nil {
		t.Error("Expected non-nil SessionOrder slice")
	}
}

func TestAddSession(t *testing.T) {
	state := NewState("/test/repo")
	sess := session.NewSession("test", "claude")

	state.AddSession(sess)

	if len(state.Sessions) != 1 {
		t.Errorf("Expected 1 session, got %d", len(state.Sessions))
	}

	if state.Sessions[sess.ID] != sess {
		t.Error("Session not found in Sessions map")
	}

	if len(state.SessionOrder) != 1 {
		t.Errorf("Expected 1 session in order, got %d", len(state.SessionOrder))
	}

	if state.SessionOrder[0] != sess.ID {
		t.Error("Session ID not found in SessionOrder")
	}

	if state.FocusedSession != sess.ID {
		t.Error("Expected session to be focused")
	}

	if sess.Position != 0 {
		t.Errorf("Expected position 0, got %d", sess.Position)
	}
}

func TestRemoveSession(t *testing.T) {
	state := NewState("/test/repo")
	sess1 := session.NewSession("test1", "claude")
	sess2 := session.NewSession("test2", "aider")

	state.AddSession(sess1)
	state.AddSession(sess2)

	state.RemoveSession(sess1.ID)

	if len(state.Sessions) != 1 {
		t.Errorf("Expected 1 session after removal, got %d", len(state.Sessions))
	}

	if state.Sessions[sess1.ID] != nil {
		t.Error("Removed session still found in Sessions map")
	}

	if len(state.SessionOrder) != 1 {
		t.Errorf("Expected 1 session in order after removal, got %d", len(state.SessionOrder))
	}

	if state.FocusedSession != sess2.ID {
		t.Error("Expected remaining session to be focused")
	}
}

func TestMoveFocus(t *testing.T) {
	state := NewState("/test/repo")
	sess1 := session.NewSession("test1", "claude")
	sess2 := session.NewSession("test2", "aider")
	sess3 := session.NewSession("test3", "codex")

	state.AddSession(sess1)
	state.AddSession(sess2)
	state.AddSession(sess3)

	// Start focused on first session
	if state.FocusedSession != sess1.ID {
		t.Error("Expected first session to be focused initially")
	}

	// Move down
	state.MoveFocus(1)
	if state.FocusedSession != sess2.ID {
		t.Error("Expected second session to be focused after move down")
	}

	// Move down again
	state.MoveFocus(1)
	if state.FocusedSession != sess3.ID {
		t.Error("Expected third session to be focused after second move down")
	}

	// Move down should wrap to first
	state.MoveFocus(1)
	if state.FocusedSession != sess1.ID {
		t.Error("Expected to wrap to first session")
	}

	// Move up should wrap to last
	state.MoveFocus(-1)
	if state.FocusedSession != sess3.ID {
		t.Error("Expected to wrap to last session when moving up from first")
	}
}

func TestGetActionableSessions(t *testing.T) {
	state := NewState("/test/repo")

	sess1 := session.NewSession("ready", "claude")
	sess1.Status = session.StatusReady

	sess2 := session.NewSession("working", "aider")
	sess2.Status = session.StatusWorking

	sess3 := session.NewSession("error", "codex")
	sess3.Status = session.StatusError

	state.AddSession(sess1)
	state.AddSession(sess2)
	state.AddSession(sess3)

	actionable := state.GetActionableSessions()

	if len(actionable) != 2 {
		t.Errorf("Expected 2 actionable sessions, got %d", len(actionable))
	}

	// Check that only ready and error sessions are returned
	foundReady := false
	foundError := false
	for _, sess := range actionable {
		if sess.Status == session.StatusReady {
			foundReady = true
		}
		if sess.Status == session.StatusError {
			foundError = true
		}
		if sess.Status == session.StatusWorking {
			t.Error("Working session should not be actionable")
		}
	}

	if !foundReady {
		t.Error("Ready session should be actionable")
	}
	if !foundError {
		t.Error("Error session should be actionable")
	}
}
