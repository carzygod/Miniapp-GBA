package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sort"
	"strings"
)

type module struct {
	Path    string
	Version string
	Main    bool
	Replace *module
}

type component struct {
	Type     string        `json:"type"`
	BOMRef   string        `json:"bom-ref"`
	Name     string        `json:"name"`
	Version  string        `json:"version"`
	PURL     string        `json:"purl,omitempty"`
	Licenses []licenseWrap `json:"licenses"`
}

type licenseWrap struct {
	License license `json:"license"`
}
type license struct {
	ID string `json:"id"`
}

var moduleLicenses = map[string]string{
	"github.com/jackc/pgx/v5":              "MIT",
	"github.com/jackc/pgpassfile":          "MIT",
	"github.com/jackc/pgservicefile":       "MIT",
	"github.com/jackc/puddle/v2":           "MIT",
	"golang.org/x/crypto":                  "BSD-3-Clause",
	"golang.org/x/sync":                    "BSD-3-Clause",
	"golang.org/x/text":                    "BSD-3-Clause",
	"github.com/minigba-cloud/minigba-api": "Apache-2.0",
}

func main() {
	output := flag.String("output", "dist/reports/sbom.cdx.json", "CycloneDX output path")
	licenses := flag.String("licenses", "dist/reports/licenses.tsv", "license report path")
	flag.Parse()

	mod, err := os.ReadFile("go.mod")
	check(err)
	modules, err := parseGoMod(string(mod))
	check(err)
	components := make([]component, 0, len(modules))
	for _, item := range modules {
		version := item.Version
		if item.Main {
			version = "devel"
		}
		path := item.Path
		if item.Replace != nil {
			path, version = item.Replace.Path, item.Replace.Version
		}
		licenseID, ok := moduleLicenses[path]
		if !ok {
			licenseID = "UNKNOWN"
		}
		components = append(components, component{
			Type: "library", BOMRef: "go:" + path + "@" + version,
			Name: path, Version: version, PURL: "pkg:golang/" + path + "@" + version,
			Licenses: []licenseWrap{{License: license{ID: licenseID}}},
		})
	}
	sort.Slice(components, func(i, j int) bool { return components[i].BOMRef < components[j].BOMRef })

	sum, err := os.ReadFile("go.sum")
	check(err)
	digest := sha256.Sum256(append(mod, sum...))
	hexDigest := hex.EncodeToString(digest[:])
	serial := fmt.Sprintf("urn:uuid:%s-%s-5%s-a%s-%s", hexDigest[:8], hexDigest[8:12], hexDigest[13:16], hexDigest[17:20], hexDigest[20:32])
	bom := map[string]any{
		"bomFormat": "CycloneDX", "specVersion": "1.5", "serialNumber": serial, "version": 1,
		"metadata": map[string]any{
			"component":  map[string]any{"type": "application", "name": "minigba-api", "licenses": []licenseWrap{{License: license{ID: "Apache-2.0"}}}},
			"properties": []map[string]string{{"name": "minigba:go-lock-sha256", "value": hexDigest}},
		},
		"components": components,
	}
	encoded, err := json.MarshalIndent(bom, "", "  ")
	check(err)
	check(os.MkdirAll(directory(*output), 0o755))
	check(os.WriteFile(*output, append(encoded, '\n'), 0o644))

	rows := []string{"module\tversion\tlicense"}
	for _, item := range components {
		rows = append(rows, strings.Join([]string{item.Name, item.Version, item.Licenses[0].License.ID}, "\t"))
	}
	check(os.MkdirAll(directory(*licenses), 0o755))
	check(os.WriteFile(*licenses, []byte(strings.Join(rows, "\n")+"\n"), 0o644))
	fmt.Printf("SBOM components=%d lockSha256=%s\n", len(components), hexDigest)
}

func parseGoMod(source string) ([]module, error) {
	var modules []module
	inRequireBlock := false
	for number, raw := range strings.Split(source, "\n") {
		line := strings.TrimSpace(strings.SplitN(raw, "//", 2)[0])
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "replace ") || (line == "replace (") {
			return nil, fmt.Errorf("go.mod replacements require explicit SBOM support (line %d)", number+1)
		}
		if strings.HasPrefix(line, "module ") {
			fields := strings.Fields(line)
			if len(fields) != 2 {
				return nil, fmt.Errorf("invalid module directive on line %d", number+1)
			}
			modules = append(modules, module{Path: fields[1], Main: true})
			continue
		}
		if line == "require (" {
			inRequireBlock = true
			continue
		}
		if inRequireBlock && line == ")" {
			inRequireBlock = false
			continue
		}
		if strings.HasPrefix(line, "require ") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "require "))
		} else if !inRequireBlock {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) != 2 {
			return nil, fmt.Errorf("invalid require directive on line %d", number+1)
		}
		modules = append(modules, module{Path: fields[0], Version: fields[1]})
	}
	if inRequireBlock {
		return nil, fmt.Errorf("unterminated require block")
	}
	if len(modules) == 0 || !modules[0].Main {
		return nil, fmt.Errorf("go.mod does not contain a module directive")
	}
	return modules, nil
}

func directory(path string) string {
	if index := strings.LastIndexAny(path, "/\\"); index >= 0 {
		return path[:index]
	}
	return "."
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
