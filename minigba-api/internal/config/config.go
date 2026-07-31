package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Environment     string
	ListenAddr      string
	DatabaseURL     string
	BlobRoot        string
	TempRoot        string
	WechatAppID     string
	WechatAppSecret string
	TokenSigningKey []byte
	MaxBatteryBytes int64
	MaxStateBytes   int64
	MaxUserBytes    int64
	TokenTTL        time.Duration
	DevelopmentAuth bool
}

func Load() (Config, error) {
	c := Config{
		Environment:     env("MINIGBA_ENV", "production"),
		ListenAddr:      env("MINIGBA_LISTEN_ADDR", "127.0.0.1:8080"),
		DatabaseURL:     strings.TrimSpace(os.Getenv("MINIGBA_DATABASE_URL")),
		BlobRoot:        env("MINIGBA_BLOB_ROOT", "/srv/minigba/blobs"),
		TempRoot:        env("MINIGBA_TEMP_ROOT", "/srv/minigba/tmp"),
		WechatAppID:     strings.TrimSpace(os.Getenv("MINIGBA_WECHAT_APP_ID")),
		MaxBatteryBytes: 1 << 20,
		MaxStateBytes:   8 << 20,
		MaxUserBytes:    100 << 20,
		TokenTTL:        7 * 24 * time.Hour,
	}
	var err error
	if c.MaxBatteryBytes, err = int64Env("MINIGBA_MAX_BATTERY_BYTES", c.MaxBatteryBytes); err != nil {
		return Config{}, err
	}
	if c.MaxStateBytes, err = int64Env("MINIGBA_MAX_STATE_BYTES", c.MaxStateBytes); err != nil {
		return Config{}, err
	}
	if c.MaxUserBytes, err = int64Env("MINIGBA_MAX_USER_BYTES", c.MaxUserBytes); err != nil {
		return Config{}, err
	}
	if c.TokenTTL, err = durationEnv("MINIGBA_TOKEN_TTL", c.TokenTTL); err != nil {
		return Config{}, err
	}
	if c.DevelopmentAuth, err = boolEnv("MINIGBA_DEV_AUTH", false); err != nil {
		return Config{}, err
	}

	if c.WechatAppSecret, err = readSecret("MINIGBA_WECHAT_APP_SECRET_FILE"); err != nil {
		return Config{}, err
	}
	key, keyErr := readSecret("MINIGBA_TOKEN_SIGNING_KEY_FILE")
	if keyErr != nil {
		return Config{}, keyErr
	}
	c.TokenSigningKey = []byte(key)

	if c.DatabaseURL == "" {
		return Config{}, errors.New("MINIGBA_DATABASE_URL is required")
	}
	if c.Environment == "production" {
		if c.DevelopmentAuth {
			return Config{}, errors.New("MINIGBA_DEV_AUTH must be false in production")
		}
		if c.WechatAppID == "" || c.WechatAppSecret == "" {
			return Config{}, errors.New("WeChat credentials are required in production")
		}
		if len(c.TokenSigningKey) < 32 {
			return Config{}, errors.New("token signing key must contain at least 32 bytes")
		}
	}
	return c, nil
}

func readSecret(fileEnv string) (string, error) {
	path := strings.TrimSpace(os.Getenv(fileEnv))
	if path == "" {
		return "", nil
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", fileEnv, err)
	}
	value := strings.TrimSpace(string(b))
	if value == "" {
		return "", fmt.Errorf("%s points to an empty file", fileEnv)
	}
	return value, nil
}

func env(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func int64Env(name string, fallback int64) (int64, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", name)
	}
	return parsed, nil
}

func durationEnv(name string, fallback time.Duration) (time.Duration, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback, nil
	}
	parsed, err := time.ParseDuration(value)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("%s must be a positive duration", name)
	}
	return parsed, nil
}

func boolEnv(name string, fallback bool) (bool, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false, fmt.Errorf("%s must be true or false", name)
	}
	return parsed, nil
}
