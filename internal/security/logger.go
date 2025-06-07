package security

import (
	"os"
	"path/filepath"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// Security file permissions
const (
	// SecureAuditDirPerm - Owner read/write/execute only for audit directories  
	SecureAuditDirPerm  os.FileMode = 0700
	// SecureAuditFilePerm - Owner read/write only for audit files
	SecureAuditFilePerm os.FileMode = 0600
)

// AuditLogger provides structured security audit logging
type AuditLogger struct {
	logger *zap.Logger
}

// Event represents a security audit event
type Event struct {
	Action      string `json:"action"`
	Resource    string `json:"resource"`
	UserID      string `json:"user_id,omitempty"`
	SessionID   string `json:"session_id,omitempty"`
	RemoteAddr  string `json:"remote_addr,omitempty"`
	UserAgent   string `json:"user_agent,omitempty"`
	Success     bool   `json:"success"`
	ErrorMsg    string `json:"error_msg,omitempty"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
}

// NewAuditLogger creates a new security audit logger
func NewAuditLogger(repoPath string) (*AuditLogger, error) {
	// Create audit log directory
	auditDir := filepath.Join(repoPath, ".agentish", "audit")
	if err := os.MkdirAll(auditDir, SecureAuditDirPerm); err != nil {
		return nil, err
	}

	// Configure audit log file with secure permissions
	auditFile := filepath.Join(auditDir, "security.log")
	
	config := zap.NewProductionConfig()
	config.OutputPaths = []string{auditFile}
	config.ErrorOutputPaths = []string{auditFile}
	config.Level = zap.NewAtomicLevelAt(zap.InfoLevel)
	
	// Add caller information for debugging
	config.Development = false
	config.DisableCaller = false
	config.DisableStacktrace = false
	
	// Use JSON encoding for structured logs
	config.Encoding = "json"
	config.EncoderConfig = zapcore.EncoderConfig{
		TimeKey:        "timestamp",
		LevelKey:       "level",
		NameKey:        "logger",
		CallerKey:      "caller",
		MessageKey:     "message",
		StacktraceKey:  "stacktrace",
		LineEnding:     zapcore.DefaultLineEnding,
		EncodeLevel:    zapcore.LowercaseLevelEncoder,
		EncodeTime:     zapcore.ISO8601TimeEncoder,
		EncodeDuration: zapcore.SecondsDurationEncoder,
		EncodeCaller:   zapcore.ShortCallerEncoder,
	}

	logger, err := config.Build()
	if err != nil {
		return nil, err
	}

	// Ensure secure file permissions
	if err := os.Chmod(auditFile, SecureAuditFilePerm); err != nil {
		logger.Warn("Failed to set secure permissions on audit log", zap.Error(err))
	}

	return &AuditLogger{logger: logger}, nil
}

// LogEvent logs a security audit event
func (al *AuditLogger) LogEvent(event Event) {
	fields := []zap.Field{
		zap.String("action", event.Action),
		zap.String("resource", event.Resource),
		zap.Bool("success", event.Success),
	}

	if event.UserID != "" {
		fields = append(fields, zap.String("user_id", event.UserID))
	}
	if event.SessionID != "" {
		fields = append(fields, zap.String("session_id", event.SessionID))
	}
	if event.RemoteAddr != "" {
		fields = append(fields, zap.String("remote_addr", event.RemoteAddr))
	}
	if event.UserAgent != "" {
		fields = append(fields, zap.String("user_agent", event.UserAgent))
	}
	if event.ErrorMsg != "" {
		fields = append(fields, zap.String("error_msg", event.ErrorMsg))
	}
	if event.Metadata != nil {
		fields = append(fields, zap.Any("metadata", event.Metadata))
	}

	if event.Success {
		al.logger.Info("Security audit event", fields...)
	} else {
		al.logger.Warn("Security audit event - FAILED", fields...)
	}
}

// LogSessionCreate logs session creation events
func (al *AuditLogger) LogSessionCreate(sessionID, agentType string, success bool, err error) {
	event := Event{
		Action:    "session_create",
		Resource:  sessionID,
		SessionID: sessionID,
		Success:   success,
		Metadata: map[string]interface{}{
			"agent_type": agentType,
		},
	}
	if err != nil {
		event.ErrorMsg = err.Error()
	}
	al.LogEvent(event)
}

// LogSessionDestroy logs session destruction events
func (al *AuditLogger) LogSessionDestroy(sessionID string, success bool, err error) {
	event := Event{
		Action:    "session_destroy",
		Resource:  sessionID,
		SessionID: sessionID,
		Success:   success,
	}
	if err != nil {
		event.ErrorMsg = err.Error()
	}
	al.LogEvent(event)
}

// LogAgentStart logs agent start events
func (al *AuditLogger) LogAgentStart(sessionID, agentType, envID string, success bool, err error) {
	event := Event{
		Action:    "agent_start",
		Resource:  sessionID,
		SessionID: sessionID,
		Success:   success,
		Metadata: map[string]interface{}{
			"agent_type":     agentType,
			"environment_id": envID,
		},
	}
	if err != nil {
		event.ErrorMsg = err.Error()
	}
	al.LogEvent(event)
}

// LogCommandExecution logs command execution events
func (al *AuditLogger) LogCommandExecution(envID, command string, success bool, err error) {
	event := Event{
		Action:   "command_execution",
		Resource: envID,
		Success:  success,
		Metadata: map[string]interface{}{
			"command":        command,
			"environment_id": envID,
		},
	}
	if err != nil {
		event.ErrorMsg = err.Error()
	}
	al.LogEvent(event)
}

// LogSecurityViolation logs security violations
func (al *AuditLogger) LogSecurityViolation(action, resource, reason string, metadata map[string]interface{}) {
	event := Event{
		Action:   "security_violation",
		Resource: resource,
		Success:  false,
		ErrorMsg: reason,
		Metadata: metadata,
	}
	al.LogEvent(event)
}

// Close closes the audit logger
func (al *AuditLogger) Close() error {
	return al.logger.Sync()
}