# Changelog

All notable changes to Trails will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - In Development

### Added
- Protocol-based architecture separating UI from core business logic
- Command/Event messaging system for all UI-Core communication
- BubbleTea-based TUI implementation
- Security layer with authentication and rate-limiting
- Event sourcing for state management
- Comprehensive architecture documentation

### Changed
- Complete refactor from tightly coupled to protocol-based architecture
- Migrated from gocui to BubbleTea for better architecture
- Session management now runs in a separate core engine

### Security
- Added authentication layer for protocol commands
- Implemented rate limiting per session
- Added audit logging for all operations
- Input validation and sanitization

### Documentation
- Comprehensive protocol-based architecture design document
- Security and enhancement addendum
- Implementation roadmap and migration guide