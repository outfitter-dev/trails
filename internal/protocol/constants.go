package protocol

import "time"

// Protocol constants
const (
	// ULIDLength is the expected length of a ULID string
	ULIDLength = 26
	
	// MaxSessionNameLength is the maximum allowed session name length
	MaxSessionNameLength = 50
	
	// DefaultRateLimit is the default rate limit per session (requests per second)
	DefaultRateLimit = 10
	
	// DefaultRateBurst is the default burst size for rate limiting
	DefaultRateBurst = 20
	
	// DefaultCleanupInterval is how often to clean up old rate limiters
	DefaultCleanupInterval = 5 * time.Minute
	
	// MaxEventTags is the maximum number of tags allowed in event metadata
	MaxEventTags = 20
	
	// MaxTagKeyLength is the maximum length of an event tag key
	MaxTagKeyLength = 50
	
	// MaxTagValueLength is the maximum length of an event tag value
	MaxTagValueLength = 200
)

// ULID character set (Crockford's base32)
const ULIDCharset = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// Supported agents
var SupportedAgents = []string{"claude", "gpt-4", "custom"}

// Default security settings
const (
	// DefaultTokenExpiry is the default auth token expiry duration
	DefaultTokenExpiry = 24 * time.Hour
	
	// MinPasswordLength for user authentication
	MinPasswordLength = 8
	
	// MaxLoginAttempts before account lockout
	MaxLoginAttempts = 5
	
	// AccountLockoutDuration in seconds
	AccountLockoutDuration = 15 * time.Minute
)