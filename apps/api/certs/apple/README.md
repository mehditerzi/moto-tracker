# Apple Root CA certificates

These are **public** Apple root certificates, used by
`@apple/app-store-server-library` to verify the signature chain of StoreKit
transactions and App Store Server Notifications. They contain no secrets and are
safe to commit.

Source: https://www.apple.com/certificateauthority/

- `AppleRootCA-G3.cer` — the root that anchors modern App Store JWS signatures
  (this is the one that actually matters for IAP verification).
- `AppleRootCA-G2.cer` — kept for completeness / older chains.

If Apple rotates roots, re-download from the URL above and drop the `.cer`
(DER-encoded) files here. The loader reads every `*.cer`/`*.der`/`*.pem` in this
directory. Override the location with `IAP_APPLE_ROOT_CA_DIR`.
