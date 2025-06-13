// Package engine implements the core business logic engine
package engine

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/outfitter-dev/trails/internal/logging"
	"github.com/outfitter-dev/trails/internal/protocol"
)

// Engine manages the core business logic and command processing
type Engine struct {
	// Communication channels
	commands <-chan protocol.Command
	events   chan<- protocol.EnhancedEvent

	// Core components
	sessions   SessionManager
	state      StateManager
	containers ContainerManager

	// Runtime
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup

	// Infrastructure
	logger      *logging.Logger
	rateLimiter *protocol.LRURateLimiter
	metrics     MetricsCollector

	// Configuration
	config Config
}

// Config holds engine configuration
type Config struct {
	MaxConcurrentSessions int           `json:"max_concurrent_sessions"`
	CommandBufferSize     int           `json:"command_buffer_size"`
	EventBufferSize       int           `json:"event_buffer_size"`
	StateFile             string        `json:"state_file"`
	WorkerCount           int           `json:"worker_count"`
	ShutdownTimeout       time.Duration `json:"shutdown_timeout"`
	RateLimitPerSecond    int           `json:"rate_limit_per_second"`
	RateLimitBurst        int           `json:"rate_limit_burst"`
}

// DefaultConfig returns sensible defaults
func DefaultConfig() Config {
	return Config{
		MaxConcurrentSessions: 10,
		CommandBufferSize:     100,
		EventBufferSize:       5000, // Increased to reduce blocking
		StateFile:             ".trails/state.json",
		WorkerCount:           3,
		ShutdownTimeout:       30 * time.Second,
		RateLimitPerSecond:    protocol.DefaultRateLimit,
		RateLimitBurst:        protocol.DefaultRateBurst,
	}
}

// SessionManager interface for session operations
type SessionManager interface {
	Create(ctx context.Context, req protocol.CreateSessionCommand) (*Session, error)
	Delete(ctx context.Context, sessionID string, force bool) error
	Update(ctx context.Context, sessionID string, updates map[string]interface{}) error
	Get(ctx context.Context, sessionID string) (*Session, error)
	List(ctx context.Context, filter protocol.SessionFilter) ([]*Session, error)
	SetStatus(ctx context.Context, sessionID string, status protocol.SessionStatus) error
}

// StateManager interface for state persistence
type StateManager interface {
	Load(ctx context.Context) error
	Save(ctx context.Context) error
	GetSnapshot() (*protocol.StateSnapshotEvent, error)
	RestoreFromSnapshot(snapshot *protocol.StateSnapshotEvent) error
}

// ContainerManager interface for container operations
type ContainerManager interface {
	CreateEnvironment(ctx context.Context, req ContainerRequest) (*Container, error)
	DestroyEnvironment(ctx context.Context, envID string) error
	GetEnvironmentStatus(ctx context.Context, envID string) (ContainerStatus, error)
}

// MetricsCollector interface for metrics
type MetricsCollector interface {
	RecordCommand(cmdType protocol.CommandType)
	RecordCommandDuration(cmdType protocol.CommandType, duration time.Duration)
	RecordError(operation string, err error)
	RecordSessionCount(count int)
	IncrementCounter(name string, tags map[string]string)
}

// Session represents an agent session
type Session struct {
	ID            string                    `json:"id"`
	Name          string                    `json:"name"`
	Agent         string                    `json:"agent"`
	Status        protocol.SessionStatus   `json:"status"`
	EnvironmentID string                    `json:"environment_id"`
	Branch        string                    `json:"branch"`
	CreatedAt     time.Time                 `json:"created_at"`
	UpdatedAt     time.Time                 `json:"updated_at"`
	LastActivity  time.Time                 `json:"last_activity"`
	Environment   map[string]string         `json:"environment,omitempty"`

	// Runtime state (not persisted)
	process *AgentProcess `json:"-"`
	mu      sync.RWMutex  `json:"-"`
}

// GetStatus returns the session status in a thread-safe manner
func (s *Session) GetStatus() protocol.SessionStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.Status
}

// SetStatus sets the session status in a thread-safe manner
func (s *Session) SetStatus(status protocol.SessionStatus) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Status = status
	s.UpdatedAt = time.Now()
}

// UpdateLastActivity updates the last activity time in a thread-safe manner
func (s *Session) UpdateLastActivity() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.LastActivity = time.Now()
}

// GetProcess returns the agent process in a thread-safe manner
func (s *Session) GetProcess() *AgentProcess {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.process
}

// SetProcess sets the agent process in a thread-safe manner
func (s *Session) SetProcess(process *AgentProcess) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.process = process
}

// Update applies updates to the session in a thread-safe manner
func (s *Session) Update(updates map[string]interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	for key, value := range updates {
		switch key {
		case "name":
			if name, ok := value.(string); ok {
				s.Name = name
			}
		case "status":
			if status, ok := value.(protocol.SessionStatus); ok {
				s.Status = status
			} else if statusStr, ok := value.(string); ok {
				s.Status = protocol.SessionStatus(statusStr)
			}
		case "branch":
			if branch, ok := value.(string); ok {
				s.Branch = branch
			}
		}
	}
	s.UpdatedAt = time.Now()
}

// Clone creates a thread-safe copy of the session
func (s *Session) Clone() Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	return Session{
		ID:            s.ID,
		Name:          s.Name,
		Agent:         s.Agent,
		Status:        s.Status,
		EnvironmentID: s.EnvironmentID,
		Branch:        s.Branch,
		CreatedAt:     s.CreatedAt,
		UpdatedAt:     s.UpdatedAt,
		LastActivity:  s.LastActivity,
		Environment:   s.Environment,
		process:       s.process,
	}
}

// AgentProcess represents a running agent
type AgentProcess struct {
	ID        string
	SessionID string
	Status    ProcessStatus
	StartedAt time.Time
	PID       int
}

// ProcessStatus represents agent process status
type ProcessStatus string

const (
	ProcessStatusStarting ProcessStatus = "starting"
	ProcessStatusRunning  ProcessStatus = "running"
	ProcessStatusStopping ProcessStatus = "stopping"
	ProcessStatusStopped  ProcessStatus = "stopped"
	ProcessStatusError    ProcessStatus = "error"
)

// Container represents a container environment
type Container struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Status    ContainerStatus   `json:"status"`
	CreatedAt time.Time         `json:"created_at"`
	Metadata  map[string]string `json:"metadata"`
}

// ContainerRequest for creating containers
type ContainerRequest struct {
	Name        string            `json:"name"`
	Source      string            `json:"source"`
	Environment map[string]string `json:"environment"`
}

// ContainerStatus represents container status
type ContainerStatus string

const (
	ContainerStatusCreating ContainerStatus = "creating"
	ContainerStatusReady    ContainerStatus = "ready"
	ContainerStatusError    ContainerStatus = "error"
	ContainerStatusDestroyed ContainerStatus = "destroyed"
)

// New creates a new engine instance
func New(
	cfg Config,
	commands <-chan protocol.Command,
	events chan<- protocol.EnhancedEvent,
	sessions SessionManager,
	state StateManager,
	containers ContainerManager,
	metrics MetricsCollector,
	logger *logging.Logger,
) (*Engine, error) {
	if commands == nil {
		return nil, fmt.Errorf("commands channel cannot be nil")
	}
	if events == nil {
		return nil, fmt.Errorf("events channel cannot be nil")
	}
	if sessions == nil {
		return nil, fmt.Errorf("session manager cannot be nil")
	}
	if state == nil {
		return nil, fmt.Errorf("state manager cannot be nil")
	}
	if containers == nil {
		return nil, fmt.Errorf("container manager cannot be nil")
	}
	if logger == nil {
		return nil, fmt.Errorf("logger cannot be nil")
	}

	// Use LRU rate limiter with max size of 10000 sessions
	rateLimiter := protocol.NewLRURateLimiter(
		cfg.RateLimitPerSecond,
		cfg.RateLimitBurst,
		10000, // Max tracked sessions
	)

	return &Engine{
		commands:    commands,
		events:      events,
		sessions:    sessions,
		state:       state,
		containers:  containers,
		logger:      logger,
		rateLimiter: rateLimiter,
		metrics:     metrics,
		config:      cfg,
	}, nil
}

// Start begins engine operation
func (e *Engine) Start(ctx context.Context) error {
	e.ctx, e.cancel = context.WithCancel(ctx)

	// Load persisted state
	if err := e.state.Load(e.ctx); err != nil {
		e.logger.WithError(err).Error("Failed to load state")
		return fmt.Errorf("load state: %w", err)
	}

	// Start worker goroutines
	for i := 0; i < e.config.WorkerCount; i++ {
		e.wg.Add(1)
		go e.commandWorker(i)
	}

	// Start background tasks
	e.wg.Add(1)
	go e.stateManager()

	e.wg.Add(1)
	go e.healthMonitor()

	e.wg.Add(1)
	go e.cleanupWorker()

	// Send initial state snapshot
	if err := e.sendStateSnapshot(); err != nil {
		e.logger.WithError(err).Warn("Failed to send initial state snapshot")
	}

	e.logger.Info("Engine started",
		"worker_count", e.config.WorkerCount,
		"max_sessions", e.config.MaxConcurrentSessions,
	)

	return nil
}

// Stop gracefully shuts down the engine
func (e *Engine) Stop() error {
	e.logger.Info("Stopping engine")

	// Cancel context to signal shutdown
	e.cancel()

	// Wait for workers to finish with timeout
	done := make(chan struct{})
	go func() {
		e.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		e.logger.Info("Engine stopped gracefully")
	case <-time.After(e.config.ShutdownTimeout):
		e.logger.Warn("Engine shutdown timeout exceeded")
		return fmt.Errorf("shutdown timeout after %v", e.config.ShutdownTimeout)
	}

	// Save final state
	if err := e.state.Save(e.ctx); err != nil {
		e.logger.WithError(err).Error("Failed to save final state")
		return fmt.Errorf("save final state: %w", err)
	}

	return nil
}

// Health returns engine health status
func (e *Engine) Health() map[string]interface{} {
	sessions, _ := e.sessions.List(e.ctx, protocol.SessionFilter{})
	
	return map[string]interface{}{
		"status":           "healthy",
		"active_sessions":  len(sessions),
		"rate_limiters":    e.rateLimiter.Size(),
		"worker_count":     e.config.WorkerCount,
		"max_sessions":     e.config.MaxConcurrentSessions,
		"uptime_seconds":   time.Since(time.Now()).Seconds(), // This would be tracked properly
	}
}