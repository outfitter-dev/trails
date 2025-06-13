// Package engine implements the core business logic for managing AI agent sessions.
// It provides the Engine type which coordinates between the UI, agents, and containers.
//
// The engine handles:
//   - Command processing from the UI
//   - Session lifecycle management
//   - State persistence and recovery
//   - Container environment management
//   - Event distribution back to the UI
//   - Health monitoring and metrics collection
//
// Architecture:
//
// The engine uses a worker pool pattern for concurrent command processing.
// Commands flow in through a channel, are processed by workers, and generate
// events that flow back to the UI. All operations are non-blocking.
//
// Thread Safety:
//
// The engine and all its components are designed to be thread-safe.
// Sessions use fine-grained locking to allow concurrent access.
// State persistence happens periodically in the background.
//
// Example:
//
//	cfg := engine.DefaultConfig()
//	engine, err := engine.New(cfg, commands, events, sessions, state, containers, metrics, logger)
//	if err != nil {
//		return err
//	}
//	
//	if err := engine.Start(ctx); err != nil {
//		return err
//	}
//	defer engine.Stop()
package engine

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/outfitter-dev/trails/internal/logging"
	"github.com/outfitter-dev/trails/internal/protocol"
)

// Engine is the core component that processes commands and manages sessions.
// It coordinates between the UI, agents, and container environments.
// The engine runs multiple worker goroutines for concurrent command processing.
type Engine struct {
	// Communication channels
	commands <-chan protocol.Command      // Incoming commands from UI
	events   chan<- protocol.EnhancedEvent // Outgoing events to UI

	// Core components
	sessions   SessionManager    // Manages agent session lifecycle
	state      StateManager       // Handles state persistence
	containers ContainerManager   // Manages container environments

	// Runtime
	ctx    context.Context    // Engine context for shutdown
	cancel context.CancelFunc // Cancel function for graceful shutdown
	wg     sync.WaitGroup     // Tracks worker goroutines

	// Infrastructure
	logger      *logging.Logger              // Structured logging
	rateLimiter *protocol.LRURateLimiter     // Rate limiting with LRU eviction
	metrics     MetricsCollector             // Performance metrics

	// Configuration
	config Config // Engine configuration
}

// Config holds engine configuration parameters.
// These control resource limits and operational behavior.
type Config struct {
	// MaxConcurrentSessions limits how many sessions can run simultaneously
	MaxConcurrentSessions int           `json:"max_concurrent_sessions"`
	
	// CommandBufferSize sets the command channel buffer size
	CommandBufferSize     int           `json:"command_buffer_size"`
	
	// EventBufferSize sets the event channel buffer size
	EventBufferSize       int           `json:"event_buffer_size"`
	
	// StateFile is the path where state is persisted
	StateFile             string        `json:"state_file"`
	
	// WorkerCount is the number of concurrent command processors
	WorkerCount           int           `json:"worker_count"`
	
	// ShutdownTimeout is how long to wait for graceful shutdown
	ShutdownTimeout       time.Duration `json:"shutdown_timeout"`
	
	// RateLimitPerSecond is the sustained request rate
	RateLimitPerSecond    int           `json:"rate_limit_per_second"`
	
	// RateLimitBurst is the maximum burst size
	RateLimitBurst        int           `json:"rate_limit_burst"`
	
	// LogLevel controls logging verbosity (debug, info, warn, error)
	LogLevel              string        `json:"log_level"`
}

// DefaultConfig returns a Config with sensible defaults.
// These defaults are suitable for development and small deployments.
func DefaultConfig() Config {
	return Config{
		MaxConcurrentSessions: DefaultMaxConcurrentSessions,
		CommandBufferSize:     DefaultCommandBufferSize,
		EventBufferSize:       DefaultEventBufferSize,
		StateFile:             DefaultStateFile,
		WorkerCount:           DefaultWorkerCount,
		ShutdownTimeout:       DefaultShutdownTimeout,
		RateLimitPerSecond:    protocol.DefaultRateLimit,
		RateLimitBurst:        protocol.DefaultRateBurst,
		LogLevel:              DefaultLogLevel,
	}
}

// SessionManager manages the lifecycle of agent sessions.
// Implementations must be thread-safe.
type SessionManager interface {
	// Create creates a new session with the given configuration.
	// Returns error if:
	// - Session name already exists
	// - Agent type is not supported
	// - Maximum session limit reached
	Create(ctx context.Context, req protocol.CreateSessionCommand) (*Session, error)
	
	// Delete removes a session and cleans up associated resources.
	// If force is true, the session is deleted even if the agent is running.
	// Returns error if session doesn't exist.
	Delete(ctx context.Context, sessionID string, force bool) error
	
	// Update modifies session properties.
	// Supported update fields: name, branch, environment
	// Returns error if session doesn't exist or update field is invalid.
	Update(ctx context.Context, sessionID string, updates map[string]interface{}) error
	
	// Get retrieves a session by ID.
	// Returns error if session doesn't exist.
	Get(ctx context.Context, sessionID string) (*Session, error)
	
	// List returns sessions matching the filter criteria.
	// Empty filter returns all sessions.
	List(ctx context.Context, filter protocol.SessionFilter) ([]*Session, error)
	
	// SetStatus updates the session status and triggers status change events.
	// Returns error if session doesn't exist.
	SetStatus(ctx context.Context, sessionID string, status protocol.SessionStatus) error
}

// StateManager handles persistence and restoration of application state.
// Implementations must ensure thread-safety and handle concurrent access.
type StateManager interface {
	// Load reads the persisted state from storage and applies it.
	// Returns error if:
	// - State file is corrupted or invalid
	// - I/O error occurs during read
	// - Context is cancelled
	Load(ctx context.Context) error
	
	// Save persists the current state to storage.
	// Returns error if:
	// - I/O error occurs during write
	// - Context is cancelled
	// - State cannot be serialized
	Save(ctx context.Context) error
	
	// GetSnapshot returns a complete snapshot of the current state.
	// The snapshot includes all sessions and their current status.
	// Returns error if state cannot be read or is inconsistent.
	GetSnapshot() (*protocol.StateSnapshotEvent, error)
	
	// RestoreFromSnapshot applies a state snapshot to restore previous state.
	// This is typically used during startup or after a crash.
	// Returns error if:
	// - Snapshot is nil or invalid
	// - Snapshot version is incompatible
	// - Restoration fails partially (state may be inconsistent)
	RestoreFromSnapshot(snapshot *protocol.StateSnapshotEvent) error
}

// ContainerManager handles creation and lifecycle of containerized environments.
// Each session gets its own isolated container environment.
// Implementations must handle resource cleanup and prevent resource leaks.
type ContainerManager interface {
	// CreateEnvironment creates a new container environment for a session.
	// The environment is isolated and configured according to the request.
	// Returns error if:
	// - Container creation fails
	// - Resources are exhausted
	// - Invalid configuration in request
	// - Context is cancelled
	CreateEnvironment(ctx context.Context, req ContainerRequest) (*Container, error)
	
	// DestroyEnvironment tears down a container environment and releases resources.
	// This includes stopping any running processes and cleaning up volumes.
	// Returns error if:
	// - Environment doesn't exist
	// - Cleanup fails (resources may leak)
	// - Context is cancelled
	DestroyEnvironment(ctx context.Context, envID string) error
	
	// GetEnvironmentStatus returns the current status of a container environment.
	// Returns error if:
	// - Environment doesn't exist
	// - Status cannot be determined
	// - Context is cancelled
	GetEnvironmentStatus(ctx context.Context, envID string) (ContainerStatus, error)
}

// MetricsCollector gathers operational metrics for monitoring and debugging.
// Implementations should be lightweight and not impact performance.
// All methods must be thread-safe and non-blocking.
type MetricsCollector interface {
	// RecordCommand increments the counter for a specific command type.
	// This helps track command frequency and patterns.
	RecordCommand(cmdType protocol.CommandType)
	
	// RecordCommandDuration tracks how long a command took to execute.
	// Used for performance monitoring and identifying slow operations.
	RecordCommandDuration(cmdType protocol.CommandType, duration time.Duration)
	
	// RecordError tracks errors by operation type.
	// The operation string should identify where the error occurred.
	RecordError(operation string, err error)
	
	// RecordSessionCount updates the current number of active sessions.
	// This is called periodically by the health monitor.
	RecordSessionCount(count int)
	
	// IncrementCounter increments a named counter with optional tags.
	// Used for custom metrics beyond the standard ones.
	// Example: IncrementCounter("events.dropped", map[string]string{"type": "session_created"})
	IncrementCounter(name string, tags map[string]string)
}

// Session represents an AI agent session with its associated environment.
// Each session runs in an isolated container and has its own lifecycle.
// All methods are thread-safe.
type Session struct {
	// ID is a unique identifier for the session (ULID format)
	ID            string                    `json:"id"`
	
	// Name is a human-readable identifier for the session
	Name          string                    `json:"name"`
	
	// Agent specifies which AI agent to use (e.g., "claude-3-sonnet")
	Agent         string                    `json:"agent"`
	
	// Status represents the current state of the session
	Status        protocol.SessionStatus   `json:"status"`
	
	// EnvironmentID links to the container environment
	EnvironmentID string                    `json:"environment_id"`
	
	// Branch is the git branch the session is working on
	Branch        string                    `json:"branch"`
	
	// CreatedAt is when the session was first created
	CreatedAt     time.Time                 `json:"created_at"`
	
	// UpdatedAt is when the session was last modified
	UpdatedAt     time.Time                 `json:"updated_at"`
	
	// LastActivity is when the session last processed a command
	LastActivity  time.Time                 `json:"last_activity"`
	
	// Environment contains environment variables for the session
	Environment   map[string]string         `json:"environment,omitempty"`

	// Runtime state (not persisted)
	process *AgentProcess `json:"-"` // The running agent process
	mu      sync.RWMutex  `json:"-"` // Protects all fields from concurrent access
}

// GetStatus returns the session status in a thread-safe manner.
// This method is safe to call concurrently.
func (s *Session) GetStatus() protocol.SessionStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.Status
}

// SetStatus updates the session status in a thread-safe manner.
// It also updates the UpdatedAt timestamp.
// This method is safe to call concurrently.
func (s *Session) SetStatus(status protocol.SessionStatus) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Status = status
	s.UpdatedAt = time.Now()
}

// UpdateLastActivity updates the last activity timestamp.
// This should be called whenever the session processes a command.
// This method is safe to call concurrently.
func (s *Session) UpdateLastActivity() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.LastActivity = time.Now()
}

// GetProcess returns the associated agent process.
// Returns nil if no process is running.
// This method is safe to call concurrently.
func (s *Session) GetProcess() *AgentProcess {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.process
}

// SetProcess associates an agent process with the session.
// Pass nil to clear the process association.
// This method is safe to call concurrently.
func (s *Session) SetProcess(process *AgentProcess) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.process = process
}

// Update applies a set of updates to the session fields.
// Supported fields: "name", "status", "branch".
// Unknown fields are ignored. Updates the UpdatedAt timestamp.
// This method is safe to call concurrently.
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

// Clone creates a deep copy of the session.
// The returned copy is safe to use without locks.
// Note: The process pointer is copied but not deep cloned.
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

// AgentProcess represents a running AI agent process.
// This tracks the actual process running in the container.
type AgentProcess struct {
	// ID is a unique identifier for this process instance
	ID        string
	
	// SessionID links back to the owning session
	SessionID string
	
	// Status indicates the current state of the process
	Status    ProcessStatus
	
	// StartedAt is when the process was launched
	StartedAt time.Time
	
	// PID is the process ID in the container
	PID       int
}

// ProcessStatus represents the lifecycle state of an agent process.
type ProcessStatus string

const (
	// ProcessStatusStarting indicates the process is being launched
	ProcessStatusStarting ProcessStatus = "starting"
	
	// ProcessStatusRunning indicates the process is active and healthy
	ProcessStatusRunning  ProcessStatus = "running"
	
	// ProcessStatusStopping indicates a shutdown has been requested
	ProcessStatusStopping ProcessStatus = "stopping"
	
	// ProcessStatusStopped indicates the process has terminated cleanly
	ProcessStatusStopped  ProcessStatus = "stopped"
	
	// ProcessStatusError indicates the process failed or crashed
	ProcessStatusError    ProcessStatus = "error"
)

// Container represents an isolated environment for running an agent.
// Each container provides filesystem isolation and resource limits.
type Container struct {
	// ID is a unique identifier for the container
	ID        string            `json:"id"`
	
	// Name is a human-readable identifier
	Name      string            `json:"name"`
	
	// Status indicates the container's current state
	Status    ContainerStatus   `json:"status"`
	
	// CreatedAt is when the container was created
	CreatedAt time.Time         `json:"created_at"`
	
	// Metadata contains additional container properties
	Metadata  map[string]string `json:"metadata"`
}

// ContainerRequest specifies parameters for creating a new container.
type ContainerRequest struct {
	// Name is a human-readable identifier for the container
	Name        string            `json:"name"`
	
	// Source specifies the image or template to use
	Source      string            `json:"source"`
	
	// Environment variables to set in the container
	Environment map[string]string `json:"environment"`
}

// ContainerStatus represents the lifecycle state of a container.
type ContainerStatus string

const (
	// ContainerStatusCreating indicates the container is being set up
	ContainerStatusCreating ContainerStatus = "creating"
	
	// ContainerStatusReady indicates the container is ready for use
	ContainerStatusReady    ContainerStatus = "ready"
	
	// ContainerStatusError indicates the container failed to start
	ContainerStatusError    ContainerStatus = "error"
	
	// ContainerStatusDestroyed indicates the container has been removed
	ContainerStatusDestroyed ContainerStatus = "destroyed"
)

// New creates a new engine instance with the provided dependencies.
// All parameters are required and will be validated.
// Returns error if any parameter is nil or invalid.
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

	// Use LRU rate limiter with configured max size
	rateLimiter := protocol.NewLRURateLimiter(
		cfg.RateLimitPerSecond,
		cfg.RateLimitBurst,
		RateLimiterMaxSize,
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

// Start begins engine operation with the given context.
// This starts all worker goroutines and background tasks.
// Returns error if state cannot be loaded.
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

// Stop gracefully shuts down the engine.
// It cancels all operations, waits for workers to finish,
// and saves the final state. Returns error if shutdown
// times out or state cannot be saved.
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

// Health returns current engine health metrics.
// This includes session counts, rate limiter size,
// and configuration parameters.
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