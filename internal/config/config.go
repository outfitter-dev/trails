package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// Config holds agentish configuration
type Config struct {
	// RepoPath is the current repository path
	RepoPath string `json:"repo_path"`

	// Global configuration from ~/.config/agentish/
	Global *GlobalConfig `json:"global,omitempty"`

	// Repo-specific configuration from .agentish/settings.json
	Repo *RepoConfig `json:"repo,omitempty"`

	// Local overrides from .agentish/settings.local.json
	Local *RepoConfig `json:"local,omitempty"`
}

// GlobalConfig stores global agentish preferences
type GlobalConfig struct {
	DefaultAgent    string            `json:"default_agent"`
	ProjectRegistry map[string]string `json:"project_registry"`
	Theme           string            `json:"theme"`
	MinimalMode     *bool             `json:"minimal_mode,omitempty"`
}

// RepoConfig stores repository-specific settings
type RepoConfig struct {
	PreferredAgents []string          `json:"preferred_agents"`
	DefaultAgent    string            `json:"default_agent"`
	AutoRestore     *bool             `json:"auto_restore,omitempty"`
	MinimalMode     *bool             `json:"minimal_mode,omitempty"`
	Environment     map[string]string `json:"environment"`
}

// Load configuration from filesystem
func Load(repoPath string) (*Config, error) {
	cfg := &Config{
		RepoPath: repoPath,
	}

	// Load global config
	if globalCfg, err := loadGlobalConfig(); err == nil {
		cfg.Global = globalCfg
	}

	// Load repo-specific config
	if repoCfg, err := loadRepoConfig(repoPath, "settings.json"); err == nil {
		cfg.Repo = repoCfg
	}

	// Load local overrides
	if localCfg, err := loadRepoConfig(repoPath, "settings.local.json"); err == nil {
		cfg.Local = localCfg
	}

	return cfg, nil
}

// GetDefaultAgent returns the preferred agent for this context
func (c *Config) GetDefaultAgent() string {
	// Priority: Local > Repo > Global > fallback
	if c.Local != nil && c.Local.DefaultAgent != "" {
		return c.Local.DefaultAgent
	}
	if c.Repo != nil && c.Repo.DefaultAgent != "" {
		return c.Repo.DefaultAgent
	}
	if c.Global != nil && c.Global.DefaultAgent != "" {
		return c.Global.DefaultAgent
	}
	return "codex" // fallback
}

// GetAutoRestore returns whether to automatically restore sessions
func (c *Config) GetAutoRestore() bool {
	// Priority: Local > Repo > default
	if c.Local != nil && c.Local.AutoRestore != nil {
		return *c.Local.AutoRestore
	}
	if c.Repo != nil && c.Repo.AutoRestore != nil {
		return *c.Repo.AutoRestore
	}
	return true // default to true
}

// GetMinimalMode returns the preferred minimal mode setting
func (c *Config) GetMinimalMode() bool {
	// Priority: Local > Repo > Global > default
	if c.Local != nil && c.Local.MinimalMode != nil {
		return *c.Local.MinimalMode
	}
	if c.Repo != nil && c.Repo.MinimalMode != nil {
		return *c.Repo.MinimalMode
	}
	if c.Global != nil && c.Global.MinimalMode != nil {
		return *c.Global.MinimalMode
	}
	return false // default to false
}

func loadGlobalConfig() (*GlobalConfig, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}

	configPath := filepath.Join(configDir, "agentish", "config.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			// Return default config
			return &GlobalConfig{
				DefaultAgent:    "codex",
				ProjectRegistry: make(map[string]string),
				Theme:           "default",
			}, nil
		}
		return nil, err
	}

	var cfg GlobalConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse global config: %w", err)
	}

	return &cfg, nil
}

func loadRepoConfig(repoPath, filename string) (*RepoConfig, error) {
	configPath := filepath.Join(repoPath, ".agentish", filename)
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, err
	}

	var cfg RepoConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse %s: %w", filename, err)
	}

	return &cfg, nil
}
