# OpenAgent App — historical repository

> [!IMPORTANT]
> New App development and coordinated releases live in the canonical
> [`openagent`](https://github.com/openagent-uno/openagent/tree/main/apps/app)
> monorepo. This repository remains writable only for the signed updater
> transition used by installed 0.x clients. Its tags and release assets will be
> preserved when the repository is archived after verification.

Current downloads: <https://openagent.uno/downloads>

The manually dispatched **Canonical App updater bridge** builds an exact public
`openagent-uno/openagent` main commit from `apps/app`, using this repository only
as the existing signing and updater executor. Supply the full source SHA and
matching package version. Admission checks both package locks, application ID,
updater feed, macOS signing requirements and all six host-tools pins before
installing dependencies. No App source is copied into this historical repo.

The six native builds and packaged-artifact checks, including Intel macOS
installer launches, must pass before the workflow creates a draft. Each platform
manifest identifies both canonical payload and executor commits. The merged
asset inventory is checked again against the uploaded draft; publication remains
a separate review step. Existing releases are never replaced. Standard public
GitHub runners are used; temporary build artifacts expire after one day.

Run the bridge admission regressions with
`node --test .github/scripts/canonical-app-source.test.mjs`.
