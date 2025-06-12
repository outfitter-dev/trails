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

// Manager implements container management
type Manager struct {
	mu         sync.RWMutex
	containers map[string]*engine.Container
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

	return container, nil
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

	// Update status
	container.Status = engine.ContainerStatusDestroyed

	// In a real implementation, this would:
	// 1. Stop any running processes
	// 2. Clean up filesystem
	// 3. Remove network resources
	// 4. Update container registry

	// Remove from our tracking
	delete(m.containers, envID)

	m.logger.Info("Container environment destroyed",
		"container_id", envID,
	)

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

// ListEnvironments returns all container environments
func (m *Manager) ListEnvironments() []*engine.Container {
	m.mu.RLock()
	defer m.mu.RUnlock()

	containers := make([]*engine.Container, 0, len(m.containers))
	for _, container := range m.containers {
		// Create copy to avoid race conditions
		containerCopy := *container
		containers = append(containers, &containerCopy)
	}

	return containers
}

// GetContainer returns a specific container by ID
func (m *Manager) GetContainer(containerID string) (*engine.Container, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	container, exists := m.containers[containerID]
	if !exists {
		return nil, fmt.Errorf("container not found: %s", containerID)
	}

	// Return copy to avoid race conditions
	containerCopy := *container
	return &containerCopy, nil
}

// simulateContainerCreation simulates the async nature of container creation
func (m *Manager) simulateContainerCreation(containerID string) {
	// Simulate creation time
	time.Sleep(100 * time.Millisecond)

	m.mu.Lock()
	defer m.mu.Unlock()

	container, exists := m.containers[containerID]
	if !exists {
		return // Container was deleted during creation
	}

	// Mark as ready
	container.Status = engine.ContainerStatusReady

	m.logger.Info("Container environment ready",
		"container_id", containerID,
		"name", container.Name,
	)
}

// CleanupStaleContainers removes containers that are no longer needed
func (m *Manager) CleanupStaleContainers(olderThan time.Duration) int {
	m.mu.Lock()
	defer m.mu.Unlock()

	cutoff := time.Now().Add(-olderThan)
	removed := 0

	for id, container := range m.containers {
		// Remove containers that are old and in error or destroyed state
		if container.CreatedAt.Before(cutoff) && 
		   (container.Status == engine.ContainerStatusError || 
		    container.Status == engine.ContainerStatusDestroyed) {
			
			m.logger.Info("Cleaning up stale container",
				"container_id", id,
				"name", container.Name,
				"status", container.Status,
				"age", time.Since(container.CreatedAt),
			)

			delete(m.containers, id)
			removed++
		}
	}

	if removed > 0 {
		m.logger.Info("Cleaned up stale containers",
			"removed_count", removed,
		)
	}

	return removed
}

// GetContainerCount returns the number of tracked containers
func (m *Manager) GetContainerCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.containers)
}

// GetContainersByStatus returns containers with a specific status
func (m *Manager) GetContainersByStatus(status engine.ContainerStatus) []*engine.Container {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var results []*engine.Container
	for _, container := range m.containers {
		if container.Status == status {
			containerCopy := *container
			results = append(results, &containerCopy)
		}
	}

	return results
}