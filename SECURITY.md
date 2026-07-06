# Security

## Reporting a vulnerability

Report privately via [GitHub Security
Advisories](https://github.com/KovaMD/Kova/security/advisories/new) — visible
only to you and the maintainers until a fix ships. Or ping us in the [Matrix
room](https://matrix.to/#/#kova-md:matrix.org) and we'll open the advisory.
Please don't use public issues. We aim to acknowledge within a few days.

## Verifying a download

You don't have to trust the release binaries blindly — every release can be
checked back to the source.

### 1. Build provenance (recommended)

Each release binary carries a signed [build provenance
attestation](https://docs.github.com/actions/security-guides/using-artifact-attestations):
a cryptographic record tying that exact file to the commit and the GitHub
Actions run that built it. Verify with the [GitHub CLI](https://cli.github.com/):

```bash
gh attestation verify Kova_Linux.deb --repo KovaMD/Kova
```

A pass means the file was produced by Kova's release workflow from this
repository, unmodified since. Works for any release asset (`.dmg`, `.msi`,
`.exe`, `.deb`, `.rpm`, `.AppImage`).

### 2. Rebuild from source (Nix)

For full reproducibility, rebuild from pinned source instead of trusting a
prebuilt binary — the flake pins every input (toolchain, npm, cargo):

```bash
nix build github:KovaMD/Kova
```

### 3. Package repositories

The APT and RPM repositories (`deb.kova.md`, `rpm.kova.md`) are GPG-signed;
`apt`/`dnf` verify signatures automatically once the key is added (see the
README). Desktop auto-updates are signed with Tauri's updater key.

## What runs on the code

- Dependency and code scanning via [Snyk](https://snyk.io) on pull requests.
- Releases are built only from tagged commits on this repository, in GitHub
  Actions, with the provenance attestation above.
