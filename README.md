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
GitHub runners are used. Native files move through unpublished, run-owned
transfer releases rather than Actions artifact or cache storage. The original
source, executor, run and attempt remain part of each transfer proof.

Run the bridge admission regressions with
`node --test .github/scripts/canonical-app-source.test.mjs`.

For the reviewed Apple stapler network failure, **Recover reviewed canonical
App macOS failure** first runs with `validation_only=true`. This checks source,
transfer and recovery regressions plus bounded access to the original failed
build log, without native builds or draft creation. The actual recovery uses
the unchanged canonical payload and version, the exact original run/attempt,
executor and staging release ID, and only the failed macOS subset. It reuses
successful native files unchanged, preserves their original provenance and
executes the remaining installer and aggregate release gates. Signing and
notarization requirements remain enforced.

A recovered draft records per-platform original/recovery executors and run
identities; it never reports the original failed run as successful. Review the
exact final asset set and recovery receipt before publication. Preserve both
transfer drafts until final publication and checksum verification, then remove
only those owned drafts. A failed job rerun cannot silently borrow a transfer
from a different run attempt.
