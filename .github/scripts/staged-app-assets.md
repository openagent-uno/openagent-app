# Native App transfer staging

The manual canonical App bridge uses the existing job `GITHUB_TOKEN` and
`contents: write` permission to transfer verified native files through one
unpublished draft in this same repository. It does not use Actions artifacts
or caches. Native builds, signing, notarization, installer smoke tests,
attestations, final inventory checks and manual publication remain unchanged.

Each execution attempt owns a separate `app-staging-VERSION-RUN-ATTEMPT` draft.
Its body binds the canonical source, executor commit, repository and run.
Draft releases are accessible to repository writers; these transfer files are
not a published release or updater feed. Run the workflow from the reviewed
default-branch executor commit, with the exact canonical main source commit.

Files retain their original bytes. Staging asset names have a platform prefix;
a per-platform JSON index binds their original names, sizes and SHA256 hashes.
Uploads and downloads check GitHub's asset digest. Downloaded files recreate
the previous `artifacts/desktop-PLATFORM` structure; the Intel smoke job receives
its files directly in `artifacts`. No archive extraction is involved.

An existing platform transfer is never overwritten, and uploads are not
automatically retried. Every transfer checks that the staging draft remains
unpublished and belongs to this execution. A failure leaves this draft for
inspection. Do not publish a staging draft. Rerunning uses a new attempt ID.
After the final six-platform draft passes its existing exact inventory check,
the workflow deletes only its own staging draft. The final draft stays
unpublished for review. An interrupted run's staging draft can be removed
manually after confirming its body, run and source identities.

The helper tests cover source/run ownership, publication guards, file identity,
corruption, duplicates, oversized assets, and regular-file-only transfers.
They run in the existing Ubuntu source-admission job. The transfer workflow
itself still requires real six-platform release qualification before use.
