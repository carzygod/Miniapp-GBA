package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadProductionWechatCredentialsFromFiles(t *testing.T) {
	secretPath := writeCredential(t, "0123456789abcdef0123456789abcdef")
	tokenPath := writeCredential(t, strings.Repeat("t", 32))
	productionEnv(t, secretPath, tokenPath)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.WechatAppID != "wx0000000000000000" || cfg.WechatAppSecret != "0123456789abcdef0123456789abcdef" {
		t.Fatal("production WeChat credentials were not loaded from the configured AppID and secret file")
	}
}

func TestLoadRejectsInvalidProductionWechatCredentials(t *testing.T) {
	secretPath := writeCredential(t, "not-a-secret")
	tokenPath := writeCredential(t, strings.Repeat("t", 32))
	productionEnv(t, secretPath, tokenPath)
	t.Setenv("MINIGBA_WECHAT_APP_SECRET", "0123456789abcdef0123456789abcdef")

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "AppSecret") {
		t.Fatalf("Load() error = %v, want an AppSecret validation error", err)
	}
	t.Setenv("MINIGBA_WECHAT_APP_SECRET_FILE", writeCredential(t, "0123456789abcdef0123456789abcdef"))
	t.Setenv("MINIGBA_WECHAT_APP_ID", "touristappid")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "AppID") {
		t.Fatalf("Load() error = %v, want an AppID validation error", err)
	}
}

func productionEnv(t *testing.T, secretPath, tokenPath string) {
	t.Helper()
	t.Setenv("MINIGBA_ENV", "production")
	t.Setenv("MINIGBA_DATABASE_URL", "postgres://minigba@/minigba")
	t.Setenv("MINIGBA_WECHAT_APP_ID", "wx0000000000000000")
	t.Setenv("MINIGBA_WECHAT_APP_SECRET_FILE", secretPath)
	t.Setenv("MINIGBA_TOKEN_SIGNING_KEY_FILE", tokenPath)
	t.Setenv("MINIGBA_DEV_AUTH", "false")
}

func writeCredential(t *testing.T, value string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "credential")
	if err := os.WriteFile(path, []byte(value+"\n"), 0o640); err != nil {
		t.Fatalf("write credential: %v", err)
	}
	return path
}
