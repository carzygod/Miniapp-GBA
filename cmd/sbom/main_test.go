package main

import "testing"

func TestParseGoMod(t *testing.T) {
	modules, err := parseGoMod("module example.test/app\n\ngo 1.26\n\nrequire example.test/one v1.2.3\nrequire (\n example.test/two v2.0.0\n)\n")
	if err != nil {
		t.Fatal(err)
	}
	if len(modules) != 3 || !modules[0].Main || modules[2].Version != "v2.0.0" {
		t.Fatalf("modules = %#v", modules)
	}
}

func TestParseGoModRejectsReplacement(t *testing.T) {
	if _, err := parseGoMod("module example.test/app\nreplace example.test/one => ../one\n"); err == nil {
		t.Fatal("expected replacement error")
	}
}
