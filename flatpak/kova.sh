#!/bin/sh
# Disable WebKit's internal bubblewrap sandbox — it conflicts with the
# Flatpak sandbox (nested user namespaces are blocked).
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
exec /app/bin/kova-bin "$@"
