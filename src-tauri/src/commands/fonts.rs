/// Returns a sorted, deduplicated list of font family names available on the system.
#[tauri::command]
pub async fn list_system_fonts() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(collect_system_fonts)
        .await
        .unwrap_or_default()
}

fn collect_system_fonts() -> Vec<String> {
    #[cfg(target_os = "linux")]
    {
        let output = match std::process::Command::new("fc-list")
            .arg("--format")
            .arg("%{family[0]}\n")
            .output()
        {
            Ok(o) => o,
            Err(_) => return vec![],
        };
        sort_dedup_fonts(parse_line_output(&output.stdout))
    }

    #[cfg(target_os = "macos")]
    {
        // Prefer fc-list when Homebrew fontconfig is installed.
        let fc = std::process::Command::new("fc-list")
            .arg("--format")
            .arg("%{family[0]}\n")
            .output()
            .ok()
            .filter(|o| o.status.success() && !o.stdout.is_empty());

        if let Some(out) = fc {
            return sort_dedup_fonts(parse_line_output(&out.stdout));
        }

        // Fallback: system_profiler is always available on macOS.
        // Its output contains lines like:
        //   Family: Helvetica Neue
        // We extract the value after the "Family: " prefix.
        let output = match std::process::Command::new("system_profiler")
            .args(["SPFontsDataType"])
            .output()
        {
            Ok(o) => o,
            Err(_) => return vec![],
        };
        let text = String::from_utf8_lossy(&output.stdout);
        let families: Vec<String> = text
            .lines()
            .filter_map(|line| {
                let trimmed = line.trim();
                trimmed.strip_prefix("Family: ").map(|f| f.trim().to_string())
            })
            .filter(|s| !s.is_empty())
            .collect();
        sort_dedup_fonts(families)
    }

    #[cfg(target_os = "windows")]
    {
        // Windows: enumerate fonts via PowerShell (.NET InstalledFontCollection)
        let output = match std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "[System.Drawing.Text.InstalledFontCollection]::new().Families | \
                 ForEach-Object { $_.Name }",
            ])
            .output()
        {
            Ok(o) => o,
            Err(_) => return vec![],
        };
        sort_dedup_fonts(parse_line_output(&output.stdout))
    }
}

fn parse_line_output(bytes: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(bytes)
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect()
}

fn sort_dedup_fonts(mut fonts: Vec<String>) -> Vec<String> {
    fonts.sort_unstable_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    fonts.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    fonts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    // parse_line_output

    #[test]
    fn parse_splits_lines_and_trims() {
        assert_eq!(
            parse_line_output(b"Arial\n  DejaVu Sans  \nNoto Serif\n"),
            strings(&["Arial", "DejaVu Sans", "Noto Serif"]),
        );
    }

    #[test]
    fn parse_drops_blank_and_whitespace_only_lines() {
        assert_eq!(parse_line_output(b"\nArial\n\n   \n\tCourier\n"), strings(&["Arial", "Courier"]));
    }

    #[test]
    fn parse_handles_crlf_line_endings() {
        // PowerShell on Windows emits CRLF.
        assert_eq!(parse_line_output(b"Arial\r\nCalibri\r\n"), strings(&["Arial", "Calibri"]));
    }

    #[test]
    fn parse_without_trailing_newline_keeps_last_line() {
        assert_eq!(parse_line_output(b"Arial\nCalibri"), strings(&["Arial", "Calibri"]));
    }

    #[test]
    fn parse_empty_input_is_empty() {
        assert!(parse_line_output(b"").is_empty());
        assert!(parse_line_output(b"\n\n").is_empty());
    }

    #[test]
    fn parse_keeps_duplicates_and_order() {
        assert_eq!(parse_line_output(b"b\na\nb\n"), strings(&["b", "a", "b"]));
    }

    #[test]
    fn parse_replaces_invalid_utf8_lossily() {
        assert_eq!(parse_line_output(b"Caf\xff\nArial\n"), strings(&["Caf\u{FFFD}", "Arial"]));
    }

    #[test]
    fn parse_keeps_non_ascii_names() {
        assert_eq!(
            parse_line_output("Noto Sans CJK JP\n\u{c9}cole\n".as_bytes()),
            strings(&["Noto Sans CJK JP", "\u{c9}cole"]),
        );
    }

    // sort_dedup_fonts

    #[test]
    fn sort_is_case_insensitive() {
        assert_eq!(
            sort_dedup_fonts(strings(&["noto", "Arial", "courier", "Bitstream"])),
            strings(&["Arial", "Bitstream", "courier", "noto"]),
        );
    }

    #[test]
    fn dedup_removes_exact_duplicates() {
        assert_eq!(
            sort_dedup_fonts(strings(&["Arial", "Courier", "Arial", "Arial"])),
            strings(&["Arial", "Courier"]),
        );
    }

    #[test]
    fn dedup_merges_ascii_case_variants_even_when_not_adjacent() {
        // Sorting first brings the variants together, so dedup sees them.
        let out = sort_dedup_fonts(strings(&["DejaVu Sans", "Zapf", "DEJAVU SANS", "dejavu sans"]));
        assert_eq!(out.len(), 2);
        // Which casing survives is not specified (sort_unstable_by).
        assert!(out[0].eq_ignore_ascii_case("dejavu sans"));
        assert_eq!(out[1], "Zapf");
    }

    #[test]
    fn dedup_keeps_non_ascii_case_variants() {
        // Characterisation: the sort folds full Unicode case, but dedup only
        // folds ASCII case, so these stay as two separate entries.
        let out = sort_dedup_fonts(strings(&["\u{c9}cole", "\u{e9}cole"]));
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn sort_dedup_empty_is_empty() {
        assert!(sort_dedup_fonts(vec![]).is_empty());
    }

    #[test]
    fn parse_then_sort_dedup_pipeline() {
        let raw = b"Noto Sans\r\n\r\narial\nArial\n  Courier New \n";
        let out = sort_dedup_fonts(parse_line_output(raw));
        assert_eq!(out.len(), 3);
        assert!(out[0].eq_ignore_ascii_case("arial"));
        assert_eq!(&out[1..], &strings(&["Courier New", "Noto Sans"])[..]);
    }
}
