BINARY_NAME=agentish
BUILD_DIR=build
SRC_DIR=cmd/agentish

.PHONY: build run clean test lint install dev

# Build the binary
build:
	@mkdir -p $(BUILD_DIR)
	go build -o $(BUILD_DIR)/$(BINARY_NAME) $(SRC_DIR)/main.go

# Run from source
run:
	go run $(SRC_DIR)/main.go

# Development with auto-rebuild
dev:
	@which air > /dev/null || (echo "Installing air for live reload..." && go install github.com/cosmtrek/air@latest)
	air

# Install to GOPATH/bin
install:
	go install $(SRC_DIR)/main.go

# Run tests
test:
	go test -v ./...

# Run linter
lint:
	@which golangci-lint > /dev/null || (echo "Installing golangci-lint..." && go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest)
	golangci-lint run

# Clean build artifacts
clean:
	rm -rf $(BUILD_DIR)
	go clean

# Initialize go.sum and download dependencies
deps:
	go mod tidy
	go mod download

# Format code
fmt:
	go fmt ./...

# Generate files (if needed in future)
generate:
	go generate ./...

# Build for multiple platforms
build-all:
	@mkdir -p $(BUILD_DIR)
	GOOS=linux GOARCH=amd64 go build -o $(BUILD_DIR)/$(BINARY_NAME)-linux-amd64 $(SRC_DIR)/main.go
	GOOS=darwin GOARCH=amd64 go build -o $(BUILD_DIR)/$(BINARY_NAME)-darwin-amd64 $(SRC_DIR)/main.go
	GOOS=darwin GOARCH=arm64 go build -o $(BUILD_DIR)/$(BINARY_NAME)-darwin-arm64 $(SRC_DIR)/main.go
	GOOS=windows GOARCH=amd64 go build -o $(BUILD_DIR)/$(BINARY_NAME)-windows-amd64.exe $(SRC_DIR)/main.go