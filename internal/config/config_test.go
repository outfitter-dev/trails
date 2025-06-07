package config

import (
	"testing"
)

func TestGetDefaultAgent(t *testing.T) {
	tests := []struct {
		name     string
		config   *Config
		expected string
	}{
		{
			name: "Local override",
			config: &Config{
				Global: &GlobalConfig{DefaultAgent: "global-agent"},
				Repo:   &RepoConfig{DefaultAgent: "repo-agent"},
				Local:  &RepoConfig{DefaultAgent: "local-agent"},
			},
			expected: "local-agent",
		},
		{
			name: "Repo config",
			config: &Config{
				Global: &GlobalConfig{DefaultAgent: "global-agent"},
				Repo:   &RepoConfig{DefaultAgent: "repo-agent"},
				Local:  nil,
			},
			expected: "repo-agent",
		},
		{
			name: "Global config",
			config: &Config{
				Global: &GlobalConfig{DefaultAgent: "global-agent"},
				Repo:   nil,
				Local:  nil,
			},
			expected: "global-agent",
		},
		{
			name: "Fallback to default",
			config: &Config{
				Global: nil,
				Repo:   nil,
				Local:  nil,
			},
			expected: "codex",
		},
		{
			name: "Empty configs fallback",
			config: &Config{
				Global: &GlobalConfig{DefaultAgent: ""},
				Repo:   &RepoConfig{DefaultAgent: ""},
				Local:  &RepoConfig{DefaultAgent: ""},
			},
			expected: "codex",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.config.GetDefaultAgent()
			if result != tt.expected {
				t.Errorf("GetDefaultAgent() = %v, want %v", result, tt.expected)
			}
		})
	}
}

func TestGetAutoRestore(t *testing.T) {
	tests := []struct {
		name     string
		config   *Config
		expected bool
	}{
		{
			name: "local-override-true",
			config: &Config{
				Repo:  &RepoConfig{AutoRestore: boolPtr(false)},
				Local: &RepoConfig{AutoRestore: boolPtr(true)},
			},
			expected: true,
		},
		{
			name: "local-override-false",
			config: &Config{
				Repo:  &RepoConfig{AutoRestore: boolPtr(true)},
				Local: &RepoConfig{AutoRestore: boolPtr(false)},
			},
			expected: false,
		},
		{
			name: "repo-config-true",
			config: &Config{
				Repo:  &RepoConfig{AutoRestore: boolPtr(true)},
				Local: nil,
			},
			expected: true,
		},
		{
			name: "repo-config-false",
			config: &Config{
				Repo:  &RepoConfig{AutoRestore: boolPtr(false)},
				Local: nil,
			},
			expected: false,
		},
		{
			name: "default-to-true",
			config: &Config{
				Repo:  nil,
				Local: nil,
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.config.GetAutoRestore()
			if result != tt.expected {
				t.Errorf("GetAutoRestore() = %v, want %v", result, tt.expected)
			}
		})
	}
}

func TestGetMinimalMode(t *testing.T) {
	tests := []struct {
		name     string
		config   *Config
		expected bool
	}{
		{
			name: "local-override-true",
			config: &Config{
				Global: &GlobalConfig{MinimalMode: boolPtr(false)},
				Repo:   &RepoConfig{MinimalMode: boolPtr(false)},
				Local:  &RepoConfig{MinimalMode: boolPtr(true)},
			},
			expected: true,
		},
		{
			name: "local-override-false",
			config: &Config{
				Global: &GlobalConfig{MinimalMode: boolPtr(true)},
				Repo:   &RepoConfig{MinimalMode: boolPtr(true)},
				Local:  &RepoConfig{MinimalMode: boolPtr(false)},
			},
			expected: false,
		},
		{
			name: "repo-config-true",
			config: &Config{
				Global: &GlobalConfig{MinimalMode: boolPtr(false)},
				Repo:   &RepoConfig{MinimalMode: boolPtr(true)},
				Local:  nil,
			},
			expected: true,
		},
		{
			name: "global-config-true",
			config: &Config{
				Global: &GlobalConfig{MinimalMode: boolPtr(true)},
				Repo:   nil,
				Local:  nil,
			},
			expected: true,
		},
		{
			name: "default-to-false",
			config: &Config{
				Global: nil,
				Repo:   nil,
				Local:  nil,
			},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.config.GetMinimalMode()
			if result != tt.expected {
				t.Errorf("GetMinimalMode() = %v, want %v", result, tt.expected)
			}
		})
	}
}
