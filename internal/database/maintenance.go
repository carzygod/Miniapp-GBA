package database

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Store) ProcessDeletionBatch(ctx context.Context, limit int) (int, error) {
	if limit < 1 || limit > 100 {
		return 0, errors.New("deletion batch limit must be between 1 and 100")
	}
	processed := 0
	for processed < limit {
		done, err := s.processOneDeletion(ctx)
		if err != nil {
			return processed, err
		}
		if !done {
			break
		}
		processed++
	}
	return processed, nil
}

func (s *Store) processOneDeletion(ctx context.Context) (bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("begin deletion job: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var jobID, userID string
	err = tx.QueryRow(ctx, `SELECT id,user_id FROM deletion_jobs WHERE status='pending' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`).Scan(&jobID, &userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("claim deletion job: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE deletion_jobs SET status='running',attempts=attempts+1,last_error=NULL,updated_at=now() WHERE id=$1`, jobID); err != nil {
		return false, fmt.Errorf("start deletion job: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		WITH removed AS (
			DELETE FROM save_versions v USING save_heads h WHERE v.save_head_id=h.id AND h.user_id=$1 RETURNING v.blob_digest
		), counts AS (SELECT blob_digest,count(*)::bigint AS references FROM removed GROUP BY blob_digest)
		UPDATE blobs b SET reference_count=GREATEST(0,b.reference_count-c.references),
			delete_after=CASE WHEN b.reference_count-c.references<=0 THEN now()+interval '7 days' ELSE b.delete_after END
		FROM counts c WHERE b.digest=c.blob_digest`, userID); err != nil {
		return false, fmt.Errorf("release account blobs: %w", err)
	}
	statements := []string{
		`DELETE FROM save_heads WHERE user_id=$1`,
		`DELETE FROM idempotency_keys WHERE user_id=$1`,
		`DELETE FROM sessions WHERE user_id=$1`,
		`DELETE FROM devices WHERE user_id=$1`,
		`DELETE FROM audit_events WHERE user_id=$1`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(ctx, statement, userID); err != nil {
			return false, fmt.Errorf("remove account data: %w", err)
		}
	}
	tombstone := fmt.Sprintf("%x", sha256.Sum256([]byte("minigba-deleted:"+jobID)))
	if _, err := tx.Exec(ctx, `UPDATE users SET wechat_subject_hash=$2,status='deleted',deleted_at=now(),updated_at=now() WHERE id=$1`, userID, tombstone); err != nil {
		return false, fmt.Errorf("anonymize account: %w", err)
	}
	if err := audit(ctx, tx, userID, "account.delete.complete", "account", userID, map[string]any{"jobId": jobID}); err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx, `UPDATE deletion_jobs SET status='complete',updated_at=now() WHERE id=$1`, jobID); err != nil {
		return false, fmt.Errorf("complete deletion job: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit deletion job: %w", err)
	}
	return true, nil
}

func (s *Store) DueBlobDigests(ctx context.Context, limit int) ([]string, error) {
	if limit < 1 || limit > 1000 {
		return nil, errors.New("blob batch limit must be between 1 and 1000")
	}
	rows, err := s.pool.Query(ctx, `SELECT digest FROM blobs WHERE reference_count=0 AND delete_after<=now() ORDER BY delete_after LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("list due blobs: %w", err)
	}
	defer rows.Close()
	var result []string
	for rows.Next() {
		var digest string
		if err := rows.Scan(&digest); err != nil {
			return nil, err
		}
		result = append(result, digest)
	}
	return result, rows.Err()
}

func (s *Store) ForgetBlob(ctx context.Context, digest string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM blobs WHERE digest=$1 AND reference_count=0 AND delete_after<=now()`, digest)
	if err != nil {
		return fmt.Errorf("forget blob: %w", err)
	}
	return nil
}

func (s *Store) BlobDue(ctx context.Context, digest string) (bool, error) {
	var due bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM blobs WHERE digest=$1 AND reference_count=0 AND delete_after<=now())`, digest).Scan(&due); err != nil {
		return false, fmt.Errorf("recheck due blob: %w", err)
	}
	return due, nil
}

func (s *Store) ResetStaleDeletionJobs(ctx context.Context, olderThan time.Duration) (int64, error) {
	if olderThan <= 0 {
		return 0, errors.New("stale deletion duration must be positive")
	}
	tag, err := s.pool.Exec(ctx, `UPDATE deletion_jobs SET status='pending',updated_at=now(),last_error='worker lease expired' WHERE status='running' AND updated_at < now()-($1 * interval '1 second')`, olderThan.Seconds())
	if err != nil {
		return 0, fmt.Errorf("reset stale deletion jobs: %w", err)
	}
	return tag.RowsAffected(), nil
}
