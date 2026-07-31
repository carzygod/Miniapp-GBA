package auth

import (
	"errors"
	"testing"
	"time"
)

func TestTokenRoundTripAndTamper(t *testing.T) {
	m, err := NewTokenManager([]byte("01234567890123456789012345678901"), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0)
	m.now = func() time.Time { return now }
	token, expires, err := m.Issue("user-1", "session-1")
	if err != nil {
		t.Fatal(err)
	}
	if !expires.Equal(now.Add(time.Hour)) {
		t.Fatalf("wrong expiry: %s", expires)
	}
	claims, err := m.Parse(token)
	if err != nil {
		t.Fatal(err)
	}
	if claims.UserID != "user-1" || claims.SessionID != "session-1" {
		t.Fatalf("wrong claims: %+v", claims)
	}
	if _, err := m.Parse(token + "x"); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("tamper error = %v", err)
	}
	m.now = func() time.Time { return expires }
	if _, err := m.Parse(token); !errors.Is(err, ErrExpiredToken) {
		t.Fatalf("expiry error = %v", err)
	}
}

func TestRevisionETag(t *testing.T) {
	for _, revision := range []int64{0, 1, 42} {
		got, err := ParseRevisionETag(RevisionETag(revision))
		if err != nil || got != revision {
			t.Fatalf("revision %d: got %d, %v", revision, got, err)
		}
	}
	if got, err := ParseRevisionETag("*"); err != nil || got != 0 {
		t.Fatalf("wildcard: %d, %v", got, err)
	}
	for _, invalid := range []string{"revision-1", `"revision--1"`, `"wrong-1"`, `"revision-a"`} {
		if _, err := ParseRevisionETag(invalid); err == nil {
			t.Fatalf("accepted %q", invalid)
		}
	}
}
