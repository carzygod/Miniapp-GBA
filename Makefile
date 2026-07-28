.PHONY: build test vet fmt

build:
	go build -trimpath -ldflags="-s -w" -o build/minigba-api ./cmd/api

test:
	go test -race ./...

vet:
	go vet ./...

fmt:
	gofmt -w cmd internal

