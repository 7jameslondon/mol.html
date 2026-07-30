`gh auth status` can falsely report an invalid token inside a sandbox, so run GitHub CLI authentication checks with escalated (outside-sandbox) permissions if `gh` is required.

## License

The mol.html project code is available under the [MIT License](LICENSE).
Third-party terms and attributions are recorded in
[THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt). Every built `.mol.html`
file embeds both texts in a canonical, integrity-checked notice block. Dependency
or renderer-bundle changes require an explicit review and update of
`legal/third-party-manifest.json`; otherwise the build fails.
