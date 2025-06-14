// Package protocol provides type-safe helpers for extracting payloads.
// These generic functions eliminate runtime type assertion panics
// by returning errors when type mismatches occur.
package protocol

import "fmt"

// GetTypedPayload safely extracts a typed payload from a command.
// Returns an error if the payload is not of the expected type T.
// This prevents runtime panics from failed type assertions.
//
// Example:
//
//	payload, err := GetTypedPayload[CreateSessionCommand](cmd)
//	if err != nil {
//		return fmt.Errorf("invalid create session command: %w", err)
//	}
func GetTypedPayload[T any](cmd Command) (T, error) {
	var zero T
	payload, ok := cmd.Payload.(T)
	if !ok {
		return zero, fmt.Errorf("payload is not of type %T, got %T", zero, cmd.Payload)
	}
	return payload, nil
}

// GetTypedEventPayload safely extracts a typed payload from an event.
// Returns an error if the payload is not of the expected type T.
// Use this for basic Event types without metadata.
func GetTypedEventPayload[T any](event Event) (T, error) {
	var zero T
	payload, ok := event.Payload.(T)
	if !ok {
		return zero, fmt.Errorf("payload is not of type %T, got %T", zero, event.Payload)
	}
	return payload, nil
}

// GetTypedEnhancedEventPayload safely extracts a typed payload from an enhanced event.
// Returns an error if the payload is not of the expected type T.
// Use this for EnhancedEvent types that include metadata.
func GetTypedEnhancedEventPayload[T any](event EnhancedEvent) (T, error) {
	var zero T
	payload, ok := event.Payload.(T)
	if !ok {
		return zero, fmt.Errorf("payload is not of type %T, got %T", zero, event.Payload)
	}
	return payload, nil
}

// MustGetTypedPayload extracts a typed payload from a command, panicking on type mismatch.
// Use this only when you are absolutely certain of the payload type,
// such as in tests or after prior validation.
//
// WARNING: This will panic if the type assertion fails.
func MustGetTypedPayload[T any](cmd Command) T {
	payload, err := GetTypedPayload[T](cmd)
	if err != nil {
		panic(err)
	}
	return payload
}

// MustGetTypedEventPayload extracts a typed payload from an event, panicking on type mismatch.
// Use this only when you are absolutely certain of the payload type.
//
// WARNING: This will panic if the type assertion fails.
func MustGetTypedEventPayload[T any](event Event) T {
	payload, err := GetTypedEventPayload[T](event)
	if err != nil {
		panic(err)
	}
	return payload
}

// MustGetTypedEnhancedEventPayload extracts a typed payload from an enhanced event, panicking on type mismatch.
// Use this only when you are absolutely certain of the payload type.
//
// WARNING: This will panic if the type assertion fails.
func MustGetTypedEnhancedEventPayload[T any](event EnhancedEvent) T {
	payload, err := GetTypedEnhancedEventPayload[T](event)
	if err != nil {
		panic(err)
	}
	return payload
}