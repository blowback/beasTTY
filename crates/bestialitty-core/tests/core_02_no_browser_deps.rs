//! CORE-02 automated verification: the Rust core must have zero bindings to
//! Web Serial or any browser I/O API.
//!
//! Three checks, each a separate #[test]:
//!
//! 1. Dependency graph (`cargo metadata --format-version=1`) must not list
//!    `web-sys`, `js-sys`, `wasm-bindgen`, `wasm-bindgen-futures`, or any
//!    `gloo-*` crate anywhere in the resolved dep tree for the workspace.
//!    Our one approved production dep is `vte = "=0.15"` per ADR-001; its
//!    transitive deps (`memchr`, `arrayvec`) are allowed.
//!
//! 2. Source filesystem: no `.rs` file under `crates/bestialitty-core/src/`
//!    may contain the actual tokens `wasm_bindgen`, `web_sys`, or `js_sys`.
//!    Doc-comment mentions of browser-free architecture are fine, but a
//!    real attribute / import would regress D-20. Phase 2 will add
//!    wasm-bindgen attrs to `lib.rs` only, at which point this test will
//!    need to exempt that one file; until then, a clean grep is the rule.
//!
//! 3. Cargo.toml must declare both `cdylib` and `rlib` crate types (D-19)
//!    so the same crate backs both the wasm boundary (Phase 2) and native
//!    `cargo test` / future native shells (D-20).
//!
//! This file replaces the VALIDATION.md manual `! cargo metadata | grep`
//! pattern with an in-repo automated gate that every future commit runs.

use std::path::PathBuf;
use std::process::Command;

/// Browser-API crate names that must NEVER appear in the bestialitty-core
/// resolved dep graph.
///
/// Phase 2 (D-08): `wasm-bindgen` is removed from this list because Phase 2
/// adds `[target.'cfg(target_arch = "wasm32")'.dependencies] wasm-bindgen`
/// to Cargo.toml. Every other browser crate stays forbidden — `web-sys`,
/// `js-sys`, `wasm-bindgen-futures`, every `gloo-*` — per D-07 / D-20.
const FORBIDDEN_CRATES: &[&str] = &[
    "web-sys",
    "js-sys",
    // "wasm-bindgen" — REMOVED in Phase 2 per D-08. Allowed on wasm32 target only.
    "wasm-bindgen-futures",
    "gloo",
    "gloo-utils",
    "gloo-timers",
    "gloo-events",
    "gloo-net",
    "gloo-storage",
    "gloo-file",
    "gloo-worker",
    "gloo-history",
    "gloo-console",
    "gloo-dialogs",
    "gloo-render",
];

/// Forbidden tokens in `crates/bestialitty-core/src/**/*.rs` source files.
/// Tuple: (token, list of file-relative paths exempt FROM THAT SPECIFIC token).
/// Every file is subject to every token unless explicitly exempted for that token.
///
/// D-07: Phase 2 permits `wasm_bindgen` ONLY in `src/lib.rs`. `web_sys` and
/// `js_sys` remain forbidden in every file, including `lib.rs`. Do NOT replace
/// this with a path-based early-continue — that would regress D-07 by also
/// exempting lib.rs from `web_sys` / `js_sys`.
const FORBIDDEN_TOKENS_WITH_EXEMPTIONS: &[(&str, &[&str])] = &[
    ("wasm_bindgen", &["lib.rs"]),
    ("web_sys", &[]),
    ("js_sys", &[]),
];

#[test]
fn dependency_graph_excludes_browser_crates() {
    // env!("CARGO") -> the cargo binary the tests were launched with,
    // so this works under any rustup/toolchain.
    let output = Command::new(env!("CARGO"))
        .args(["metadata", "--format-version=1"])
        .output()
        .expect("cargo metadata should succeed");

    assert!(
        output.status.success(),
        "cargo metadata failed: status={:?} stderr={}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Smoke check: the package we care about must be in the metadata
    // output; guards against a silently-broken metadata command passing
    // this test by returning empty JSON.
    assert!(
        stdout.contains("\"name\":\"bestialitty-core\""),
        "cargo metadata did not include bestialitty-core in its resolved graph — \
         test is misconfigured or cargo metadata is broken"
    );

    for forbidden in FORBIDDEN_CRATES {
        // Substring match on the serialized JSON: each package entry is
        // rendered as `"name":"<crate>"`. Match that exact shape so a
        // crate whose description happens to mention "web-sys" doesn't
        // false-positive.
        let needle = format!("\"name\":\"{}\"", forbidden);
        assert!(
            !stdout.contains(&needle),
            "CORE-02 breach: cargo metadata contains {} — a browser dep has leaked into the \
             bestialitty-core dep graph. Production builds of the Rust core must not pull in \
             Web Serial / DOM crates (CLAUDE.md architectural constraint; D-20). If Phase 2's \
             lib.rs wasm-bindgen surface is being added, update this test to ALLOW wasm-bindgen \
             (and only wasm-bindgen) via a feature gate rather than lifting the assertion outright.",
            forbidden
        );
    }
}

#[test]
fn source_files_contain_no_wasm_attrs() {
    let src_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");

    let mut files = Vec::new();
    walk_rs_files(&src_dir, &mut files);
    assert!(
        !files.is_empty(),
        "no .rs files found under {} — test is misconfigured",
        src_dir.display()
    );

    for path in &files {
        let file_rel = path
            .strip_prefix(&src_dir)
            .expect("file should be under src_dir")
            .to_string_lossy()
            .to_string();

        let contents = std::fs::read_to_string(path)
            .unwrap_or_else(|e| panic!("could not read {}: {}", path.display(), e));

        // Check line-by-line. Strip line-comment content (`//` and beyond)
        // before scanning for forbidden tokens. Doc-comment mentions of
        // "wasm-free" architecture are fine; real code uses are not.
        for (lineno, raw_line) in contents.lines().enumerate() {
            let code_portion = match raw_line.find("//") {
                Some(idx) => &raw_line[..idx],
                None => raw_line,
            };
            for (token, exempt) in FORBIDDEN_TOKENS_WITH_EXEMPTIONS {
                if exempt.contains(&file_rel.as_str()) {
                    continue;
                }
                assert!(
                    !code_portion.contains(token),
                    "CORE-02 breach: {}:{} contains `{}` as code (not a comment). \
                     Phase 2 (D-07): `wasm_bindgen` is permitted ONLY in lib.rs; \
                     `web_sys` / `js_sys` are forbidden EVERYWHERE (lib.rs included). \
                     Offending line: {}",
                    path.display(),
                    lineno + 1,
                    token,
                    raw_line.trim()
                );
            }
        }
    }
}

#[test]
fn cargo_toml_declares_cdylib_and_rlib() {
    // D-19: the crate must build both as a C-style dylib (for wasm-pack to
    // consume in Phase 2) and as an rlib (for native cargo test and any
    // future native shell per D-20). Either ordering is accepted.
    let cargo_toml =
        std::fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml"))
            .expect("Cargo.toml must be readable");

    let has_cdylib_rlib = cargo_toml.contains("crate-type = [\"cdylib\", \"rlib\"]");
    let has_rlib_cdylib = cargo_toml.contains("crate-type = [\"rlib\", \"cdylib\"]");

    assert!(
        has_cdylib_rlib || has_rlib_cdylib,
        "Cargo.toml must declare both cdylib and rlib crate types (D-19). \
         Neither `crate-type = [\"cdylib\", \"rlib\"]` nor the reversed form was found. \
         Current Cargo.toml:\n{}",
        cargo_toml
    );
}

// --- helpers ---

fn walk_rs_files(dir: &std::path::Path, into: &mut Vec<PathBuf>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => panic!("could not read_dir {}: {}", dir.display(), e),
    };
    for entry in entries {
        let entry = entry.expect("dir entry should be readable");
        let path = entry.path();
        if path.is_dir() {
            walk_rs_files(&path, into);
        } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
            into.push(path);
        }
    }
}
