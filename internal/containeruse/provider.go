package containeruse

import (
	"context"
	"fmt"
	"os"

	"github.com/outfitter-dev/trails/internal/security"
)

// ProviderType represents the type of container provider to use
type ProviderType string

const (
	ProviderTypeDagger       ProviderType = "dagger"
	ProviderTypeContainerUse ProviderType = "container-use"
	ProviderTypeMock         ProviderType = "mock"
)

// Provider is the unified interface for container providers
type Provider interface {
	CreateEnvironment(ctx context.Context, req CreateEnvironmentRequest) (*Environment, error)
	DestroyEnvironment(ctx context.Context, envID string) error
	GetEnvironment(ctx context.Context, envID string) (*Environment, error)
	SpawnAgent(ctx context.Context, envID, agentType string) error
}

// NewProvider creates a new container provider based on the specified type
func NewProvider(providerType ProviderType, auditLogger *security.AuditLogger) (Provider, func() error, error) {
	switch providerType {
	case ProviderTypeDagger:
		client, err := NewDaggerClient(auditLogger)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to create Dagger client: %w", err)
		}
		return client, client.Close, nil

	case ProviderTypeContainerUse:
		client := NewClientWithAudit(auditLogger)
		return client, func() error { return nil }, nil

	case ProviderTypeMock:
		return &MockProvider{}, func() error { return nil }, nil

	default:
		return nil, nil, fmt.Errorf("unknown provider type: %s", providerType)
	}
}

// GetDefaultProviderType returns the default provider type based on environment
func GetDefaultProviderType() ProviderType {
	// Check environment variable first
	if provider := os.Getenv("TRAILS_PROVIDER"); provider != "" {
		return ProviderType(provider)
	}

	// Default to Dagger
	return ProviderTypeDagger
}

// MockProvider implements a mock container provider for testing
type MockProvider struct{}

func (m *MockProvider) CreateEnvironment(ctx context.Context, req CreateEnvironmentRequest) (*Environment, error) {
	return &Environment{
		ID:     "mock-env-" + req.Name,
		Name:   req.Name,
		Source: req.Source,
		Status: "ready",
	}, nil
}

func (m *MockProvider) DestroyEnvironment(ctx context.Context, envID string) error {
	return nil
}

func (m *MockProvider) GetEnvironment(ctx context.Context, envID string) (*Environment, error) {
	return &Environment{
		ID:     envID,
		Status: "ready",
	}, nil
}

func (m *MockProvider) SpawnAgent(ctx context.Context, envID, agentType string) error {
	return nil
}
