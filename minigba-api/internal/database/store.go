package database

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minigba-cloud/minigba-api/internal/account"
	"github.com/minigba-cloud/minigba-api/internal/ids"
	"github.com/minigba-cloud/minigba-api/internal/save"
)

type Store struct {
	pool         *pgxpool.Pool
	maxUserBytes int64
}

func NewStore(pool *pgxpool.Pool, maxUserBytes int64) (*Store, error) {
	if pool == nil {
		return nil, errors.New("database pool is required")
	}
	if maxUserBytes <= 0 {
		return nil, errors.New("user quota must be positive")
	}
	return &Store{pool: pool, maxUserBytes: maxUserBytes}, nil
}

func (s *Store) Login(ctx context.Context, subjectHash, clientDeviceID, displayName string, expiresAt time.Time) (account.LoginResult, error) {
	userID, err := ids.NewUUID()
	if err != nil {
		return account.LoginResult{}, err
	}
	deviceID, err := ids.NewUUID()
	if err != nil {
		return account.LoginResult{}, err
	}
	sessionID, err := ids.NewUUID()
	if err != nil {
		return account.LoginResult{}, err
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return account.LoginResult{}, fmt.Errorf("begin login: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var status string
	err = tx.QueryRow(ctx, `
		INSERT INTO users(id, wechat_subject_hash, status) VALUES($1,$2,'active')
		ON CONFLICT (wechat_subject_hash) DO UPDATE SET updated_at=now()
		RETURNING id,status`, userID, subjectHash).Scan(&userID, &status)
	if err != nil {
		return account.LoginResult{}, fmt.Errorf("upsert user: %w", err)
	}
	if status != "active" {
		return account.LoginResult{}, account.ErrUnavailable
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO devices(id,user_id,client_device_id,display_name,last_seen_at)
		VALUES($1,$2,$3,$4,now())
		ON CONFLICT (user_id,client_device_id) DO UPDATE
		SET display_name=EXCLUDED.display_name,last_seen_at=now()
		RETURNING id`, deviceID, userID, clientDeviceID, displayName).Scan(&deviceID)
	if err != nil {
		return account.LoginResult{}, fmt.Errorf("upsert device: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO sessions(id,user_id,device_id,expires_at) VALUES($1,$2,$3,$4)`, sessionID, userID, deviceID, expiresAt); err != nil {
		return account.LoginResult{}, fmt.Errorf("create session: %w", err)
	}
	if err := audit(ctx, tx, userID, "auth.login", "session", sessionID, map[string]any{"deviceId": deviceID}); err != nil {
		return account.LoginResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return account.LoginResult{}, fmt.Errorf("commit login: %w", err)
	}
	return account.LoginResult{UserID: userID, DeviceID: deviceID, SessionID: sessionID}, nil
}

func (s *Store) SessionActive(ctx context.Context, userID, sessionID string) (bool, error) {
	var active bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
		WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='active'
	)`, sessionID, userID).Scan(&active)
	if err != nil {
		return false, fmt.Errorf("check session: %w", err)
	}
	return active, nil
}

func (s *Store) RevokeSession(ctx context.Context, userID, sessionID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin session revocation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(ctx, `UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND user_id=$2`, sessionID, userID)
	if err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}
	if err := audit(ctx, tx, userID, "auth.logout", "session", sessionID, nil); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) RefreshSession(ctx context.Context, userID, sessionID string, expiresAt time.Time) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin session refresh: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	tag, err := tx.Exec(ctx, `UPDATE sessions SET expires_at=$3 WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now()`, sessionID, userID, expiresAt)
	if err != nil {
		return fmt.Errorf("refresh session: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return account.ErrUnavailable
	}
	if err := audit(ctx, tx, userID, "auth.refresh", "session", sessionID, map[string]any{"expiresAt": expiresAt}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) RequestDeletion(ctx context.Context, userID string) (account.DeletionStatus, error) {
	jobID, err := ids.NewUUID()
	if err != nil {
		return account.DeletionStatus{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return account.DeletionStatus{}, fmt.Errorf("begin account deletion: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	tag, err := tx.Exec(ctx, `UPDATE users SET status='deleting',updated_at=now() WHERE id=$1 AND status='active'`, userID)
	if err != nil {
		return account.DeletionStatus{}, fmt.Errorf("mark account deleting: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return account.DeletionStatus{}, account.ErrUnavailable
	}
	if _, err := tx.Exec(ctx, `UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1`, userID); err != nil {
		return account.DeletionStatus{}, fmt.Errorf("revoke account sessions: %w", err)
	}
	var result account.DeletionStatus
	if err := tx.QueryRow(ctx, `INSERT INTO deletion_jobs(id,user_id,status) VALUES($1,$2,'pending') RETURNING id,status,attempts,created_at,updated_at`, jobID, userID).Scan(&result.JobID, &result.Status, &result.Attempts, &result.CreatedAt, &result.UpdatedAt); err != nil {
		return account.DeletionStatus{}, fmt.Errorf("queue account deletion: %w", err)
	}
	if err := audit(ctx, tx, userID, "account.delete.request", "account", userID, map[string]any{"jobId": jobID}); err != nil {
		return account.DeletionStatus{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return account.DeletionStatus{}, fmt.Errorf("commit account deletion: %w", err)
	}
	return result, nil
}

func (s *Store) DeletionStatus(ctx context.Context, userID string) (account.DeletionStatus, error) {
	var result account.DeletionStatus
	err := s.pool.QueryRow(ctx, `SELECT id,status,attempts,created_at,updated_at FROM deletion_jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`, userID).Scan(&result.JobID, &result.Status, &result.Attempts, &result.CreatedAt, &result.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return account.DeletionStatus{}, account.ErrUnavailable
	}
	if err != nil {
		return account.DeletionStatus{}, fmt.Errorf("read deletion status: %w", err)
	}
	return result, nil
}

func (s *Store) Commit(ctx context.Context, input save.CommitInput) (save.CommitResult, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return save.CommitResult{}, fmt.Errorf("begin save commit: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	result, err := s.commitTx(ctx, tx, input)
	if err != nil {
		return save.CommitResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return save.CommitResult{}, fmt.Errorf("commit save transaction: %w", err)
	}
	return result, nil
}

func (s *Store) commitTx(ctx context.Context, tx pgx.Tx, input save.CommitInput) (save.CommitResult, error) {
	// Serialize identical idempotency keys even before their rows become visible.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, input.UserID+":"+input.IdempotencyKey); err != nil {
		return save.CommitResult{}, fmt.Errorf("lock idempotency key: %w", err)
	}
	var storedHash string
	var storedBody []byte
	err := tx.QueryRow(ctx, `SELECT request_hash,response_body FROM idempotency_keys WHERE user_id=$1 AND key=$2 AND expires_at>now() FOR UPDATE`, input.UserID, input.IdempotencyKey).Scan(&storedHash, &storedBody)
	if err == nil {
		if storedHash != input.RequestHash {
			return save.CommitResult{}, save.ErrIdempotencyKey
		}
		var result save.CommitResult
		if err := json.Unmarshal(storedBody, &result); err != nil {
			return save.CommitResult{}, fmt.Errorf("decode idempotency response: %w", err)
		}
		result.Replay = true
		return result, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return save.CommitResult{}, fmt.Errorf("read idempotency key: %w", err)
	}

	headID, err := ids.NewUUID()
	if err != nil {
		return save.CommitResult{}, err
	}
	var currentRevision int64
	var deletedAt *time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO save_heads(id,user_id,rom_id,kind,slot) VALUES($1,$2,$3,$4,$5)
		ON CONFLICT (user_id,rom_id,kind,slot) DO UPDATE SET updated_at=save_heads.updated_at
		RETURNING id,current_revision,deleted_at`, headID, input.UserID, input.ROMID, input.Kind, input.Slot).Scan(&headID, &currentRevision, &deletedAt)
	if err != nil {
		return save.CommitResult{}, fmt.Errorf("lock save head: %w", err)
	}

	var current save.Head
	if currentRevision > 0 && deletedAt == nil {
		current, err = scanHead(tx.QueryRow(ctx, headQuery+` WHERE h.id=$1 AND v.revision=h.current_revision`, headID))
		if err != nil {
			return save.CommitResult{}, fmt.Errorf("read current save: %w", err)
		}
	}
	if deletedAt == nil && currentRevision != input.BaseRevision {
		if current.Checksum == input.Checksum {
			result := save.CommitResult{Version: versionFromHead(current)}
			if err := storeIdempotency(ctx, tx, input.UserID, input.IdempotencyKey, input.RequestHash, result); err != nil {
				return save.CommitResult{}, err
			}
			return result, nil
		}
		return save.CommitResult{}, &save.ConflictError{Current: current}
	}
	if deletedAt != nil && input.BaseRevision != 0 {
		return save.CommitResult{}, &save.ConflictError{Current: current}
	}
	// The user-row lock makes the aggregate quota check correct across different save heads.
	var userActive bool
	if err := tx.QueryRow(ctx, `SELECT status='active' FROM users WHERE id=$1 FOR UPDATE`, input.UserID).Scan(&userActive); err != nil {
		return save.CommitResult{}, fmt.Errorf("lock save owner: %w", err)
	}
	if !userActive {
		return save.CommitResult{}, account.ErrUnavailable
	}

	var usedBytes int64
	if err := tx.QueryRow(ctx, `SELECT COALESCE(SUM(v.size_bytes),0) FROM save_versions v JOIN save_heads h ON h.id=v.save_head_id WHERE h.user_id=$1 AND v.deleted_at IS NULL`, input.UserID).Scan(&usedBytes); err != nil {
		return save.CommitResult{}, fmt.Errorf("calculate user quota: %w", err)
	}
	if usedBytes > s.maxUserBytes-input.SizeBytes {
		return save.CommitResult{}, save.ErrQuotaExceeded
	}
	blobTag, err := tx.Exec(ctx, `
		INSERT INTO blobs(digest,size_bytes,reference_count) VALUES($1,$2,1)
		ON CONFLICT (digest) DO UPDATE SET reference_count=blobs.reference_count+1,delete_after=NULL
		WHERE blobs.size_bytes=EXCLUDED.size_bytes`, input.BlobDigest, input.SizeBytes)
	if err != nil {
		return save.CommitResult{}, fmt.Errorf("reference blob: %w", err)
	}
	if blobTag.RowsAffected() != 1 {
		return save.CommitResult{}, errors.New("blob digest already exists with a different size")
	}

	revision := currentRevision + 1
	versionID, err := ids.NewUUID()
	if err != nil {
		return save.CommitResult{}, err
	}
	var createdAt time.Time
	if err := tx.QueryRow(ctx, `
		INSERT INTO save_versions(id,save_head_id,revision,checksum,blob_digest,size_bytes,core_build_id,device_id)
		VALUES($1,$2,$3,$4,$5,$6,$7,NULLIF($8,'')::uuid) RETURNING created_at`,
		versionID, headID, revision, input.Checksum, input.BlobDigest, input.SizeBytes, input.CoreBuildID, input.DeviceID).Scan(&createdAt); err != nil {
		return save.CommitResult{}, fmt.Errorf("insert save version: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE save_heads SET current_revision=$2,deleted_at=NULL,updated_at=$3 WHERE id=$1`, headID, revision, createdAt); err != nil {
		return save.CommitResult{}, fmt.Errorf("update save head: %w", err)
	}
	result := save.CommitResult{Version: save.Version{Key: input.Key, Revision: revision, Checksum: input.Checksum, SizeBytes: input.SizeBytes, CoreBuildID: input.CoreBuildID, DeviceID: input.DeviceID, CreatedAt: createdAt}}
	if err := storeIdempotency(ctx, tx, input.UserID, input.IdempotencyKey, input.RequestHash, result); err != nil {
		return save.CommitResult{}, err
	}
	if err := audit(ctx, tx, input.UserID, "save.commit", "save", input.ROMID+"/"+input.Kind+"/"+input.Slot, map[string]any{"revision": revision, "checksum": input.Checksum, "sizeBytes": input.SizeBytes}); err != nil {
		return save.CommitResult{}, err
	}
	return result, nil
}

func (s *Store) Restore(ctx context.Context, input save.RestoreInput) (save.CommitResult, error) {
	source, err := s.GetContent(ctx, input.UserID, input.Key, input.SourceRevision)
	if err != nil {
		return save.CommitResult{}, err
	}
	return s.Commit(ctx, save.CommitInput{
		UserID: input.UserID, Key: input.Key, BaseRevision: input.BaseRevision,
		Checksum: source.Checksum, BlobDigest: source.BlobDigest, SizeBytes: source.SizeBytes,
		CoreBuildID: source.CoreBuildID, DeviceID: input.DeviceID,
		IdempotencyKey: input.IdempotencyKey, RequestHash: input.RequestHash,
	})
}

const headQuery = `SELECT h.rom_id,h.kind,h.slot,h.current_revision,v.checksum,v.size_bytes,v.core_build_id,COALESCE(d.display_name,''),h.updated_at
	FROM save_heads h JOIN save_versions v ON v.save_head_id=h.id LEFT JOIN devices d ON d.id=v.device_id`

type rowScanner interface{ Scan(...any) error }

func scanHead(row rowScanner) (save.Head, error) {
	var result save.Head
	err := row.Scan(&result.ROMID, &result.Kind, &result.Slot, &result.CurrentRevision, &result.Checksum, &result.SizeBytes, &result.CoreBuildID, &result.DeviceName, &result.UpdatedAt)
	return result, err
}

func versionFromHead(head save.Head) save.Version {
	return save.Version{Key: head.Key, Revision: head.CurrentRevision, Checksum: head.Checksum, SizeBytes: head.SizeBytes, CoreBuildID: head.CoreBuildID, DeviceName: head.DeviceName, CreatedAt: head.UpdatedAt}
}

func (s *Store) List(ctx context.Context, userID, romID string) ([]save.Head, error) {
	query := headQuery + ` WHERE h.user_id=$1 AND h.deleted_at IS NULL AND v.revision=h.current_revision`
	args := []any{userID}
	if romID != "" {
		query += ` AND h.rom_id=$2`
		args = append(args, romID)
	}
	query += ` ORDER BY h.updated_at DESC,h.rom_id,h.kind,h.slot`
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list saves: %w", err)
	}
	defer rows.Close()
	result := make([]save.Head, 0)
	for rows.Next() {
		head, err := scanHead(rows)
		if err != nil {
			return nil, fmt.Errorf("scan save: %w", err)
		}
		result = append(result, head)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate saves: %w", err)
	}
	return result, nil
}

func (s *Store) ListVersions(ctx context.Context, userID string, key save.Key) ([]save.Version, error) {
	rows, err := s.pool.Query(ctx, `SELECT h.rom_id,h.kind,h.slot,v.revision,v.checksum,v.size_bytes,v.core_build_id,COALESCE(v.device_id::text,''),COALESCE(d.display_name,''),v.created_at
		FROM save_heads h JOIN save_versions v ON v.save_head_id=h.id LEFT JOIN devices d ON d.id=v.device_id
		WHERE h.user_id=$1 AND h.rom_id=$2 AND h.kind=$3 AND h.slot=$4 AND h.deleted_at IS NULL AND v.deleted_at IS NULL
		ORDER BY v.revision DESC`, userID, key.ROMID, key.Kind, key.Slot)
	if err != nil {
		return nil, fmt.Errorf("list save versions: %w", err)
	}
	defer rows.Close()
	versions := make([]save.Version, 0)
	for rows.Next() {
		var version save.Version
		if err := rows.Scan(&version.ROMID, &version.Kind, &version.Slot, &version.Revision, &version.Checksum, &version.SizeBytes, &version.CoreBuildID, &version.DeviceID, &version.DeviceName, &version.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan save version: %w", err)
		}
		versions = append(versions, version)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate save versions: %w", err)
	}
	if len(versions) == 0 {
		return nil, save.ErrNotFound
	}
	return versions, nil
}

func (s *Store) GetContent(ctx context.Context, userID string, key save.Key, revision int64) (save.Content, error) {
	query := `SELECT h.rom_id,h.kind,h.slot,v.revision,v.checksum,v.size_bytes,v.core_build_id,COALESCE(v.device_id::text,''),COALESCE(d.display_name,''),v.created_at,v.blob_digest
		FROM save_heads h JOIN save_versions v ON v.save_head_id=h.id LEFT JOIN devices d ON d.id=v.device_id
		WHERE h.user_id=$1 AND h.rom_id=$2 AND h.kind=$3 AND h.slot=$4 AND h.deleted_at IS NULL AND v.deleted_at IS NULL`
	args := []any{userID, key.ROMID, key.Kind, key.Slot}
	if revision == 0 {
		query += ` AND v.revision=h.current_revision`
	} else {
		query += ` AND v.revision=$5`
		args = append(args, revision)
	}
	var result save.Content
	err := s.pool.QueryRow(ctx, query, args...).Scan(&result.ROMID, &result.Kind, &result.Slot, &result.Revision, &result.Checksum, &result.SizeBytes, &result.CoreBuildID, &result.DeviceID, &result.DeviceName, &result.CreatedAt, &result.BlobDigest)
	if errors.Is(err, pgx.ErrNoRows) {
		return save.Content{}, save.ErrNotFound
	}
	if err != nil {
		return save.Content{}, fmt.Errorf("read save content: %w", err)
	}
	return result, nil
}

func (s *Store) DeleteHead(ctx context.Context, userID string, key save.Key) error {
	return s.delete(ctx, userID, `rom_id=$2 AND kind=$3 AND slot=$4`, []any{key.ROMID, key.Kind, key.Slot}, "save.delete", key.ROMID+"/"+key.Kind+"/"+key.Slot)
}

func (s *Store) DeleteROM(ctx context.Context, userID, romID string) error {
	return s.delete(ctx, userID, `rom_id=$2`, []any{romID}, "rom-saves.delete", romID)
}

func (s *Store) delete(ctx context.Context, userID, predicate string, params []any, action, target string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	args := []any{userID}
	args = append(args, params...)
	tag, err := tx.Exec(ctx, `UPDATE save_heads SET deleted_at=now(),updated_at=now() WHERE user_id=$1 AND deleted_at IS NULL AND `+predicate, args...)
	if err != nil {
		return fmt.Errorf("delete save: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return save.ErrNotFound
	}
	if err := audit(ctx, tx, userID, action, "save", target, map[string]any{"heads": tag.RowsAffected()}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit save deletion: %w", err)
	}
	return nil
}

func storeIdempotency(ctx context.Context, tx pgx.Tx, userID, key, requestHash string, result save.CommitResult) error {
	body, err := json.Marshal(result)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO idempotency_keys(user_id,key,request_hash,response_status,response_body,expires_at) VALUES($1,$2,$3,200,$4,now()+interval '24 hours')`, userID, key, requestHash, body)
	if err != nil {
		return fmt.Errorf("store idempotency result: %w", err)
	}
	return nil
}

func audit(ctx context.Context, tx pgx.Tx, userID, action, targetType, targetID string, metadata map[string]any) error {
	id, err := ids.NewUUID()
	if err != nil {
		return err
	}
	if metadata == nil {
		metadata = map[string]any{}
	}
	body, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO audit_events(id,user_id,action,target_type,target_id,metadata) VALUES($1,$2,$3,$4,$5,$6)`, id, userID, action, targetType, targetID, body)
	if err != nil {
		return fmt.Errorf("write audit event: %w", err)
	}
	return nil
}
