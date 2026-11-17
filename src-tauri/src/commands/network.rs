use crate::net_guard::{fetch_capped, FetchKind, FetchOpts, TEXT_CONTENT_TYPES};

/// 20 MB body cap shared by the image and text fetches.
const MAX_FETCH_BYTES: u64 = 20 * 1024 * 1024;

/// Fetches a remote URL and returns (base64_data, mime_type).
/// Used by PDF/PPTX export to download remote images natively, bypassing the
/// webview CSP connect-src restrictions that block fetch() to arbitrary URLs.
#[tauri::command]
pub async fn fetch_url_b64(url: String) -> Result<(String, String), String> {
    use base64::Engine;
    let opts = FetchOpts {
        https_only: false,
        max_bytes: MAX_FETCH_BYTES,
        accept: None,
        kind: FetchKind::Get,
    };
    let fetched = fetch_capped(&url, &opts).await?;
    let raw_mime = fetched
        .content_type
        .as_deref()
        .unwrap_or("image/png")
        .split(';')
        .next()
        .unwrap_or("image/png")
        .trim()
        .to_lowercase();
    // Normalise non-standard JPEG variants so browsers accept the data URL.
    let mime = match raw_mime.as_str() {
        "image/jpg" | "image/pjpeg" | "image/x-jpeg" => "image/jpeg".to_string(),
        other => other.to_string(),
    };
    Ok((base64::engine::general_purpose::STANDARD.encode(&fetched.bytes), mime))
}

/// Fetch a URL and return its body as UTF-8 text. Used for "Import from URL"
/// to bypass webview CSP connect-src restrictions.
#[tauri::command]
pub async fn fetch_url_text(url: String) -> Result<String, String> {
    let opts = FetchOpts {
        https_only: false,
        max_bytes: MAX_FETCH_BYTES,
        accept: Some(TEXT_CONTENT_TYPES),
        kind: FetchKind::Get,
    };
    let fetched = fetch_capped(&url, &opts).await?;
    // Lossy UTF-8, exactly what reqwest's Response::text() does without its
    // `charset` feature (which this crate does not enable).
    let text = String::from_utf8_lossy(&fetched.bytes).into_owned();
    // Replacement characters can make the decoded text longer than the raw
    // bytes, so the cap is checked again on the text, as before.
    if text.len() as u64 > MAX_FETCH_BYTES {
        return Err("response too large (max 20 MB)".into());
    }
    Ok(text)
}

/// Probe whether a remote URL is reachable. Used by `kova --check` to warn on
/// remote media URLs that cannot be fetched at all (invalid host, 404, etc.).
#[tauri::command]
pub async fn probe_url(url: String) -> Result<(), String> {
    let opts = FetchOpts {
        https_only: false,
        // A probe never reads the body, so no cap or content-type filter.
        max_bytes: 0,
        accept: None,
        kind: FetchKind::Probe,
    };
    fetch_capped(&url, &opts).await?;
    Ok(())
}
