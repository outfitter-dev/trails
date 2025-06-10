package session

// EnvironmentID represents a container-use environment identifier
type EnvironmentID string

// String returns the string representation of the environment ID
func (e EnvironmentID) String() string {
	return string(e)
}

// IsEmpty returns true if the environment ID is empty
func (e EnvironmentID) IsEmpty() bool {
	return string(e) == ""
}

// NewEnvironmentID creates a new environment ID from a string
func NewEnvironmentID(id string) EnvironmentID {
	return EnvironmentID(id)
}
