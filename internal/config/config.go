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

func boolPtr(b bool) *bool {
	return &b
}

var defaultConfig = &Config{
	Global: &GlobalConfig{
		DefaultAgent: "codex",
		Theme:        "default",
	},
	Repo: &RepoConfig{
		AutoRestore: boolPtr(true),
		MinimalMode: boolPtr(false),
	},
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

	globalCfg, err := loadGlobalConfig()
	if err != nil {
		return nil, fmt.Errorf("error loading global config: %w", err)
	}
	cfg.Global = globalCfg

	repoCfg, err := loadRepoConfig(repoPath, "settings.json")
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("error loading repo config: %w", err)
	}
	if err == nil {
		cfg.Repo = repoCfg
	}

	localCfg, err := loadRepoConfig(repoPath, "settings.local.json")
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("error loading local config: %w", err)
	}
	if err == nil {
		cfg.Local = localCfg
	}

	return cfg, nil
}

// GetDefaultAgent returns the preferred agent for this context
func (c *Config) GetDefaultAgent() string {
	return getString(
		c.Local, func(r *RepoConfig) string { return r.DefaultAgent },
		c.Repo, func(r *RepoConfig) string { return r.DefaultAgent },
		c.Global, func(g *GlobalConfig) string { return g.DefaultAgent },
		defaultConfig.Global.DefaultAgent,
	)
}

// GetAutoRestore returns whether to automatically restore sessions
func (c *Config) GetAutoRestore() bool {
	return getBool[RepoConfig, GlobalConfig](
		c.Local, func(r *RepoConfig) *bool { return r.AutoRestore },
		c.Repo, func(r *RepoConfig) *bool { return r.AutoRestore },
		nil, nil, // Global doesn't have AutoRestore
		*defaultConfig.Repo.AutoRestore,
	)
}

// GetMinimalMode returns the preferred minimal mode setting
func (c *Config) GetMinimalMode() bool {
	return getBool[RepoConfig, GlobalConfig](
		c.Local, func(r *RepoConfig) *bool { return r.MinimalMode },
		c.Repo, func(r *RepoConfig) *bool { return r.MinimalMode },
		c.Global, func(g *GlobalConfig) *bool { return g.MinimalMode },
		*defaultConfig.Repo.MinimalMode,
	)
}

// getString provides a generic way to resolve a string value from hierarchical configs.
func getString[T, U any](
	local *T, localFn func(*T) string,
	repo *T, repoFn func(*T) string,
	global *U, globalFn func(*U) string,
	fallback string,
) string {
	if local != nil {
		if val := localFn(local); val != "" {
			return val
		}
	}
	if repo != nil {
		if val := repoFn(repo); val != "" {
			return val
		}
	}
	if global != nil {
		if val := globalFn(global); val != "" {
			return val
		}
	}
	return fallback
}

// getBool provides a generic way to resolve a boolean value from hierarchical configs.
func getBool[T, U any](
	local *T, localFn func(*T) *bool,
	repo *T, repoFn func(*T) *bool,
	global *U, globalFn func(*U) *bool,
	fallback bool,
) bool {
	if local != nil {
		if val := localFn(local); val != nil {
			return *val
		}
	}
	if repo != nil {
		if val := repoFn(repo); val != nil {
			return *val
		}
	}
	if global != nil {
		if val := globalFn(global); val != nil {
			return *val
		}
	}
	return fallback
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
			return defaultConfig.Global, nil
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
