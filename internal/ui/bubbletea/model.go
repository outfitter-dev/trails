package bubbletea

import (
	"context"
	"fmt"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/outfitter-dev/trails/internal/config"
	"github.com/outfitter-dev/trails/internal/logging"
	"github.com/outfitter-dev/trails/internal/protocol"
)

// Model represents the main BubbleTea model
type Model struct {
	// Context and channels
	ctx           context.Context
	commandSender chan<- protocol.Command
	eventReceiver <-chan protocol.EnhancedEvent
	
	// Configuration
	config  *config.Config
	logger  *logging.Logger
	
	// UI State
	sessions     []SessionInfo
	focusIndex   int
	minimalMode  bool
	width        int
	height       int
	
	// Internal state
	ready        bool
	quitting     bool
	err          error
}

// SessionInfo holds UI-specific session information
type SessionInfo struct {
	ID            string
	Name          string
	Agent         string
	Status        protocol.SessionStatus
	Branch        string
	EnvironmentID string
	UpdatedAt     time.Time
}

// New creates a new BubbleTea model
func New(ctx context.Context, cfg *config.Config, logger *logging.Logger, commandSender chan<- protocol.Command, eventReceiver <-chan protocol.EnhancedEvent) *Model {
	return &Model{
		ctx:           ctx,
		commandSender: commandSender,
		eventReceiver: eventReceiver,
		config:        cfg,
		logger:        logger,
		sessions:      make([]SessionInfo, 0),
		focusIndex:    0,
		minimalMode:   cfg.GetMinimalMode(),
		ready:         false,
		quitting:      false,
	}
}

// Init initializes the model
func (m Model) Init() tea.Cmd {
	return tea.Batch(
		waitForEvent(m.eventReceiver),
		tea.EnterAltScreen,
		requestInitialState(m.commandSender),
	)
}

// Update handles messages
func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		return m.handleKeyPress(msg)
		
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.ready = true
		return m, nil
		
	case eventMsg:
		return m.handleEvent(msg.event)
		
	case errMsg:
		m.err = msg.err
		return m, nil
	}
	
	return m, nil
}

// View renders the UI
func (m Model) View() string {
	if !m.ready {
		return "Initializing..."
	}
	
	if m.err != nil {
		return fmt.Sprintf("Error: %v", m.err)
	}
	
	if m.quitting {
		return "Goodbye!\n"
	}
	
	// In minimal mode, show only status bar
	if m.minimalMode {
		return m.renderMinimalView()
	}
	
	// Full view
	return m.renderFullView()
}

// handleKeyPress processes keyboard input
func (m Model) handleKeyPress(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.Type {
	case tea.KeyCtrlC, tea.KeyEsc:
		if msg.Type == tea.KeyCtrlC || (msg.Type == tea.KeyEsc && m.minimalMode) {
			m.quitting = true
			return m, tea.Quit
		}
		
	case tea.KeyRunes:
		switch string(msg.Runes) {
		case "q", "Q":
			m.quitting = true
			return m, tea.Quit
			
		case "j":
			if m.focusIndex < len(m.sessions)-1 {
				m.focusIndex++
			}
			
		case "k":
			if m.focusIndex > 0 {
				m.focusIndex--
			}
			
		case "n":
			// Create new session
			cmd, err := protocol.CreateSession(
				fmt.Sprintf("session-%d", time.Now().Unix()),
				m.config.GetDefaultAgent(),
			).Build()
			if err != nil {
				m.logger.Error("Failed to build create session command", "error", err)
				return m, nil
			}
			return m, sendCommand(m.commandSender, cmd)
			
		case "d":
			// Delete current session
			if m.focusIndex < len(m.sessions) {
				session := m.sessions[m.focusIndex]
				cmd, err := protocol.DeleteSession(session.ID, false).Build()
				if err != nil {
					m.logger.Error("Failed to build delete session command", "error", err)
					return m, nil
				}
				return m, sendCommand(m.commandSender, cmd)
			}
			
		case "m":
			// Toggle minimal mode
			m.minimalMode = !m.minimalMode
			cmd, err := protocol.ToggleMinimal().Build()
			if err != nil {
				m.logger.Error("Failed to build toggle minimal command", "error", err)
				return m, nil
			}
			return m, sendCommand(m.commandSender, cmd)
			
		case "?":
			// Show help (not implemented yet)
		}
		
	case tea.KeyTab:
		// Move to next actionable session
		m.focusNextActionable()
	}
	
	return m, nil
}

// handleEvent processes protocol events
func (m Model) handleEvent(event protocol.EnhancedEvent) (tea.Model, tea.Cmd) {
	switch event.Type {
	case protocol.EventSessionCreated:
		payload, ok := event.Payload.(protocol.SessionCreatedEvent)
		if ok {
			m.sessions = append(m.sessions, SessionInfo{
				ID:            payload.Session.ID,
				Name:          payload.Session.Name,
				Agent:         payload.Session.Agent,
				Status:        payload.Session.Status,
				Branch:        payload.Session.Branch,
				EnvironmentID: payload.Session.EnvironmentID,
				UpdatedAt:     payload.Session.UpdatedAt,
			})
		}
		
	case protocol.EventSessionDeleted:
		payload, ok := event.Payload.(protocol.SessionDeletedEvent)
		if ok {
			m.removeSession(payload.SessionID)
		}
		
	case protocol.EventSessionUpdated:
		payload, ok := event.Payload.(protocol.SessionUpdatedEvent)
		if ok {
			for i, s := range m.sessions {
				if s.ID == payload.Session.ID {
					m.sessions[i] = SessionInfo{
						ID:            payload.Session.ID,
						Name:          payload.Session.Name,
						Agent:         payload.Session.Agent,
						Status:        payload.Session.Status,
						Branch:        payload.Session.Branch,
						EnvironmentID: payload.Session.EnvironmentID,
						UpdatedAt:     payload.Session.UpdatedAt,
					}
					break
				}
			}
		}
		
	case protocol.EventStateSnapshot:
		// Handle full state update
		payload, ok := event.Payload.(protocol.StateSnapshotEvent)
		if ok {
			m.sessions = make([]SessionInfo, 0, len(payload.Sessions))
			for _, s := range payload.Sessions {
				m.sessions = append(m.sessions, SessionInfo{
					ID:            s.ID,
					Name:          s.Name,
					Agent:         s.Agent,
					Status:        s.Status,
					Branch:        s.Branch,
					EnvironmentID: s.EnvironmentID,
					UpdatedAt:     s.UpdatedAt,
				})
			}
			// Find focus index based on focused ID
			for i, s := range m.sessions {
				if s.ID == payload.FocusedID {
					m.focusIndex = i
					break
				}
			}
		}
	}
	
	// Continue listening for events
	return m, waitForEvent(m.eventReceiver)
}

// Helper methods

func (m *Model) removeSession(sessionID string) {
	for i, s := range m.sessions {
		if s.ID == sessionID {
			m.sessions = append(m.sessions[:i], m.sessions[i+1:]...)
			if m.focusIndex >= len(m.sessions) && m.focusIndex > 0 {
				m.focusIndex--
			}
			break
		}
	}
}


func (m *Model) focusNextActionable() {
	start := m.focusIndex
	for i := 0; i < len(m.sessions); i++ {
		idx := (start + i + 1) % len(m.sessions)
		if isActionable(m.sessions[idx].Status) {
			m.focusIndex = idx
			break
		}
	}
}

func isActionable(status protocol.SessionStatus) bool {
	return status == protocol.StatusError || status == protocol.StatusWaiting
}

// Rendering methods

func (m Model) renderMinimalView() string {
	if len(m.sessions) == 0 {
		return "No sessions"
	}
	
	// Show only the focused session status
	session := m.sessions[m.focusIndex]
	statusStyle := getStatusStyle(session.Status)
	
	return fmt.Sprintf("%s: %s", 
		session.Name,
		statusStyle.Render(string(session.Status)))
}

func (m Model) renderFullView() string {
	var s string
	
	// Header
	s += renderHeader(m.width)
	s += "\n\n"
	
	// Sessions
	if len(m.sessions) == 0 {
		s += centerText("No sessions. Press 'n' to create one.", m.width)
	} else {
		for i, session := range m.sessions {
			focused := i == m.focusIndex
			s += m.renderSession(session, focused) + "\n"
		}
	}
	
	// Footer with help
	s += "\n"
	s += renderFooter(m.width)
	
	return s
}

func (m Model) renderSession(session SessionInfo, focused bool) string {
	statusStyle := getStatusStyle(session.Status)
	
	line := fmt.Sprintf("  %s  %-20s  %s  %s",
		statusStyle.Render(string(session.Status)),
		truncate(session.Name, 20),
		session.Agent,
		session.Branch,
	)
	
	if focused {
		return focusedStyle.Render("> " + line)
	}
	return "  " + line
}

// Styles
var (
	focusedStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("205"))
	headerStyle  = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("99"))
	footerStyle  = lipgloss.NewStyle().Faint(true)
)

func getStatusStyle(status protocol.SessionStatus) lipgloss.Style {
	switch status {
	case protocol.StatusReady:
		return lipgloss.NewStyle().Foreground(lipgloss.Color("10"))  // Green
	case protocol.StatusWorking:
		return lipgloss.NewStyle().Foreground(lipgloss.Color("11"))  // Yellow
	case protocol.StatusWaiting:
		return lipgloss.NewStyle().Foreground(lipgloss.Color("214")) // Orange
	case protocol.StatusError:
		return lipgloss.NewStyle().Foreground(lipgloss.Color("9"))   // Red
	case protocol.StatusThinking:
		return lipgloss.NewStyle().Foreground(lipgloss.Color("12"))  // Blue
	default:
		return lipgloss.NewStyle()
	}
}

// Helper functions

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-3] + "..."
}

func centerText(text string, width int) string {
	padding := (width - len(text)) / 2
	if padding < 0 {
		padding = 0
	}
	return fmt.Sprintf("%*s%s", padding, "", text)
}

func renderHeader(width int) string {
	title := "🏔️  Trails - AI Agent Orchestrator"
	return headerStyle.Render(centerText(title, width))
}

func renderFooter(width int) string {
	help := "j/k: navigate • n: new • d: delete • m: minimal • q: quit"
	return footerStyle.Render(centerText(help, width))
}