package ids

import (
	"regexp"
	"testing"
)

func TestNewUUID(t *testing.T) {
	a, err := NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	b, err := NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	pattern := regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	if !pattern.MatchString(a) {
		t.Fatalf("invalid UUID: %s", a)
	}
	if a == b {
		t.Fatal("UUID collision")
	}
}
