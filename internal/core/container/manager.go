// Package container manages container environments for sessions
package container

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/outfitter-dev/trails/internal/core/engine"
	"github.com/outfitter-dev/trails/internal/logging"
)

// Manager handles container lifecycle and orchestration
type Manager struct {
	containers map[string]*engine.Container
	mu         sync.RWMutex
	logger     *logging.Logger
}

// NewManager creates a new container manager
func NewManager(logger *logging.Logger) *Manager {
	return &Manager{
		containers: make(map[string]*engine.Container),
		logger:     logger,
	}
}

// CreateEnvironment creates a new container environment
func (m *Manager) CreateEnvironment(ctx context.Context, req engine.ContainerRequest) (*engine.Container, error) {
	// Check if context is already cancelled
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("context cancelled: %w", err)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	// Generate container ID
	containerID := ulid.Make().String()

	m.logger.Info("Creating container environment",
		"container_id", containerID,
		"name", req.Name,
		"source", req.Source,
	)

	// Create container (simplified mock implementation)
	container := &engine.Container{
		ID:        containerID,
		Name:      req.Name,
		Status:    engine.ContainerStatusCreating,
		CreatedAt: time.Now(),
		Metadata: map[string]string{
			"source":      req.Source,
			"created_by":  "trails-engine",
			"environment": fmt.Sprintf("%d_vars", len(req.Environment)),
		},
	}

	// Store container
	m.containers[containerID] = container

	// Simulate container creation delay
	go m.simulateContainerCreation(containerID)

	m.logger.Info("Container environment created",
		"container_id", containerID,
		"name", req.Name,
	)

	// Return a copy to avoid data races
	clone := *container
	return &clone, nil
}

// DestroyEnvironment destroys a container environment
func (m *Manager) DestroyEnvironment(ctx context.Context, envID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	container, exists := m.containers[envID]
	if !exists {
		return fmt.Errorf("container not found: %s", envID)
	}

	m.logger.Info("Destroying container environment",
		"container_id", envID,
		"name", container.Name,
	)

	// Mark as destroyed
	container.Status = engine.ContainerStatusDestroyed

	// Remove from tracking
	delete(m.containers, envID)

	return nil
}

// GetEnvironmentStatus returns the status of a container environment
func (m *Manager) GetEnvironmentStatus(ctx context.Context, envID string) (engine.ContainerStatus, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	container, exists := m.containers[envID]
	if !exists {
		return "", fmt.Errorf("container not found: %s", envID)
	}

	return container.Status, nil
}

// simulateContainerCreation simulates the time it takes to create a container
func (m *Manager) simulateContainerCreation(containerID string) {
	// Simulate 2-5 second container creation time
	time.Sleep(3 * time.Second)

	m.mu.Lock()
	defer m.mu.Unlock()

	if container, exists := m.containers[containerID]; exists {
		container.Status = engine.ContainerStatusReady
		m.logger.Info("Container environment ready",
			"container_id", containerID,
			"name", container.Name,
		)
	}
}