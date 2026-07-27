//! Command-line argument handling for the Kova binary.
//!
//! Grammar: at most one action per invocation (`--present`, `--import`,
//! `--export`, or standalone `--check FILE`) plus modifiers (`--theme`,
//! `--check`) that combine with an action in any order.
//!
//! `parse_cli_args` is pure (no filesystem, no exit) so the grammar is unit
//! testable; `startup` wraps it with the process-level concerns: printing,
//! exit codes, path canonicalisation, and the Windows console attach.

use serde::Serialize;

/// Value of `--theme`: a theme name to resolve against the built-in and
/// installed community themes, or a path to a theme YAML file.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ThemeArg {
    Named { name: String },
    Path { path: String },
}

/// CLI action parsed at startup, buffered in `AppState` and drained once by
/// the frontend via the `take_pending_cli` command. Paths are canonicalised
/// absolute paths (existence already verified — `startup` exits 1 otherwise).
#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct PendingCli {
    pub present: Option<String>,
    pub theme: Option<ThemeArg>,
    pub check: bool,
    pub check_only: Option<String>,
    pub import: Option<PendingImport>,
    pub export: Option<PendingExport>,
}

/// `--import <format> <input> <output>`, resolved for the frontend. `input`
/// is a canonicalised existing path for `marp`/`pptx`, or the raw URL
/// unchanged for `url` — validating a URL string against the filesystem
/// would be nonsensical, and the fetch step reports a bad URL naturally.
/// `output` is made absolute (so the reported path is unambiguous
/// regardless of the shell's cwd) but is not required to exist yet — it's
/// the file about to be created.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PendingImport {
    pub format: ImportFormat,
    pub input: String,
    pub output: String,
}

/// `--export <format> <input> <output>`. Unlike import, `input` is always a
/// local Markdown file — canonicalised, must already exist. `output` is
/// absolutized like `PendingImport`'s.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PendingExport {
    pub format: ExportFormat,
    pub input: String,
    pub output: String,
}

#[derive(Debug, PartialEq)]
pub enum CliArgs {
    Run(RunArgs),
    Help,
    Version,
    Error(String),
}

#[derive(Debug, PartialEq, Default)]
pub struct RunArgs {
    pub action: Option<Action>,
    pub theme: Option<ThemeArg>,
    pub check: bool,
    /// Plain-file arguments for the editor launch path (existence filtering
    /// happens in `startup`, keeping the parser filesystem-free).
    pub open: Vec<String>,
}

#[derive(Debug, PartialEq)]
pub enum Action {
    Present(String),
    Import { format: ImportFormat, input: String, output: String },
    Export { format: ExportFormat, input: String, output: String },
    CheckOnly(String),
}

/// Serialises as a bare lowercase string ("marp"/"pptx"/"url") — matching
/// the CLI keywords directly, no adjacent tagging needed for a fieldless enum.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportFormat {
    Marp,
    Pptx,
    Url,
}

/// Serialises as a bare lowercase string ("pptx"/"pdf") — same reasoning as
/// `ImportFormat` above.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Pptx,
    Pdf,
}

const IMPORT_USAGE: &str = "--import requires: --import <marp|pptx|url> <input> <output>";
const EXPORT_USAGE: &str = "--export requires: --export <pptx|pdf> <input> <output>";

const USAGE: &str = "\
Usage:
  kova [FILE...]                            open file(s) in the editor (.md default)
  kova --present <FILE>                     present FILE directly (.md default)
  kova --check <FILE>                       validate FILE and exit (.md default)
  kova --import <marp|pptx|url> <IN> <OUT>  convert IN to Kova Markdown
  kova --export <pptx|pdf> <IN> <OUT>       export IN via Kova's engine

Modifiers (combine with an action, any order):
  --theme <NAME|PATH>   override the deck theme for this run; a name is
                        resolved against built-in and installed community
                        themes, a path must point to a theme YAML file
  --check               validate syntax before running the action

Other:
  -h, --help            show this help
  --version             show version
";

pub fn parse_cli_args(args: Vec<String>) -> CliArgs {
    // --help / --version win regardless of position or other errors.
    for arg in &args {
        let (flag, _) = split_eq(arg);
        match flag {
            "--help" | "-h" => return CliArgs::Help,
            "--version" => return CliArgs::Version,
            _ => {}
        }
    }

    let mut action: Option<Action> = None;
    let mut theme: Option<ThemeArg> = None;
    let mut check = false;
    let mut positionals: Vec<String> = Vec::new();
    let mut unknown: Option<String> = None;

    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if !arg.starts_with('-') {
            positionals.push(arg.clone());
            i += 1;
            continue;
        }
        // macOS Finder launches inject a process serial number argument.
        if arg.starts_with("-psn_") {
            i += 1;
            continue;
        }

        let (flag, inline) = split_eq(arg);
        match flag {
            "--present" => {
                let Some(file) = take_value(inline, &args, &mut i) else {
                    return CliArgs::Error("--present requires a file argument".into());
                };
                if let Err(e) = set_action(&mut action, Action::Present(file)) {
                    return e;
                }
            }
            "--check" => {
                if inline.is_some() {
                    return CliArgs::Error(
                        "--check does not take a value; pass the file as a separate argument"
                            .into(),
                    );
                }
                check = true;
            }
            "--theme" => {
                let Some(value) = take_value(inline, &args, &mut i) else {
                    return CliArgs::Error("--theme requires a value".into());
                };
                theme = Some(classify_theme(value));
            }
            "--import" => {
                let Some(format) = take_value(inline, &args, &mut i) else {
                    return CliArgs::Error(IMPORT_USAGE.into());
                };
                let format = match format.as_str() {
                    "marp" => ImportFormat::Marp,
                    "pptx" => ImportFormat::Pptx,
                    "url" => ImportFormat::Url,
                    other => {
                        return CliArgs::Error(format!(
                            "unknown import format '{other}' (expected marp, pptx, or url)"
                        ))
                    }
                };
                let (Some(input), Some(output)) = (
                    take_value(None, &args, &mut i),
                    take_value(None, &args, &mut i),
                ) else {
                    return CliArgs::Error(IMPORT_USAGE.into());
                };
                // Guards a real footgun, not just usage hygiene: input and
                // output are two unrelated positional slots with no way to
                // tell a deliberate call from a shell glob that happened to
                // expand to exactly two files (e.g. `--import marp *.md
                // out.md` matching two decks) — which would otherwise
                // silently overwrite the second file as if it were the
                // intended output. Three or more matches already fail via
                // the unexpected-argument check below; this closes the
                // exactly-two-matches gap that check can't see, since it's
                // a fully-valid-looking two-argument call by that point.
                let input_ext_ok = match format {
                    ImportFormat::Marp => has_extension(&input, &[".md", ".markdown"]),
                    ImportFormat::Pptx => has_extension(&input, &[".pptx"]),
                    ImportFormat::Url => true, // not a filesystem path
                };
                if !input_ext_ok {
                    let expected = match format {
                        ImportFormat::Marp => ".md",
                        ImportFormat::Pptx => ".pptx",
                        ImportFormat::Url => unreachable!(),
                    };
                    return CliArgs::Error(format!(
                        "--import {} expects a {expected} input file, got '{input}'",
                        format_name(&format)
                    ));
                }
                if !has_extension(&output, &[".md", ".markdown"]) {
                    return CliArgs::Error(format!(
                        "--import output must be a .md file, got '{output}'"
                    ));
                }
                if format == ImportFormat::Marp
                    && std::path::Path::new(&input).exists()
                    && std::path::Path::new(&output).exists()
                {
                    return CliArgs::Error(format!(
                        "ambiguous arguments: both input '{input}' and output '{output}' are existing Markdown files. Refusing to overwrite to prevent data loss."
                    ));
                }
                if let Err(e) = set_action(&mut action, Action::Import { format, input, output }) {
                    return e;
                }
            }
            "--export" => {
                let Some(format) = take_value(inline, &args, &mut i) else {
                    return CliArgs::Error(EXPORT_USAGE.into());
                };
                let format = match format.as_str() {
                    "pptx" => ExportFormat::Pptx,
                    "pdf" => ExportFormat::Pdf,
                    other => {
                        return CliArgs::Error(format!(
                            "unknown export format '{other}' (expected pptx or pdf)"
                        ))
                    }
                };
                let (Some(input), Some(output)) = (
                    take_value(None, &args, &mut i),
                    take_value(None, &args, &mut i),
                ) else {
                    return CliArgs::Error(EXPORT_USAGE.into());
                };
                // See the matching comment on --import above — same
                // exactly-two-glob-matches footgun, same fix.
                if !has_extension(&input, &[".md", ".markdown"]) {
                    return CliArgs::Error(format!(
                        "--export expects a .md input file, got '{input}'"
                    ));
                }
                let expected_out = match format {
                    ExportFormat::Pptx => &[".pptx"][..],
                    ExportFormat::Pdf => &[".pdf"][..],
                };
                if !has_extension(&output, expected_out) {
                    return CliArgs::Error(format!(
                        "--export {} output must be a {} file, got '{output}'",
                        format_name_export(&format),
                        expected_out[0],
                    ));
                }
                if let Err(e) = set_action(&mut action, Action::Export { format, input, output }) {
                    return e;
                }
            }
            other => {
                if unknown.is_none() {
                    unknown = Some(other.to_string());
                }
            }
        }
        i += 1;
    }

    // Standalone --check: the file arrives as a positional.
    if check && action.is_none() {
        match positionals.len() {
            0 => return CliArgs::Error("--check requires a file or an action to gate".into()),
            1 => action = Some(Action::CheckOnly(positionals.remove(0))),
            _ => return CliArgs::Error("--check validates one file at a time".into()),
        }
    }

    let cli_intent = action.is_some() || check || theme.is_some();
    if cli_intent {
        // Strict mode: CLI invocations fail loudly.
        if let Some(flag) = unknown {
            return CliArgs::Error(format!("unknown option '{flag}'"));
        }
        if let Some(extra) = positionals.first() {
            return CliArgs::Error(format!("unexpected argument '{extra}'"));
        }
        if action.is_none() {
            return CliArgs::Error("--theme requires --present, --import, or --export".into());
        }
        CliArgs::Run(RunArgs { action, theme, check, open: Vec::new() })
    } else {
        // Plain editor launch: positionals are files to open. Unknown
        // dash-arguments stay silently ignored — platform launchers and
        // desktop files pass flags Kova has never handled.
        CliArgs::Run(RunArgs { action: None, theme: None, check: false, open: positionals })
    }
}

fn split_eq(arg: &str) -> (&str, Option<&str>) {
    match arg.split_once('=') {
        Some((flag, value)) => (flag, Some(value)),
        None => (arg, None),
    }
}

/// Value for a flag: the inline `--flag=value` form, or the following
/// argument when it doesn't look like another flag.
/// Case-insensitive suffix check against a list of accepted extensions
/// (each including the leading dot, e.g. `".md"`).
fn has_extension(path: &str, exts: &[&str]) -> bool {
    let lower = path.to_ascii_lowercase();
    exts.iter().any(|e| lower.ends_with(e))
}

fn format_name(f: &ImportFormat) -> &'static str {
    match f {
        ImportFormat::Marp => "marp",
        ImportFormat::Pptx => "pptx",
        ImportFormat::Url => "url",
    }
}

fn format_name_export(f: &ExportFormat) -> &'static str {
    match f {
        ExportFormat::Pptx => "pptx",
        ExportFormat::Pdf => "pdf",
    }
}

fn take_value(inline: Option<&str>, args: &[String], i: &mut usize) -> Option<String> {
    if let Some(v) = inline {
        return Some(v.to_string());
    }
    let next = args.get(*i + 1)?;
    if next.starts_with('-') {
        return None;
    }
    *i += 1;
    Some(next.clone())
}

fn set_action(slot: &mut Option<Action>, action: Action) -> Result<(), CliArgs> {
    if slot.is_some() {
        return Err(CliArgs::Error(
            "only one action allowed (--present, --import, --export, or standalone --check)"
                .into(),
        ));
    }
    *slot = Some(action);
    Ok(())
}

/// A value is a path if it looks like one; anything else is a theme name.
fn classify_theme(value: String) -> ThemeArg {
    let lower = value.to_ascii_lowercase();
    let looks_like_path = value.contains('/')
        || value.contains('\\')
        || value.starts_with('~')
        || lower.ends_with(".yaml")
        || lower.ends_with(".yml");
    if looks_like_path {
        ThemeArg::Path { path: value }
    } else {
        ThemeArg::Named { name: value }
    }
}

/// What `run()` needs after CLI handling: the buffered CLI action (if any)
/// and the plain files to open in the editor.
pub struct Startup {
    pub pending: Option<PendingCli>,
    pub open: Vec<String>,
}

/// Parse argv and resolve everything that must happen before the Tauri
/// builder runs: `--help`/`--version` print and exit 0, usage errors exit 2,
/// and action paths that fail to canonicalise exit 1 — fail fast, no window.
pub fn startup() -> Startup {
    match parse_cli_args(std::env::args().skip(1).collect()) {
        CliArgs::Help => {
            attach_parent_console();
            print!("{USAGE}");
            std::process::exit(0);
        }
        CliArgs::Version => {
            attach_parent_console();
            println!("kova {}", env!("CARGO_PKG_VERSION"));
            std::process::exit(0);
        }
        CliArgs::Error(msg) => {
            attach_parent_console();
            eprintln!("kova: {msg}");
            eprintln!("Try 'kova --help' for usage.");
            std::process::exit(2);
        }
        CliArgs::Run(run) => resolve(run),
    }
}

fn resolve(run: RunArgs) -> Startup {
    let mut pending = PendingCli { check: run.check, ..PendingCli::default() };
    match run.action {
        Some(Action::Present(path)) => {
            pending.present = Some(canonicalise_or_exit(&path, "cannot open"));
        }
        Some(Action::CheckOnly(path)) => {
            pending.check_only = Some(canonicalise_or_exit(&path, "cannot open"));
        }
        Some(Action::Import { format, input, output }) => {
            let input = match format {
                // A URL isn't a filesystem path — canonicalising it would
                // always fail. The fetch step reports a bad URL naturally.
                ImportFormat::Url => input,
                ImportFormat::Marp | ImportFormat::Pptx => {
                    canonicalise_or_exit(&input, "cannot open")
                }
            };
            pending.import = Some(PendingImport { format, input, output: absolutize(&output) });
        }
        Some(Action::Export { format, input, output }) => {
            // Unlike import's url case, export's input is always a local
            // Markdown file that must already exist.
            let input = canonicalise_or_exit(&input, "cannot open");
            pending.export = Some(PendingExport { format, input, output: absolutize(&output) });
        }
        None => {}
    }
    pending.theme = run.theme.map(|theme| match theme {
        ThemeArg::Path { path } => {
            ThemeArg::Path { path: canonicalise_or_exit(&path, "cannot read theme") }
        }
        named => named,
    });

    let cli_active = pending.present.is_some()
        || pending.check_only.is_some()
        || pending.import.is_some()
        || pending.export.is_some();
    // Editor launch keeps the pre-CLI behaviour: arguments that don't exist
    // on disk are silently ignored rather than failing the launch. We try
    // to append .md as a fallback if the file doesn't exist.
    let open = run
        .open
        .into_iter()
        .map(|p| {
            if std::path::Path::new(&p).exists() {
                p
            } else {
                let with_md = format!("{p}.md");
                if std::path::Path::new(&with_md).exists() {
                    with_md
                } else {
                    p
                }
            }
        })
        .filter(|p| std::path::Path::new(p).exists())
        .collect();
    Startup { pending: if cli_active { Some(pending) } else { None }, open }
}

/// Resolves a not-necessarily-existing path to absolute, for the output side
/// of `--import`/`--export`. Unlike `canonicalise_or_exit`, this never fails
/// or requires the path to exist yet — it's the file about to be written.
/// Relative paths join onto the shell's cwd; already-absolute paths pass
/// through unchanged. Does not resolve symlinks or `..` segments (`canonicalize`
/// would, but requires existence) — the OS handles those fine at write time.
fn absolutize(path: &str) -> String {
    let p = std::path::Path::new(path);
    if p.is_absolute() {
        return p.to_string_lossy().into_owned();
    }
    match std::env::current_dir() {
        Ok(cwd) => cwd.join(p).to_string_lossy().into_owned(),
        Err(_) => path.to_string(),
    }
}

fn canonicalise_or_exit(path: &str, verb: &str) -> String {
    match std::fs::canonicalize(path) {
        Ok(p) => p.to_string_lossy().into_owned(),
        Err(_) => {
            if !has_extension(path, &[".md", ".markdown"]) {
                let path_with_md = format!("{path}.md");
                if let Ok(p) = std::fs::canonicalize(&path_with_md) {
                    return p.to_string_lossy().into_owned();
                }
            }
            attach_parent_console();
            eprintln!("kova: {verb} '{path}': no such file");
            std::process::exit(1);
        }
    }
}

/// Release builds use the Windows GUI subsystem (no console), so terminal
/// output vanishes unless the process attaches to the parent's console
/// first. Silently a no-op when there is no parent console (GUI launches)
/// or on other platforms.
#[cfg(windows)]
pub fn attach_parent_console() {
    use windows::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};
    unsafe {
        let _ = AttachConsole(ATTACH_PARENT_PROCESS);
    }
}

#[cfg(not(windows))]
pub fn attach_parent_console() {}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> CliArgs {
        parse_cli_args(args.iter().map(|s| s.to_string()).collect())
    }

    fn expect_run(args: &[&str]) -> RunArgs {
        match parse(args) {
            CliArgs::Run(run) => run,
            other => panic!("expected Run, got {other:?}"),
        }
    }

    fn expect_error(args: &[&str]) -> String {
        match parse(args) {
            CliArgs::Error(msg) => msg,
            other => panic!("expected Error, got {other:?}"),
        }
    }

    // -- actions ------------------------------------------------------------

    #[test]
    fn present_with_space_value() {
        let run = expect_run(&["--present", "talk.md"]);
        assert_eq!(run.action, Some(Action::Present("talk.md".into())));
        assert!(run.open.is_empty());
    }

    #[test]
    fn present_with_equals_value() {
        let run = expect_run(&["--present=talk.md"]);
        assert_eq!(run.action, Some(Action::Present("talk.md".into())));
    }

    #[test]
    fn present_missing_value() {
        assert_eq!(expect_error(&["--present"]), "--present requires a file argument");
    }

    #[test]
    fn present_followed_by_flag_is_missing_value() {
        assert_eq!(
            expect_error(&["--present", "--check"]),
            "--present requires a file argument"
        );
    }

    #[test]
    fn check_standalone_takes_positional_file() {
        let run = expect_run(&["--check", "talk.md"]);
        assert_eq!(run.action, Some(Action::CheckOnly("talk.md".into())));
        assert!(run.check);
    }

    #[test]
    fn check_alone_is_error() {
        assert_eq!(expect_error(&["--check"]), "--check requires a file or an action to gate");
    }

    #[test]
    fn check_multiple_files_is_error() {
        assert_eq!(
            expect_error(&["--check", "a.md", "b.md"]),
            "--check validates one file at a time"
        );
    }

    #[test]
    fn check_rejects_inline_value() {
        let msg = expect_error(&["--check=talk.md"]);
        assert!(msg.starts_with("--check does not take a value"));
    }

    #[test]
    fn two_actions_rejected() {
        let msg = expect_error(&["--present", "a.md", "--present", "b.md"]);
        assert!(msg.starts_with("only one action allowed"));
    }

    #[test]
    fn unexpected_positional_with_action() {
        assert_eq!(
            expect_error(&["--present", "a.md", "extra.md"]),
            "unexpected argument 'extra.md'"
        );
    }

    // -- import / export ----------------------------------------------------

    #[test]
    fn import_parses_successfully() {
        let run = expect_run(&["--import", "marp", "in.md", "out.md"]);
        assert_eq!(
            run.action,
            Some(Action::Import {
                format: ImportFormat::Marp,
                input: "in.md".into(),
                output: "out.md".into(),
            })
        );
    }

    #[test]
    fn import_pptx_and_url_formats_parse() {
        let pptx = expect_run(&["--import", "pptx", "deck.pptx", "out.md"]);
        assert_eq!(
            pptx.action,
            Some(Action::Import {
                format: ImportFormat::Pptx,
                input: "deck.pptx".into(),
                output: "out.md".into(),
            })
        );
        let url = expect_run(&["--import", "url", "https://example.com/x.md", "out.md"]);
        assert_eq!(
            url.action,
            Some(Action::Import {
                format: ImportFormat::Url,
                input: "https://example.com/x.md".into(),
                output: "out.md".into(),
            })
        );
    }

    #[test]
    fn export_parses_successfully() {
        let run = expect_run(&["--export", "pdf", "in.md", "out.pdf"]);
        assert_eq!(
            run.action,
            Some(Action::Export {
                format: ExportFormat::Pdf,
                input: "in.md".into(),
                output: "out.pdf".into(),
            })
        );
    }

    #[test]
    fn export_pptx_format_parses() {
        let run = expect_run(&["--export", "pptx", "in.md", "out.pptx"]);
        assert_eq!(
            run.action,
            Some(Action::Export {
                format: ExportFormat::Pptx,
                input: "in.md".into(),
                output: "out.pptx".into(),
            })
        );
    }

    // -- extension guards (glob-safety) --------------------------------------
    //
    // A shell glob that happens to expand to exactly two files is otherwise
    // indistinguishable from a deliberate `input output` call — these tests
    // simulate that by using two plausible filenames in the wrong roles and
    // checking the mismatch is caught before anything would be written.

    #[test]
    fn export_rejects_non_md_input() {
        let msg = expect_error(&["--export", "pdf", "notes.pptx", "out.pdf"]);
        assert!(msg.contains("--export expects a .md input file"), "{msg}");
    }

    #[test]
    fn export_pptx_rejects_glob_landing_on_a_second_md_file() {
        // Simulates `--export pptx *.md out.pptx` where the glob matched
        // exactly two decks (jan.md, feb.md) instead of one deck plus an
        // explicit output — feb.md must never be silently treated as pptx.
        let msg = expect_error(&["--export", "pptx", "jan.md", "feb.md"]);
        assert!(msg.contains("--export pptx output must be a .pptx file"), "{msg}");
    }

    #[test]
    fn export_pdf_rejects_wrong_output_extension() {
        let msg = expect_error(&["--export", "pdf", "in.md", "out.pptx"]);
        assert!(msg.contains("--export pdf output must be a .pdf file"), "{msg}");
    }

    #[test]
    fn import_marp_rejects_non_md_input() {
        let msg = expect_error(&["--import", "marp", "deck.pptx", "out.md"]);
        assert!(msg.contains("--import marp expects a .md input file"), "{msg}");
    }

    #[test]
    fn import_pptx_rejects_non_pptx_input() {
        let msg = expect_error(&["--import", "pptx", "deck.md", "out.md"]);
        assert!(msg.contains("--import pptx expects a .pptx input file"), "{msg}");
    }

    #[test]
    fn import_rejects_glob_landing_on_a_second_md_file_as_output() {
        // Simulates `--import marp *.md` matching exactly two decks where both exist.
        let _ = std::fs::File::create("jan.md");
        let _ = std::fs::File::create("feb.md");

        let msg = expect_error(&["--import", "marp", "jan.md", "feb.md"]);
        assert!(msg.contains("ambiguous arguments: both input 'jan.md' and output 'feb.md' are existing Markdown files"), "{msg}");

        let _ = std::fs::remove_file("jan.md");
        let _ = std::fs::remove_file("feb.md");
    }

    #[test]
    fn import_url_skips_input_extension_check() {
        // url's "input" is a URL, not a filesystem path — must never be
        // extension-checked.
        let run = expect_run(&["--import", "url", "https://example.com/x", "out.md"]);
        assert_eq!(
            run.action,
            Some(Action::Import {
                format: ImportFormat::Url,
                input: "https://example.com/x".into(),
                output: "out.md".into(),
            })
        );
    }

    #[test]
    fn import_unknown_format() {
        assert_eq!(
            expect_error(&["--import", "keynote", "in", "out"]),
            "unknown import format 'keynote' (expected marp, pptx, or url)"
        );
    }

    #[test]
    fn export_unknown_format() {
        assert_eq!(
            expect_error(&["--export", "docx", "in", "out"]),
            "unknown export format 'docx' (expected pptx or pdf)"
        );
    }

    #[test]
    fn export_missing_output() {
        assert_eq!(expect_error(&["--export", "pdf", "in.md"]), EXPORT_USAGE);
    }

    #[test]
    fn import_missing_everything() {
        assert_eq!(expect_error(&["--import"]), IMPORT_USAGE);
    }

    // -- modifiers ----------------------------------------------------------

    #[test]
    fn combined_flags_any_order() {
        let a = expect_run(&["--check", "--theme=firefly", "--present", "talk.md"]);
        let b = expect_run(&["--present", "talk.md", "--theme", "firefly", "--check"]);
        assert_eq!(a, b);
        assert_eq!(a.action, Some(Action::Present("talk.md".into())));
        assert_eq!(a.theme, Some(ThemeArg::Named { name: "firefly".into() }));
        assert!(a.check);
    }

    #[test]
    fn check_with_import_keeps_check_modifier() {
        // --check used to be accepted then ignored for --import (issue #178).
        // The parser must keep the modifier so the frontend can gate the write.
        let run = expect_run(&["--check", "--import", "marp", "in.md", "out.md"]);
        assert!(run.check);
        assert_eq!(
            run.action,
            Some(Action::Import {
                format: ImportFormat::Marp,
                input: "in.md".into(),
                output: "out.md".into(),
            })
        );
        let reversed = expect_run(&["--import", "marp", "in.md", "out.md", "--check"]);
        assert!(reversed.check);
    }

    #[test]
    fn theme_equals_and_space_forms_match() {
        let a = expect_run(&["--theme=gruvbox-dark", "--present", "t.md"]);
        let b = expect_run(&["--theme", "gruvbox-dark", "--present", "t.md"]);
        assert_eq!(a.theme, b.theme);
    }

    #[test]
    fn theme_name_vs_path_classification() {
        for (value, expect_path) in [
            ("gruvbox-dark", false),
            ("firefly", false),
            ("./my.yaml", true),
            ("themes/my.yml", true),
            ("/abs/theme.yaml", true),
            ("~/theme.yaml", true),
            ("custom.YML", true),
            ("C:\\themes\\my.yaml", true),
        ] {
            let run = expect_run(&["--theme", value, "--present", "t.md"]);
            let is_path = matches!(run.theme, Some(ThemeArg::Path { .. }));
            assert_eq!(is_path, expect_path, "misclassified {value:?}");
        }
    }

    #[test]
    fn theme_missing_value() {
        assert_eq!(expect_error(&["--theme", "--present", "t.md"]), "--theme requires a value");
    }

    #[test]
    fn theme_without_action() {
        assert_eq!(
            expect_error(&["--theme=firefly"]),
            "--theme requires --present, --import, or --export"
        );
    }

    // -- unknown flags and editor launch ------------------------------------

    #[test]
    fn unknown_flag_with_action_is_error() {
        assert_eq!(expect_error(&["--foo", "--present", "t.md"]), "unknown option '--foo'");
    }

    #[test]
    fn unknown_flag_without_action_is_ignored() {
        let run = expect_run(&["--foo", "talk.md"]);
        assert_eq!(run.action, None);
        assert_eq!(run.open, vec!["talk.md".to_string()]);
    }

    #[test]
    fn plain_files_collect_for_editor() {
        let run = expect_run(&["a.md", "b.md"]);
        assert_eq!(run.open, vec!["a.md".to_string(), "b.md".to_string()]);
        assert_eq!(run.action, None);
    }

    #[test]
    fn empty_args_is_plain_launch() {
        let run = expect_run(&[]);
        assert_eq!(run.action, None);
        assert!(run.open.is_empty());
    }

    #[test]
    fn psn_argument_tolerated() {
        let run = expect_run(&["-psn_0_12345", "--present", "talk.md"]);
        assert_eq!(run.action, Some(Action::Present("talk.md".into())));
    }

    // -- help / version -----------------------------------------------------

    #[test]
    fn help_wins_anywhere() {
        assert_eq!(parse(&["--present", "t.md", "--help"]), CliArgs::Help);
        assert_eq!(parse(&["-h"]), CliArgs::Help);
    }

    #[test]
    fn version_wins_anywhere() {
        assert_eq!(parse(&["--version"]), CliArgs::Version);
        assert_eq!(parse(&["--check", "--version"]), CliArgs::Version);
    }
}
