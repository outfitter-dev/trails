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
			expected: "claude",
		},
		{
			name: "Empty configs fallback",
			config: &Config{
				Global: &GlobalConfig{DefaultAgent: ""},
				Repo:   &RepoConfig{DefaultAgent: ""},
				Local:  &RepoConfig{DefaultAgent: ""},
			},
			expected: "claude",
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
			name: "Local override true",
			config: &Config{
				Repo:  &RepoConfig{AutoRestore: false},
				Local: &RepoConfig{AutoRestore: true},
			},
			expected: true,
		},
		{
			name: "Local override false",
			config: &Config{
				Repo:  &RepoConfig{AutoRestore: true},
				Local: &RepoConfig{AutoRestore: false},
			},
			expected: false,
		},
		{
			name: "Repo config true",
			config: &Config{
				Repo:  &RepoConfig{AutoRestore: true},
				Local: nil,
			},
			expected: true,
		},
		{
			name: "Repo config false",
			config: &Config{
				Repo:  &RepoConfig{AutoRestore: false},
				Local: nil,
			},
			expected: false,
		},
		{
			name: "Default to true",
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
