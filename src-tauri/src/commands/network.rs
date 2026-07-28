/// Fetches a remote URL and returns (base64_data, mime_type).
/// Used by PDF/PPTX export to download remote images natively, bypassing the
/// webview CSP connect-src restrictions that block fetch() to arbitrary URLs.
#[tauri::command]
pub async fn fetch_url_b64(url: String) -> Result<(String, String), String> {
    use base64::Engine;
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("URL must use HTTP or HTTPS".into());
    }
    // The redirect policy in build_ssrf_safe_client only ever sees hop 2
    // onward — the initial request URL needs its own check against an
    // IP-literal host (127.0.0.1, 169.254.169.254, ...), which never reaches
    // the DNS-resolver-based guard at all.
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("invalid URL: {e}"))?;
    if crate::net_guard::url_host_is_blocked(&parsed) {
        return Err("refusing to connect to a non-public address".into());
    }
    let client = crate::net_guard::build_ssrf_safe_client()?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("fetch failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("fetch failed: HTTP {}", resp.status()));
    }
    let raw_mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
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
    const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024; // 20 MB, matches fetch_url_text's cap
    if resp.content_length().unwrap_or(0) > MAX_IMAGE_BYTES {
        return Err("response too large (max 20 MB)".into());
    }
    let bytes = resp.bytes().await.map_err(|e| format!("read failed: {e}"))?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("response too large (max 20 MB)".into());
    }
    Ok((base64::engine::general_purpose::STANDARD.encode(&bytes), mime))
}

/// Fetch a URL and return its body as UTF-8 text. Used for "Import from URL"
/// to bypass webview CSP connect-src restrictions.
#[tauri::command]
pub async fn fetch_url_text(url: String) -> Result<String, String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("URL must use HTTP or HTTPS".into());
    }
    // See the matching comment in fetch_url_b64 above.
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("invalid URL: {e}"))?;
    if crate::net_guard::url_host_is_blocked(&parsed) {
        return Err("refusing to connect to a non-public address".into());
    }
    let client = crate::net_guard::build_ssrf_safe_client()?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("fetch failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("fetch failed: HTTP {}", resp.status()));
    }

    let ct = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let ct_ok = ct.is_empty()
        || ct.starts_with("text/")
        || ct.starts_with("application/json")
        || ct.starts_with("application/xml")
        || ct.starts_with("application/xhtml");
    if !ct_ok {
        return Err(format!("unexpected Content-Type: {ct}"));
    }

    const MAX_TEXT_BYTES: u64 = 20 * 1024 * 1024; // 20 MB
    if resp.content_length().unwrap_or(0) > MAX_TEXT_BYTES {
        return Err("response too large (max 20 MB)".into());
    }

    let text = resp.text().await.map_err(|e| format!("read failed: {e}"))?;
    if text.len() as u64 > MAX_TEXT_BYTES {
        return Err("response too large (max 20 MB)".into());
    }
    Ok(text)
}

/// Probe whether a remote URL is reachable. Used by `kova --check` to warn on
/// remote media URLs that cannot be fetched at all (invalid host, 404, etc.).
#[tauri::command]
pub async fn probe_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("URL must use HTTP or HTTPS".into());
    }
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("invalid URL: {e}"))?;
    if crate::net_guard::url_host_is_blocked(&parsed) {
        return Err("refusing to connect to a non-public address".into());
    }

    async fn get_probe(client: &reqwest::Client, url: &str) -> Result<(), String> {
        let resp = client
            .get(url)
            .header(reqwest::header::RANGE, "bytes=0-0")
            .send()
            .await
            .map_err(|e| format!("fetch failed: {e}"))?;
        if resp.status().is_success() {
            Ok(())
        } else {
            Err(format!("fetch failed: HTTP {}", resp.status()))
        }
    }

    let client = crate::net_guard::build_ssrf_safe_client()?;
    match client.head(&url).send().await {
        Ok(resp) if resp.status().is_success() => Ok(()),
        Ok(resp) if matches!(resp.status().as_u16(), 405 | 501) => get_probe(&client, &url).await,
        Ok(resp) => Err(format!("fetch failed: HTTP {}", resp.status())),
        Err(_) => get_probe(&client, &url).await,
    }
}
