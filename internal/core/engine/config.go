package engine

import "time"

// Configuration constants
const (
	// Worker configuration
	DefaultWorkerCount           = 3
	DefaultMaxConcurrentSessions = 10
	
	// Channel buffer sizes
	DefaultCommandBufferSize = 100
	DefaultEventBufferSize   = 5000
	
	// Timeouts
	DefaultShutdownTimeout = 30 * time.Second
	StateManagerInterval   = 30 * time.Second
	HealthMonitorInterval  = 60 * time.Second
	CleanupInterval       = 1 * time.Minute
	
	// Cleanup configuration
	RateLimiterCleanupAge    = 5 * time.Minute
	RateLimiterWarningSize   = 1000
	RateLimiterMaxSize      = 10000
	StaleSessionTimeout     = 24 * time.Hour
	StaleContainerTimeout   = 1 * time.Hour
	
	// Retry configuration
	EventSendMaxAttempts    = 5
	EventSendInitialBackoff = 10 * time.Millisecond
	EventSendMaxBackoff     = 500 * time.Millisecond
	CommandSendTimeout      = 5 * time.Second
	InitialStateTimeout     = 2 * time.Second
	
	// Metrics configuration
	MetricsDurationHistorySize = 100
	
	// Protocol configuration
	DefaultStateFile = ".trails/state.json"
)

// LogLevel constants for controlling verbosity
const (
	// LogLevelDebug shows all messages including internal operations
	LogLevelDebug = "debug"
	
	// LogLevelInfo shows important operational messages (default)
	LogLevelInfo = "info"
	
	// LogLevelWarn shows only warnings and errors
	LogLevelWarn = "warn"
	
	// LogLevelError shows only errors
	LogLevelError = "error"
	
	// DefaultLogLevel is the default logging verbosity
	DefaultLogLevel = LogLevelInfo
)