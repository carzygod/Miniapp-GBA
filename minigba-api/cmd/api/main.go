package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minigba-cloud/minigba-api/internal/auth"
	"github.com/minigba-cloud/minigba-api/internal/blob"
	"github.com/minigba-cloud/minigba-api/internal/buildinfo"
	"github.com/minigba-cloud/minigba-api/internal/config"
	"github.com/minigba-cloud/minigba-api/internal/database"
	"github.com/minigba-cloud/minigba-api/internal/httpapi"
	"github.com/minigba-cloud/minigba-api/internal/save"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)
	if err := run(os.Args[1:], logger); err != nil {
		logger.Error("fatal", "error", err)
		os.Exit(1)
	}
}

func run(args []string, logger *slog.Logger) error {
	command := "serve"
	if len(args) > 0 {
		command = args[0]
		args = args[1:]
	}
	switch command {
	case "serve":
		return serve(args, logger)
	case "migrate":
		return migrate(args)
	case "version":
		fmt.Printf("minigba-api %s (%s, %s)\n", buildinfo.Version, buildinfo.Commit, buildinfo.BuildTime)
		return nil
	default:
		return fmt.Errorf("unknown command %q (expected serve, migrate, or version)", command)
	}
}

func serve(args []string, logger *slog.Logger) error {
	flags := flag.NewFlagSet("serve", flag.ContinueOnError)
	if err := flags.Parse(args); err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load configuration: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connect database: %w", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping database: %w", err)
	}
	store, err := database.NewStore(pool, cfg.MaxUserBytes)
	if err != nil {
		return err
	}
	blobs, err := blob.NewFSStore(cfg.BlobRoot, cfg.TempRoot)
	if err != nil {
		return err
	}
	saves, err := save.NewService(store, blobs, cfg.MaxBatteryBytes, cfg.MaxStateBytes)
	if err != nil {
		return err
	}
	tokens, err := auth.NewTokenManager(cfg.TokenSigningKey, cfg.TokenTTL)
	if err != nil {
		return err
	}
	var wechat auth.WechatClient = auth.NewHTTPWechatClient(cfg.WechatAppID, cfg.WechatAppSecret)
	if cfg.DevelopmentAuth {
		wechat = auth.DevelopmentWechatClient{}
		logger.Warn("development authentication is enabled")
	}
	api, err := httpapi.New(store, saves, wechat, tokens, cfg.TokenSigningKey, func(ctx context.Context) error { return pool.Ping(ctx) }, logger)
	if err != nil {
		return err
	}
	server := &http.Server{Addr: cfg.ListenAddr, Handler: api.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 70 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}

	shutdownCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go maintenanceLoop(shutdownCtx, store, blobs, logger)
	errCh := make(chan error, 1)
	go func() {
		logger.Info("API listening", "address", cfg.ListenAddr, "version", buildinfo.Version)
		errCh <- server.ListenAndServe()
	}()
	select {
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-shutdownCtx.Done():
		logger.Info("shutdown requested")
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		return server.Shutdown(ctx)
	}
}

func maintenanceLoop(ctx context.Context, store *database.Store, blobs *blob.FSStore, logger *slog.Logger) {
	_, _ = store.ResetStaleDeletionJobs(ctx, 15*time.Minute)
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		processed, err := store.ProcessDeletionBatch(ctx, 10)
		if err != nil && !errors.Is(err, context.Canceled) {
			logger.Error("account deletion maintenance failed", "error", err)
		} else if processed > 0 {
			logger.Info("account deletions completed", "count", processed)
		}
		if pruned, err := store.PruneHistory(ctx, 500); err != nil && !errors.Is(err, context.Canceled) {
			logger.Error("save history pruning failed", "error", err)
		} else if pruned > 0 {
			logger.Info("save history pruned", "versions", pruned)
		}
		if purged, err := store.PurgeDeletedHeads(ctx, 100); err != nil && !errors.Is(err, context.Canceled) {
			logger.Error("deleted save purge failed", "error", err)
		} else if purged > 0 {
			logger.Info("deleted save heads purged", "heads", purged)
		}
		if removed, err := store.DeleteExpiredIdempotency(ctx, 1000); err != nil && !errors.Is(err, context.Canceled) {
			logger.Error("idempotency cleanup failed", "error", err)
		} else if removed > 0 {
			logger.Info("expired idempotency keys removed", "count", removed)
		}
		if removed, err := store.DeleteExpiredSessions(ctx, 1000); err != nil && !errors.Is(err, context.Canceled) {
			logger.Error("session cleanup failed", "error", err)
		} else if removed > 0 {
			logger.Info("expired sessions removed", "count", removed)
		}
		digests, err := store.DueBlobDigests(ctx, 100)
		if err != nil && !errors.Is(err, context.Canceled) {
			logger.Error("blob cleanup scan failed", "error", err)
		}
		for _, digest := range digests {
			unlock, err := blobs.LockDigest(digest)
			if err != nil {
				logger.Error("blob cleanup lock failed", "digest", digest, "error", err)
				continue
			}
			due, err := store.BlobDue(ctx, digest)
			if err != nil || !due {
				unlock()
				if err != nil {
					logger.Error("blob cleanup recheck failed", "digest", digest, "error", err)
				}
				continue
			}
			if err := blobs.Delete(ctx, digest); err != nil {
				unlock()
				logger.Error("blob cleanup failed", "digest", digest, "error", err)
				continue
			}
			if err := store.ForgetBlob(ctx, digest); err != nil {
				logger.Error("blob metadata cleanup failed", "digest", digest, "error", err)
			}
			unlock()
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func migrate(args []string) error {
	flags := flag.NewFlagSet("migrate", flag.ContinueOnError)
	databaseURL := flags.String("database-url", "", "PostgreSQL connection URL")
	databaseURLFile := flags.String("database-url-file", "", "file containing PostgreSQL connection URL")
	if err := flags.Parse(args); err != nil {
		return err
	}
	value := strings.TrimSpace(*databaseURL)
	if value == "" {
		value = strings.TrimSpace(os.Getenv("MINIGBA_DATABASE_URL"))
	}
	if *databaseURLFile != "" {
		body, err := os.ReadFile(*databaseURLFile)
		if err != nil {
			return fmt.Errorf("read database URL file: %w", err)
		}
		value = strings.TrimSpace(string(body))
	}
	if value == "" {
		return errors.New("database URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	pool, err := pgxpool.New(ctx, value)
	if err != nil {
		return err
	}
	defer pool.Close()
	return database.Migrate(ctx, pool)
}
