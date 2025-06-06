package session

import (
	"context"

	"github.com/maybe-good/agentish/internal/containeruse"
)

// EnvironmentProvider interface for dependency injection
type EnvironmentProvider interface {
	CreateEnvironment(ctx context.Context, req containeruse.CreateEnvironmentRequest) (*containeruse.Environment, error)
	DestroyEnvironment(ctx context.Context, envID string) error
	GetEnvironment(ctx context.Context, envID string) (*containeruse.Environment, error)
	SpawnAgent(ctx context.Context, envID, agentType string) error
}

// Ensure containeruse.Client implements EnvironmentProvider
var _ EnvironmentProvider = (*containeruse.Client)(nil)