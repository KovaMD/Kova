use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::sync::Arc;

use reqwest::dns::{Addrs, Name, Resolve, Resolving};

/// True if `ip` is not routable on the public internet (loopback, private,
/// link-local — including the 169.254.169.254 cloud metadata range —
/// unspecified, or multicast). Used to block SSRF: `fetch_url_b64`/
/// `fetch_url_text` fetch URLs taken straight from an opened document's
/// content, server-side, with no user confirmation, so a malicious document
/// must not be able to make this app's backend reach internal-only services.
fn is_blocked(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_multicast()
                || v4.is_broadcast()
                || o[0] == 0 // 0.0.0.0/8 ("this network")
                // 100.64.0.0/10, RFC 6598 Shared Address Space (CGNAT) — not
                // covered by is_private(). Reachable in the wild: e.g. Alibaba
                // Cloud's metadata service lives at 100.100.100.200.
                || (o[0] == 100 && (o[1] & 0xc0) == 0x40)
        }
        IpAddr::V6(v6) => {
            if v6.is_loopback() || v6.is_unspecified() || v6.is_multicast() {
                return true;
            }
            // to_ipv4_mapped only unwraps the RFC 4291 ::ffff:a.b.c.d form.
            // to_ipv4 (deprecated in favour of it, but still the only stdlib
            // method that also covers the older ::a.b.c.d IPv4-compatible
            // form) is kept here specifically to catch e.g. ::127.0.0.1,
            // which to_ipv4_mapped lets straight through.
            #[allow(deprecated)]
            if let Some(v4) = v6.to_ipv4() {
                return is_blocked(IpAddr::V4(v4));
            }
            let s = v6.segments();
            // NAT64 well-known prefix (RFC 6052, 64:ff9b::/96): the low 32
            // bits embed an IPv4 address reachable via a NAT64 gateway on
            // IPv6-only/DNS64 networks — must be unwrapped the same way.
            if s[0] == 0x0064 && s[1] == 0xff9b && s[2] == 0 && s[3] == 0 && s[4] == 0 && s[5] == 0 {
                let embedded = std::net::Ipv4Addr::new(
                    (s[6] >> 8) as u8, (s[6] & 0xff) as u8,
                    (s[7] >> 8) as u8, (s[7] & 0xff) as u8,
                );
                return is_blocked(IpAddr::V4(embedded));
            }
            (s[0] & 0xfe00) == 0xfc00 // unique local: fc00::/7
                || (s[0] & 0xffc0) == 0xfe80 // link-local unicast: fe80::/10
        }
    }
}

/// True if `url`'s host is an IP literal (`http://127.0.0.1/...`,
/// `http://169.254.169.254/...`) that names a blocked address. Hostname-based
/// SSRF is caught by `SsrfSafeResolver` below, but reqwest/hyper's connector
/// never invokes a custom `Resolve` when the host is already an IP literal —
/// there's nothing to resolve — so it would otherwise connect straight there,
/// completely bypassing the resolver-based guard. Must be checked explicitly
/// against both the initial request URL and every redirect target.
fn url_host_is_blocked(url: &reqwest::Url) -> bool {
    // Url::host(), not host_str() + parse::<IpAddr>(): host_str() returns an
    // IPv6 literal's host bracketed ("[::1]"), which IpAddr::from_str rejects
    // outright — silently defeating the check for exactly the case (IPv6
    // loopback) it most needs to catch. Host::Ipv6/Ipv4 sidestep the string
    // round-trip entirely.
    match url.host() {
        Some(url::Host::Ipv4(v4)) => is_blocked(IpAddr::V4(v4)),
        Some(url::Host::Ipv6(v6)) => is_blocked(IpAddr::V6(v6)),
        _ => false,
    }
}

/// A `reqwest::dns::Resolve` that performs ordinary DNS resolution and then
/// rejects the result if any resolved address is non-public. Since reqwest
/// re-resolves through this same resolver on every redirect hop, this also
/// blocks a public hostname that redirects to an internal address. Does
/// *not* cover IP-literal hosts — see `url_host_is_blocked` above.
#[derive(Debug, Default)]
struct SsrfSafeResolver;

impl Resolve for SsrfSafeResolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let host = name.as_str().to_string();
            let addrs: Vec<SocketAddr> = tauri::async_runtime::spawn_blocking(move || {
                // Port 0 is the documented placeholder for `Resolve` impls — the
                // caller substitutes the real port (from the URL or the scheme's
                // default) before connecting.
                (host.as_str(), 0u16).to_socket_addrs()
            })
            .await
            .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
                format!("DNS lookup task failed: {e}").into()
            })?
            .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
                format!("DNS lookup failed: {e}").into()
            })?
            .collect();

            if addrs.is_empty() {
                return Err("DNS lookup returned no addresses".into());
            }
            if let Some(blocked) = addrs.iter().find(|a| is_blocked(a.ip())) {
                return Err(format!(
                    "refusing to connect to non-public address {}",
                    blocked.ip()
                )
                .into());
            }

            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

/// Builds an HTTP client for fetching URLs taken from document content
/// (remote image embeds, "Import from URL"). DNS resolution — including on
/// every redirect hop — rejects loopback/private/link-local targets; the
/// redirect policy additionally rejects a redirect straight to an IP literal,
/// which never goes through DNS resolution at all. The redirect policy only
/// ever sees hop 2 onward, so the *initial* request URL also needs checking
/// with `url_host_is_blocked`: `fetch_capped` (via `preflight`) does that, and
/// is the only way the rest of the app reaches this client.
fn build_ssrf_safe_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .dns_resolver(Arc::new(SsrfSafeResolver))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if url_host_is_blocked(attempt.url()) {
                attempt.error("refusing to redirect to a non-public address")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| format!("client error: {e}"))
}

// ── Guarded fetch ───────────────────────────────────────────────────────
//
// Every outbound request built from document or theme content goes through
// `fetch_capped`, which performs the whole sequence (scheme check, IP-literal
// check, SSRF-safe client, request, status check, content-type check, size
// cap) in one place, so no caller can forget a step.

/// What kind of request `fetch_capped` makes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FetchKind {
    /// A GET whose body is read (up to `max_bytes`) and returned.
    Get,
    /// A reachability check: HEAD, falling back to a one-byte ranged GET when
    /// the server rejects HEAD (405/501) or the HEAD request fails outright.
    /// No body is read, so `accept` and `max_bytes` do not apply.
    Probe,
}

/// Per-caller options for `fetch_capped`.
#[derive(Clone, Copy, Debug)]
pub struct FetchOpts {
    /// Reject `http://` URLs, allowing only `https://`.
    pub https_only: bool,
    /// Maximum body size in bytes, checked against Content-Length up front
    /// and against the bytes actually received while reading.
    pub max_bytes: u64,
    /// Accepted Content-Type prefixes. `None` accepts anything. With `Some`,
    /// a missing (or non-ASCII) Content-Type is also accepted.
    pub accept: Option<&'static [&'static str]>,
    pub kind: FetchKind,
}

/// Content types `fetch_url_text` ("Import from URL") accepts.
pub const TEXT_CONTENT_TYPES: &[&str] =
    &["text/", "application/json", "application/xml", "application/xhtml"];

/// A successful `fetch_capped` response.
#[derive(Debug)]
pub struct Fetched {
    /// The body. Always empty for `FetchKind::Probe`.
    pub bytes: Vec<u8>,
    /// The raw Content-Type header, if present and valid ASCII.
    pub content_type: Option<String>,
}

/// Why `fetch_capped` failed. `Display` gives the messages the network
/// commands have always returned; callers that used different wording
/// (font download) map the variants themselves.
#[derive(Debug, PartialEq, Eq)]
pub enum FetchError {
    BadScheme { https_only: bool },
    InvalidUrl(String),
    Blocked,
    Client(String),
    Send(String),
    Status(reqwest::StatusCode),
    ContentType(String),
    TooLarge { max_bytes: u64 },
    Read(String),
}

impl std::fmt::Display for FetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FetchError::BadScheme { https_only: true } => write!(f, "URL must use HTTPS"),
            FetchError::BadScheme { https_only: false } => write!(f, "URL must use HTTP or HTTPS"),
            FetchError::InvalidUrl(e) => write!(f, "invalid URL: {e}"),
            FetchError::Blocked => write!(f, "refusing to connect to a non-public address"),
            // build_ssrf_safe_client's message already carries its prefix.
            FetchError::Client(e) => write!(f, "{e}"),
            FetchError::Send(e) => write!(f, "fetch failed: {e}"),
            FetchError::Status(s) => write!(f, "fetch failed: HTTP {s}"),
            FetchError::ContentType(ct) => write!(f, "unexpected Content-Type: {ct}"),
            FetchError::TooLarge { max_bytes } => {
                write!(f, "response too large (max {} MB)", max_bytes / (1024 * 1024))
            }
            FetchError::Read(e) => write!(f, "read failed: {e}"),
        }
    }
}

impl From<FetchError> for String {
    fn from(e: FetchError) -> String {
        e.to_string()
    }
}

/// The checks that need no network: scheme, URL syntax, and IP-literal host.
/// Exposed so a caller can fail fast before doing other work (the font
/// command checks the URL before its cache lookup); `fetch_capped` always
/// runs it again itself.
pub fn preflight(url: &str, opts: &FetchOpts) -> Result<reqwest::Url, FetchError> {
    let scheme_ok = url.starts_with("https://") || (!opts.https_only && url.starts_with("http://"));
    if !scheme_ok {
        return Err(FetchError::BadScheme { https_only: opts.https_only });
    }
    let parsed = reqwest::Url::parse(url).map_err(|e| FetchError::InvalidUrl(e.to_string()))?;
    if url_host_is_blocked(&parsed) {
        return Err(FetchError::Blocked);
    }
    Ok(parsed)
}

fn check_content_type(ct: &str, accept: Option<&[&str]>) -> Result<(), FetchError> {
    match accept {
        None => Ok(()),
        Some(prefixes) if ct.is_empty() || prefixes.iter().any(|p| ct.starts_with(p)) => Ok(()),
        Some(_) => Err(FetchError::ContentType(ct.to_string())),
    }
}

fn check_content_length(len: Option<u64>, max_bytes: u64) -> Result<(), FetchError> {
    if len.unwrap_or(0) > max_bytes {
        Err(FetchError::TooLarge { max_bytes })
    } else {
        Ok(())
    }
}

/// A body that arrives in chunks. Lets `read_capped` be tested without a
/// network connection.
trait ChunkSource {
    type Chunk: AsRef<[u8]>;
    async fn next_chunk(&mut self) -> Result<Option<Self::Chunk>, String>;
}

impl ChunkSource for reqwest::Response {
    type Chunk = bytes::Bytes;
    async fn next_chunk(&mut self) -> Result<Option<Self::Chunk>, String> {
        self.chunk().await.map_err(|e| e.to_string())
    }
}

/// Reads the whole body, failing as soon as it exceeds `max_bytes` rather
/// than buffering an arbitrarily large response first.
async fn read_capped<S: ChunkSource>(src: &mut S, max_bytes: u64) -> Result<Vec<u8>, FetchError> {
    let mut body = Vec::new();
    while let Some(chunk) = src.next_chunk().await.map_err(FetchError::Read)? {
        body.extend_from_slice(chunk.as_ref());
        if body.len() as u64 > max_bytes {
            return Err(FetchError::TooLarge { max_bytes });
        }
    }
    Ok(body)
}

fn content_type_of(resp: &reqwest::Response) -> Option<String> {
    resp.headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
}

/// The one guarded outbound fetch. Runs `preflight`, then makes the request
/// with the SSRF-safe client (which also guards DNS results and redirects),
/// then checks status, Content-Type and size according to `opts`.
pub async fn fetch_capped(url: &str, opts: &FetchOpts) -> Result<Fetched, FetchError> {
    let parsed = preflight(url, opts)?;
    let client = build_ssrf_safe_client().map_err(FetchError::Client)?;

    if opts.kind == FetchKind::Probe {
        return probe(&client, parsed).await;
    }

    let mut resp = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| FetchError::Send(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(FetchError::Status(resp.status()));
    }
    let content_type = content_type_of(&resp);
    check_content_type(content_type.as_deref().unwrap_or(""), opts.accept)?;
    check_content_length(resp.content_length(), opts.max_bytes)?;
    let bytes = read_capped(&mut resp, opts.max_bytes).await?;
    Ok(Fetched { bytes, content_type })
}

async fn probe(client: &reqwest::Client, url: reqwest::Url) -> Result<Fetched, FetchError> {
    let ok = |resp: &reqwest::Response| Fetched { bytes: Vec::new(), content_type: content_type_of(resp) };
    match client.head(url.clone()).send().await {
        Ok(resp) if resp.status().is_success() => return Ok(ok(&resp)),
        Ok(resp) if !matches!(resp.status().as_u16(), 405 | 501) => {
            return Err(FetchError::Status(resp.status()))
        }
        // 405/501 (HEAD not supported) or HEAD failed outright: try a GET.
        _ => {}
    }
    let resp = client
        .get(url)
        .header(reqwest::header::RANGE, "bytes=0-0")
        .send()
        .await
        .map_err(|e| FetchError::Send(e.to_string()))?;
    if resp.status().is_success() {
        Ok(ok(&resp))
    } else {
        Err(FetchError::Status(resp.status()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_loopback_private_and_link_local() {
        for addr in [
            "127.0.0.1", "127.53.0.1", "169.254.169.254", "10.0.0.1", "172.16.0.1",
            "192.168.1.1", "0.0.0.0", "::1", "fe80::1", "fc00::1",
        ] {
            let ip: IpAddr = addr.parse().unwrap();
            assert!(is_blocked(ip), "{addr} should be blocked");
        }
    }

    #[test]
    fn allows_public_addresses() {
        for addr in ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"] {
            let ip: IpAddr = addr.parse().unwrap();
            assert!(!is_blocked(ip), "{addr} should be allowed");
        }
    }

    #[test]
    fn blocks_cgnat_shared_address_space() {
        // 100.64.0.0/10 (RFC 6598) — not covered by Ipv4Addr::is_private().
        // 100.100.100.200 is Alibaba Cloud's instance-metadata endpoint.
        for addr in ["100.64.0.1", "100.100.100.200", "100.127.255.254"] {
            let ip: IpAddr = addr.parse().unwrap();
            assert!(is_blocked(ip), "{addr} should be blocked");
        }
        // Just outside the /10 on both sides must stay allowed.
        for addr in ["100.63.255.255", "100.128.0.0"] {
            let ip: IpAddr = addr.parse().unwrap();
            assert!(!is_blocked(ip), "{addr} should be allowed");
        }
    }

    #[test]
    fn blocks_ipv4_compatible_and_nat64_embedded_addresses() {
        // Deprecated IPv4-compatible form (::a.b.c.d, distinct from the
        // ::ffff:a.b.c.d mapped form) and the NAT64 well-known prefix
        // (64:ff9b::/96) both smuggle a blocked IPv4 address inside an IPv6
        // literal that to_ipv4_mapped alone does not unwrap.
        for addr in ["::127.0.0.1", "::169.254.169.254", "64:ff9b::a9fe:a9fe" /* 169.254.169.254 */] {
            let ip: IpAddr = addr.parse().unwrap();
            assert!(is_blocked(ip), "{addr} should be blocked");
        }
        // A NAT64-embedded public address must stay allowed.
        let ip: IpAddr = "64:ff9b::0808:0808".parse().unwrap(); // 8.8.8.8
        assert!(!is_blocked(ip), "{ip} should be allowed");
    }

    #[test]
    fn blocks_ip_literal_urls_that_never_reach_the_dns_resolver() {
        for url in [
            "http://127.0.0.1/",
            "http://127.0.0.1:8998/fixture.md",
            "http://169.254.169.254/latest/meta-data/",
            "http://[::1]/",
            "https://10.0.0.5/internal",
        ] {
            let parsed = reqwest::Url::parse(url).unwrap();
            assert!(url_host_is_blocked(&parsed), "{url} should be blocked");
        }
    }

    #[test]
    fn allows_public_hostname_and_ip_urls() {
        for url in ["https://raw.githubusercontent.com/x", "https://8.8.8.8/"] {
            let parsed = reqwest::Url::parse(url).unwrap();
            assert!(!url_host_is_blocked(&parsed), "{url} should be allowed");
        }
    }

    // ── fetch_capped ────────────────────────────────────────────────────

    const GET_ANY: FetchOpts = FetchOpts {
        https_only: false,
        max_bytes: 20 * 1024 * 1024,
        accept: None,
        kind: FetchKind::Get,
    };

    #[test]
    fn fetch_capped_rejects_blocked_ip_literal_before_any_network() {
        // fetch_capped must do the IP-literal check itself: a blocked URL
        // fails with Blocked without a connection ever being attempted.
        for url in ["http://127.0.0.1/x.png", "http://169.254.169.254/", "https://[::1]/"] {
            let err = tauri::async_runtime::block_on(fetch_capped(url, &GET_ANY)).unwrap_err();
            assert_eq!(err, FetchError::Blocked, "{url}");
            assert_eq!(err.to_string(), "refusing to connect to a non-public address");
        }
        let probe = FetchOpts { kind: FetchKind::Probe, ..GET_ANY };
        let err = tauri::async_runtime::block_on(fetch_capped("http://10.0.0.1/", &probe)).unwrap_err();
        assert_eq!(err, FetchError::Blocked);
    }

    #[test]
    fn preflight_rejects_http_when_https_only() {
        let https_only = FetchOpts { https_only: true, ..GET_ANY };
        let err = preflight("http://example.com/font.woff2", &https_only).unwrap_err();
        assert_eq!(err, FetchError::BadScheme { https_only: true });
        assert_eq!(err.to_string(), "URL must use HTTPS");
        assert!(preflight("https://example.com/font.woff2", &https_only).is_ok());
        // Without https_only, plain http is fine but other schemes are not.
        assert!(preflight("http://example.com/a.png", &GET_ANY).is_ok());
        let err = preflight("file:///etc/passwd", &GET_ANY).unwrap_err();
        assert_eq!(err.to_string(), "URL must use HTTP or HTTPS");
        // The scheme check runs before the host check, as each caller did.
        let err = preflight("http://127.0.0.1/", &https_only).unwrap_err();
        assert_eq!(err, FetchError::BadScheme { https_only: true });
    }

    #[test]
    fn rejects_oversize_content_length() {
        let max = 20 * 1024 * 1024;
        assert_eq!(check_content_length(Some(max + 1), max), Err(FetchError::TooLarge { max_bytes: max }));
        assert_eq!(check_content_length(Some(max), max), Ok(()));
        assert_eq!(check_content_length(None, max), Ok(()));
        assert_eq!(
            FetchError::TooLarge { max_bytes: max }.to_string(),
            "response too large (max 20 MB)"
        );
    }

    #[test]
    fn read_capped_stops_once_body_exceeds_cap() {
        let ok = tauri::async_runtime::block_on(read_capped(
            &mut TestChunks(vec![b"abc".to_vec(), b"de".to_vec()].into()),
            5,
        ));
        assert_eq!(ok, Ok(b"abcde".to_vec()));
        // No Content-Length (or a lying one): the cap is enforced on the
        // bytes actually received.
        let err = tauri::async_runtime::block_on(read_capped(
            &mut TestChunks(vec![b"abc".to_vec(), b"def".to_vec()].into()),
            5,
        ));
        assert_eq!(err, Err(FetchError::TooLarge { max_bytes: 5 }));
    }

    #[test]
    fn rejects_wrong_content_type() {
        let err = check_content_type("image/png", Some(TEXT_CONTENT_TYPES)).unwrap_err();
        assert_eq!(err.to_string(), "unexpected Content-Type: image/png");
        for ok in ["", "text/markdown; charset=utf-8", "application/json", "application/xml", "application/xhtml+xml"] {
            assert!(check_content_type(ok, Some(TEXT_CONTENT_TYPES)).is_ok(), "{ok}");
        }
        // accept: None means any content type is fine (image fetch, fonts).
        assert!(check_content_type("application/octet-stream", None).is_ok());
    }

    #[test]
    fn error_messages_match_the_strings_callers_returned_before() {
        assert_eq!(FetchError::Send("boom".into()).to_string(), "fetch failed: boom");
        assert_eq!(
            FetchError::Status(reqwest::StatusCode::NOT_FOUND).to_string(),
            "fetch failed: HTTP 404 Not Found"
        );
        assert_eq!(FetchError::Read("eof".into()).to_string(), "read failed: eof");
        assert!(preflight("http://", &GET_ANY).unwrap_err().to_string().starts_with("invalid URL: "));
    }

    struct TestChunks(std::collections::VecDeque<Vec<u8>>);
    impl ChunkSource for TestChunks {
        type Chunk = Vec<u8>;
        async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, String> {
            Ok(self.0.pop_front())
        }
    }
}
