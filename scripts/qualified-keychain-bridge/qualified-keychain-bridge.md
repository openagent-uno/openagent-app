# Generic hosted keychain bridge candidate — unexecuted

These source files and the isolated manual workflow are a draft. They have not
been tested, executed, imported into a keychain or dispatched. They do not
establish an operational signing channel, package acceptance, notarization or
release qualification. No credentials have been read locally.

The primary recipe reviewed was `packages/host-tools/scripts/sign_macos_bundle.sh`
at commit `aa8dafb3ef14066dbdaadbbf66bc9b3a00b801e0`. This candidate retains its
temporary owned keychain, PKCS12 import, partition-list setup, temporary search
list and restoration. There is no local `CSC_NAME` fallback. Only a reviewed
manual job in `openagent-uno/openagent-app`, on a GitHub-hosted macOS runner,
may reach an import. The existing trusted Team remains `B4KWCQFY8V`.

The public executor is generic. There is no adopter product, application ID,
payload or source in its code. `SIGNING_APPLICATION_ID` is mandatory, validated
as a bounded reverse-DNS identifier and must equal `--application-id`. An
example is `org.example.signing`. That explicit identifier is bound to context,
ownership receipt and actual canary signature; it is not a hardcoded default.
The qualification workflow takes it as a required manual input.

Preparation consumes base64-only `CSC_LINK`, `CSC_KEY_PASSWORD` and the matching
`APPLE_TEAM_ID`. It exports only `CSC_NAME` (the exact certificate SHA1 identity
qualifier), `CSC_KEYCHAIN` (owned path), and `SIGNING_KEYCHAIN_RECEIPT`. Passwords,
PKCS12 data, certificate dumps, command argv, errors and environments are never
emitted. The private preparation receipt binds executor SHA/run/attempt/job,
certificate SHA256, exact Team OU/identity, actual owned canary SHA256, and
ownership state. It is never uploaded. It explicitly records
`packageQualified=false` and `publicRelease=false`.

The signing canary is a copy of `/usr/bin/true` in the owned private directory,
signed with Developer ID, explicit `--keychain`, hardened runtime and trusted
timestamp. Verification must show exact Team, explicit application identifier
and Developer ID authority, followed by actual execution. No ad hoc signing,
`--deep` signing, global trust changes, key export or new permissions are used.

Lifetime is workflow-scoped: preparation restores/deletes on failure or TERM/INT;
after successful preparation a consumer's final `always()` cleanup step must
invoke `--cleanup-owned --receipt <the same receipt>`, with the same explicit
`SIGNING_APPLICATION_ID`. Cleanup validates the private ownership marker/hash,
restores the exact ordered original user search list and verifies it before
deleting only the owned keychain/root. Restoration failure retains evidence and
fails. Hard kill and runner eviction cannot run a trap: such a run is unqualified
and requires runner disposal. No persistent-host recovery or installer service
acceptance is claimed.

## Consumer integration contract

The published `app-builder-lib@26.16.1/out/macPackager.js` uses `CSC_KEYCHAIN`
only when `getCscLink()` is absent. Its `macCodeSign.js` accepts a matching SHA1
qualifier in `CSC_NAME`. Consumers **must omit/unset `CSC_LINK` and
`CSC_KEY_PASSWORD` in subsequent Electron Builder steps**, and must not set
`cscLink`/`cscInstallerLink` config or installer-import variables. Otherwise the
builder creates another keychain; this bridge does not hide or override that
behavior. See the primary [26.x signing documentation](https://www.electron.build/v26/docs/features/code-signing/).

## Future remote qualification only

`python3 qualified-keychain-bridge-tests.py CandidateContracts` contains ten
focused hosted-only contracts. All skip outside hosted macOS. The actual canary
test requires explicit `SIGNING_TEST_KEYCHAIN_BRIDGE=true` and a newly reviewed
remote job using existing secrets. No test has been run.

`qualified-keychain-bridge-qualification.yml` is an isolated future manual job:
only ten pure contracts and one actual owned canary, Python 3.12 and pinned
actions. It requires reviewed executor SHA == event SHA == checked-out Git HEAD.
It accepts no adopter source/payload, assembly, installer, notarization, new
secret or approval prompt. The repository may be public; only safe source/run,
application identifier, Team/certificate/canary hashes and cleanup booleans are
retained. No raw path, original search list, prepare receipt, keychain or log is
uploaded.

The reviewed peer must copy identical workflow bytes to
`scripts/qualified-keychain-bridge/qualified-keychain-bridge-qualification.yml`
and `.github/workflows/qualified-keychain-bridge-qualification.yml`, alongside
the three source files. The actual test creates a separate safe qualification
receipt only after restoration and deletion assertions succeed. The raw prepare
receipt keeps `cleanupConfirmed=false` and is never treated as the qualification
receipt. Source/workflow hashes and executor SHA/run/attempt are bound; both
`packageQualified` and `publicRelease` remain false. Only closed safe metadata
may become a seven-day artifact. No repository API write, workflow installation,
dispatch or signing has been performed for this candidate.
