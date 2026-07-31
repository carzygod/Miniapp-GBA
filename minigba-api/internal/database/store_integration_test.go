package database

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minigba-cloud/minigba-api/internal/ids"
	"github.com/minigba-cloud/minigba-api/internal/save"
)

func TestPostgresSaveLifecycle(t *testing.T) {
	store, pool := integrationStore(t)
	ctx := context.Background()
	login := integrationLogin(t, ctx, store, "1")
	key := save.Key{ROMID: strings.Repeat("a", 64), Kind: "battery", Slot: "current"}

	var revision int64
	for i := 1; i <= 11; i++ {
		idempotencyKey, err := ids.NewUUID()
		if err != nil {
			t.Fatal(err)
		}
		digest := fmt.Sprintf("%064x", i)
		result, err := store.Commit(ctx, save.CommitInput{
			UserID: login.UserID, Key: key, BaseRevision: revision, Checksum: digest,
			BlobDigest: digest, SizeBytes: 4, CoreBuildID: "integration-test",
			DeviceID: login.DeviceID, IdempotencyKey: idempotencyKey,
			RequestHash: fmt.Sprintf("%064x", 1000+i),
		})
		if err != nil {
			t.Fatalf("commit revision %d: %v", i, err)
		}
		revision = result.Version.Revision
	}
	if revision != 11 {
		t.Fatalf("current revision = %d, want 11", revision)
	}

	if _, err := pool.Exec(ctx, `UPDATE save_versions SET created_at=now()-interval '31 days' WHERE revision=1`); err != nil {
		t.Fatal(err)
	}
	pruned, err := store.PruneHistory(ctx, 100)
	if err != nil || pruned != 1 {
		t.Fatalf("PruneHistory() = %d, %v; want 1, nil", pruned, err)
	}
	versions, err := store.ListVersions(ctx, login.UserID, key)
	if err != nil || len(versions) != 10 {
		t.Fatalf("ListVersions() count = %d, %v; want 10, nil", len(versions), err)
	}

	if err := store.DeleteHead(ctx, login.UserID, key); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE save_heads SET deleted_at=now()-interval '8 days' WHERE user_id=$1`, login.UserID); err != nil {
		t.Fatal(err)
	}
	purged, err := store.PurgeDeletedHeads(ctx, 100)
	if err != nil || purged != 1 {
		t.Fatalf("PurgeDeletedHeads() = %d, %v; want 1, nil", purged, err)
	}
	var liveReferences int64
	if err := pool.QueryRow(ctx, `SELECT COALESCE(sum(reference_count),0) FROM blobs`).Scan(&liveReferences); err != nil {
		t.Fatal(err)
	}
	if liveReferences != 0 {
		t.Fatalf("live blob references = %d, want 0", liveReferences)
	}

	if _, err := pool.Exec(ctx, `UPDATE idempotency_keys SET expires_at=now()-interval '1 second'`); err != nil {
		t.Fatal(err)
	}
	removedKeys, err := store.DeleteExpiredIdempotency(ctx, 100)
	if err != nil || removedKeys != 11 {
		t.Fatalf("DeleteExpiredIdempotency() = %d, %v; want 11, nil", removedKeys, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE sessions SET expires_at=now()-interval '8 days' WHERE id=$1`, login.SessionID); err != nil {
		t.Fatal(err)
	}
	removedSessions, err := store.DeleteExpiredSessions(ctx, 100)
	if err != nil || removedSessions != 1 {
		t.Fatalf("DeleteExpiredSessions() = %d, %v; want 1, nil", removedSessions, err)
	}
}

func TestPostgresAccountDeletion(t *testing.T) {
	store, pool := integrationStore(t)
	ctx := context.Background()
	login := integrationLogin(t, ctx, store, "2")
	idempotencyKey, err := ids.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	digest := strings.Repeat("f", 64)
	_, err = store.Commit(ctx, save.CommitInput{
		UserID:   login.UserID,
		Key:      save.Key{ROMID: strings.Repeat("b", 64), Kind: "state", Slot: "1"},
		Checksum: digest, BlobDigest: digest, SizeBytes: 32, CoreBuildID: "integration-test",
		DeviceID: login.DeviceID, IdempotencyKey: idempotencyKey, RequestHash: strings.Repeat("e", 64),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.RequestDeletion(ctx, login.UserID); err != nil {
		t.Fatal(err)
	}
	processed, err := store.ProcessDeletionBatch(ctx, 10)
	if err != nil || processed != 1 {
		t.Fatalf("ProcessDeletionBatch() = %d, %v; want 1, nil", processed, err)
	}
	status, err := store.DeletionStatus(ctx, login.UserID)
	if err != nil || status.Status != "complete" {
		t.Fatalf("DeletionStatus() = %q, %v; want complete, nil", status.Status, err)
	}
	var heads int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM save_heads WHERE user_id=$1`, login.UserID).Scan(&heads); err != nil {
		t.Fatal(err)
	}
	if heads != 0 {
		t.Fatalf("remaining save heads = %d, want 0", heads)
	}
}

func integrationStore(t *testing.T) (*Store, *pgxpool.Pool) {
	t.Helper()
	dsn := os.Getenv("MINIGBA_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("MINIGBA_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	adminConfig, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(adminConfig.ConnConfig.Database, "_test") {
		t.Fatalf("integration database name %q must end in _test", adminConfig.ConnConfig.Database)
	}
	admin, err := pgxpool.NewWithConfig(ctx, adminConfig)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	suffix, err := ids.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	schema := "minigba_" + strings.ReplaceAll(suffix, "-", "")
	identifier := pgx.Identifier{schema}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+identifier); err != nil {
		t.Fatal(err)
	}

	testConfig := adminConfig.Copy()
	testConfig.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, testConfig)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = admin.Exec(context.Background(), "DROP SCHEMA "+identifier+" CASCADE")
	})
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	store, err := NewStore(pool, 1<<30)
	if err != nil {
		t.Fatal(err)
	}
	return store, pool
}

func integrationLogin(t *testing.T, ctx context.Context, store *Store, marker string) accountLogin {
	t.Helper()
	clientID, err := ids.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	login, err := store.Login(ctx, strings.Repeat(marker, 64), clientID, "integration device", time.Now().Add(24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	return accountLogin{UserID: login.UserID, DeviceID: login.DeviceID, SessionID: login.SessionID}
}

type accountLogin struct {
	UserID    string
	DeviceID  string
	SessionID string
}
