`gh auth status` can falsely report an invalid token inside a sandbox, so run GitHub CLI authentication checks with escalated (outside-sandbox) permissions if `gh` is required.
