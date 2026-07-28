# MiniGBA API

MiniGBA API is the standalone Go service for WeChat authentication, versioned cloud saves, conflict detection, data export, and account deletion.

## Runtime

- Ubuntu 22.04 bare metal.
- Go binary managed by systemd.
- PostgreSQL 14+ installed directly on the host.
- Immutable, content-addressed save blobs on a dedicated filesystem.
- Nginx reverse proxy on the public high port.
- No container or virtual machine deployment workflow.

## Features

- WeChat code exchange without exposing AppSecret to clients.
- Short-lived HMAC access tokens, refresh, logout, and revocable sessions.
- Binary save uploads with SHA-256, `If-Match` revisions, and idempotency keys.
- Battery, manual state, and auto-state version history.
- Cross-device conflict responses that never silently overwrite data.
- Atomic filesystem blob commits and delayed orphan cleanup.
- Queryable account deletion jobs, background erasure, delayed blob collection, and append-only completion audit.
- Liveness, readiness, and service information endpoints.

## Repository layout

```text
cmd/api/              Service entry point and maintenance commands
internal/auth/        WeChat login, sessions, and token handling
internal/config/      Environment and credential-file configuration
internal/httpapi/     Routes, middleware, request/response contracts
internal/save/        Save domain and revision rules
internal/database/    PostgreSQL repositories, migrations, and maintenance
internal/blob/        Content-addressed filesystem storage
deploy/               Ubuntu 22.04 systemd and Nginx files
scripts/              Build, test, release, backup, and restore scripts
```

## Local development

Install PostgreSQL directly on Ubuntu 22.04, create a development database, then:

```bash
cp .env.example .env
go mod download
go run ./cmd/api migrate
go run ./cmd/api serve
```

The development authentication endpoint is disabled unless explicitly enabled outside production.

## Test

```bash
go test -race ./...
go vet ./...
```

Integration tests use a dedicated PostgreSQL database on the Ubuntu 22.04 test host. They do not use containers and never connect to production.
Set `MINIGBA_TEST_DATABASE_URL` to a database whose name ends in `_test`; each test creates and removes an isolated schema.

## Deploy

See `deploy/README.md`. Production releases are immutable directories under `/opt/minigba/releases`, selected through `/opt/minigba/current`, and run as the unprivileged `minigba` system user.

## Security

- The API never accepts ROM uploads.
- User-provided names never become filesystem paths.
- Secrets are read from permission-restricted files.
- Logs exclude tokens, WeChat identifiers, save contents, and local secret paths.
