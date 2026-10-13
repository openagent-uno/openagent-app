#!/usr/bin/env python3
"""UNEXECUTED private candidate; not release or installed-package acceptance."""
import argparse
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import secrets
import shutil
import signal
import stat
import subprocess
import sys
import tempfile

TEAM = "B4KWCQFY8V"
SCHEMA = "qualified-keychain-candidate-v1"
PREFIX = "signing-keychain-"
LIMIT = 2 * 1024 * 1024
CANARY_SOURCE = b"int main(void){return 0;}\n"


class BridgeError(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise BridgeError(reason)


def application_id():
    value = os.environ.get("SIGNING_APPLICATION_ID", "")
    require(len(value) <= 255 and re.fullmatch(r"(?:[A-Za-z][A-Za-z0-9-]*\.)+[A-Za-z][A-Za-z0-9-]*", value),
            "explicit-reverse-dns-application-id")
    return value


def regular_private(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1,
            "private-file-contract")
    require(info.st_size <= LIMIT, "private-file-size")
    return path.read_bytes()


def write_private(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(data)


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()


def parse_search_list(raw):
    # Preserve every path and its ordering; never strip internal quotes.
    result = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        require(line.startswith('"') and line.endswith('"'), "keychain-list-format")
        path = line[1:-1]
        require(path.startswith("/") and not any(c in path for c in ('"', '\n', '\r', '\0')),
                "keychain-list-path")
        require(path not in result, "keychain-list-duplicate")
        result.append(path)
    require(bool(result) and len(result) <= 32, "keychain-list-count")
    return result


def identity_from_output(raw):
    rows = re.findall(r'^\s*\d+\) ([0-9A-F]{40}) "(Developer ID Application: [^"\r\n]+)"\s*$',
                      raw, flags=re.M)
    require(len(rows) == 1 and rows[0][1].endswith(" (" + TEAM + ")"),
            "developer-id-identity")
    return rows[0]


def hosted_context():
    require(sys.platform == "darwin" and os.environ.get("GITHUB_ACTIONS") == "true"
            and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
            and os.environ.get("RUNNER_OS") == "macOS", "hosted-macos-only")
    run_id = os.environ.get("GITHUB_RUN_ID", "")
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "")
    source = os.environ.get("GITHUB_SHA", "")
    require(run_id.isdigit() and attempt.isdigit() and re.fullmatch(r"[0-9a-f]{40}", source),
            "github-context")
    require(os.environ.get("GITHUB_REPOSITORY") == "openagent-uno/openagent-app"
            and os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch", "executor-context")
    root = Path(os.environ.get("RUNNER_TEMP", ""))
    require(root.is_absolute() and root.is_dir() and not root.is_symlink()
            and root.resolve() == root and not any(c in str(root) for c in ('\n', '\r', '\0')),
            "runner-temp")
    return root, {"runId": run_id, "runAttempt": attempt, "executorCommit": source,
                  "job": os.environ.get("GITHUB_JOB", ""),
                  "executorRepository": os.environ["GITHUB_REPOSITORY"],
                  "applicationId": application_id()}


def child_environment():
    env = dict(os.environ)
    for key in ("CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_APP_SPECIFIC_PASSWORD"):
        env.pop(key, None)
    return env


def command(args, phase, *, input_data=None, environment=None, cwd=None):
    # All output remains private in memory, including security errors; argv is
    # never emitted. No subprocess inherits the PKCS12 or its password.
    try:
        result = subprocess.run(args, input=input_data, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE,
                                env=child_environment() if environment is None else environment,
                                cwd=cwd, timeout=90, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise BridgeError(phase + "-execution") from None
    require(len(result.stdout) <= LIMIT and len(result.stderr) <= LIMIT, phase + "-output-size")
    if result.returncode != 0:
        reason = phase + "-failed"
        if phase == "canary-execute":
            if result.returncode < 0:
                try:
                    name = signal.Signals(-result.returncode).name
                except ValueError:
                    name = "OTHER"
                reason += ": signal=" + name
            else:
                reason += ": exit=" + (str(result.returncode) if result.returncode <= 255 else "OTHER")
        raise BridgeError(reason)
    return result.stdout


def compile_canary(root):
    # The helper itself rechecks the hosted guard before any file or compiler
    # operation. Its sole input is the existing owned root, not external code.
    runner_temp, context = hosted_context()
    require(root.parent == runner_temp and re.fullmatch(PREFIX + r"[A-Za-z0-9_-]+", root.name),
            "canary-owned-root")
    info = root.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == 0o700 and root.resolve() == root,
            "canary-owned-root-contract")
    state = json.loads(regular_private(root / "ownership.json"))
    require(state.get("context") == context and state.get("ownedRoot") == str(root),
            "canary-owned-state")
    architecture = platform.machine()
    require(architecture in ("arm64", "x86_64"), "canary-native-architecture")
    source = root / "signing-canary.c"
    canary = root / "signing-canary"
    require(not canary.exists() and not canary.is_symlink(), "canary-fresh-output")
    write_private(source, CANARY_SOURCE)
    # No inherited CFLAGS, LDFLAGS, CPATH, SDKROOT, DEVELOPER_DIR, DYLD_* or
    # external library/loader inputs. Only the runner's Apple SDK/toolchain.
    environment = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "TMPDIR": str(root)}
    command(["/usr/bin/xcrun", "--sdk", "macosx", "clang", "-arch", architecture,
             "-Werror", "-O0", "-x", "c", str(source), "-o", str(canary)],
            "canary-compile", environment=environment, cwd=root)
    info = canary.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1,
            "canary-output-contract")
    os.chmod(canary, 0o700)
    return canary


def search_list():
    return parse_search_list(command(["/usr/bin/security", "list-keychains", "-d", "user"],
                                     "search-list").decode("utf-8"))


def cert_proof(pem, identity_hash):
    blocks = re.findall(rb"-----BEGIN CERTIFICATE-----\s+([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----", pem)
    matched = []
    for block in blocks:
        der = base64.b64decode(re.sub(rb"\s", b"", block), validate=True)
        if hashlib.sha1(der).hexdigest().upper() == identity_hash:
            matched.append(der)
    require(len(matched) == 1, "identity-certificate-binding")
    der = matched[0]
    subject = command(["/usr/bin/openssl", "x509", "-inform", "DER", "-noout", "-subject",
                       "-nameopt", "sep_multiline,sname,space_eq"], "certificate-subject", input_data=der).decode()
    ous = re.findall(r"^\s*OU\s*=\s*([^\r\n]+)$", subject, re.M)
    cns = re.findall(r"^\s*CN\s*=\s*([^\r\n]+)$", subject, re.M)
    require(ous == [TEAM] and len(cns) == 1 and cns[0].startswith("Developer ID Application:"),
            "certificate-team-ou")
    dates = command(["/usr/bin/openssl", "x509", "-inform", "DER", "-noout", "-dates"],
                    "certificate-dates", input_data=der).decode()
    parsed = dict(line.split("=", 1) for line in dates.splitlines())
    now = datetime.datetime.now(datetime.timezone.utc)
    def date(value):
        return datetime.datetime.strptime(value, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=datetime.timezone.utc)
    require(date(parsed["notBefore"]) <= now < date(parsed["notAfter"]), "certificate-validity")
    return hashlib.sha256(der).hexdigest()


def owned_state(receipt, runner_temp, context):
    report = json.loads(regular_private(receipt))
    require(report.get("schema") == SCHEMA and report.get("context") == context
            and report.get("team") == TEAM and report.get("applicationId") == application_id(),
            "receipt-context")
    root = Path(report["ownedRoot"])
    require(root.parent == runner_temp and re.fullmatch(PREFIX + r"[A-Za-z0-9_-]+", root.name),
            "owned-root-path")
    info = root.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == 0o700 and root.resolve() == root, "owned-root-contract")
    data = regular_private(root / "ownership.json")
    require(hashlib.sha256(data).hexdigest() == report.get("ownershipSHA256"), "ownership-hash")
    state = json.loads(data)
    require(state.get("context") == context and state.get("ownedRoot") == str(root)
            and state.get("nonce") == report.get("ownershipNonce")
            and state.get("keychain") == str(root / "sign.keychain-db"), "ownership-binding")
    require(parse_search_list("\n".join('"' + item + '"' for item in state["originalSearchList"]))
            == state["originalSearchList"], "snapshot-contract")
    return report, state


def cleanup_state(state):
    keychain = state["keychain"]
    root = Path(state["ownedRoot"])
    # Check ownership/no links BEFORE passing any path to security deletion.
    for path in root.iterdir():
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                and info.st_nlink == 1, "cleanup-owned-file-contract")
    command(["/usr/bin/security", "list-keychains", "-d", "user", "-s",
             *state["originalSearchList"]], "restore-search-list")
    require(search_list() == state["originalSearchList"], "restored-search-list-mismatch")
    if Path(keychain).exists():
        command(["/usr/bin/security", "delete-keychain", keychain], "delete-owned-keychain")
    require(not Path(keychain).exists(), "owned-keychain-still-present")
    # Validate descendants before removing this exact generated owned root.
    for path in root.iterdir():
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                and info.st_nlink == 1, "cleanup-owned-file-contract")
    shutil.rmtree(root)


def prepare(args, runner_temp, context):
    app_id = application_id()
    require(args.team == TEAM and args.application_id == app_id
            and context.get("applicationId") == app_id, "requested-identity")
    require(not os.environ.get("CSC_NAME") and not os.environ.get("CSC_KEYCHAIN"),
            "no-existing-identity-fallback")
    require(os.environ.get("APPLE_TEAM_ID") == TEAM, "secret-team-contract")
    encoded = os.environ.get("CSC_LINK", "")
    password = os.environ.get("CSC_KEY_PASSWORD", "")
    require(encoded and password and len(encoded) <= LIMIT, "pkcs12-input")
    try:
        p12 = base64.b64decode(re.sub(r"\s", "", encoded), validate=True)
    except ValueError:
        raise BridgeError("pkcs12-base64-only") from None
    require(0 < len(p12) <= LIMIT, "pkcs12-size")
    receipt = Path(args.receipt)
    require(receipt.parent == runner_temp and not receipt.exists() and not receipt.is_symlink()
            and re.fullmatch(r"[A-Za-z0-9_-]+\.json", receipt.name),
            "fresh-receipt-path")
    env_file = Path(os.environ.get("GITHUB_ENV", ""))
    require(env_file.is_absolute() and env_file.is_file() and not env_file.is_symlink(), "github-env-file")
    original = search_list()
    root = Path(tempfile.mkdtemp(prefix=PREFIX, dir=runner_temp))
    os.chmod(root, 0o700)
    state = {"context": context, "originalSearchList": original, "ownedRoot": str(root),
             "keychain": str(root / "sign.keychain-db"), "nonce": secrets.token_hex(32)}
    state_bytes = json_bytes(state)
    transferred = False
    try:
        write_private(root / "ownership.json", state_bytes)
        keychain = state["keychain"]
        keychain_password = secrets.token_hex(32)
        write_private(root / "identity.p12", p12)
        command(["/usr/bin/security", "create-keychain", "-p", keychain_password, keychain], "create-keychain")
        command(["/usr/bin/security", "unlock-keychain", "-p", keychain_password, keychain], "unlock-keychain")
        command(["/usr/bin/security", "set-keychain-settings", "-lut", "7200", keychain], "keychain-settings")
        command(["/usr/bin/security", "list-keychains", "-d", "user", "-s", keychain, *original], "temporary-search-list")
        require(search_list() == [keychain, *original], "temporary-search-list-mismatch")
        command(["/usr/bin/security", "import", str(root / "identity.p12"), "-k", keychain,
                 "-P", password, "-T", "/usr/bin/codesign"], "import-keychain")
        (root / "identity.p12").unlink()
        command(["/usr/bin/security", "set-key-partition-list", "-S", "apple-tool:,apple:,codesign:",
                 "-s", "-k", keychain_password, keychain], "key-partition-list")
        digest, name = identity_from_output(command(["/usr/bin/security", "find-identity", "-v",
                                                     "-p", "codesigning", keychain], "find-identity").decode())
        certificate_sha = cert_proof(command(["/usr/bin/security", "find-certificate", "-a", "-p", keychain],
                                              "find-certificate"), digest)
        # A tiny first-party native canary avoids re-signing an OS platform
        # executable. Signature, timestamp, execution and cleanup stay mandatory.
        canary = compile_canary(root)
        command(["/usr/bin/codesign", "--force", "--sign", digest, "--keychain", keychain,
                 "--options", "runtime", "--timestamp", "--identifier", app_id + ".signing-canary",
                 str(canary)], "canary-sign")
        command(["/usr/bin/codesign", "--verify", "--strict", str(canary)], "canary-verify")
        # codesign emits display output on stderr. Keep it private, then inspect
        # exact identity; ordinary command() deliberately never returns stderr.
        display = subprocess.run(["/usr/bin/codesign", "-dv", "--verbose=4", str(canary)],
                                 capture_output=True, timeout=30, check=False, env=child_environment())
        require(display.returncode == 0 and len(display.stderr) <= LIMIT, "canary-display")
        details = display.stderr.decode()
        require("TeamIdentifier=" + TEAM + "\n" in details
                and "Identifier=" + app_id + ".signing-canary\n" in details
                and "Authority=" + name + "\n" in details
                and re.search(r"flags=.*\(runtime\)", details) is not None
                and re.search(r"^Timestamp=.+$", details, re.M) is not None,
                "canary-signature-contract")
        command([str(canary)], "canary-execute")
        report = {"schema": SCHEMA, "context": context, "team": TEAM, "applicationId": app_id,
                  "ownedRoot": str(root), "ownershipNonce": state["nonce"],
                  "ownershipSHA256": hashlib.sha256(state_bytes).hexdigest(),
                  "keychain": keychain, "identitySHA1": digest, "certificateSHA256": certificate_sha,
                  "canarySHA256": hashlib.sha256(canary.read_bytes()).hexdigest(),
                  "canaryVerified": True, "canaryExecuted": True, "cleanupConfirmed": False,
                  "publicRelease": False, "packageQualified": False,
                  "scope": "hosted keychain and owned Developer ID canary only"}
        write_private(receipt, json_bytes(report))
        # 26.16.1 supports a SHA1 CSC_NAME qualifier; no Developer-ID prefix.
        # CSC_LINK / CSC_KEY_PASSWORD MUST be absent from subsequent steps.
        with env_file.open("a", encoding="utf-8") as handle:
            handle.write("CSC_NAME=" + digest + "\nCSC_KEYCHAIN=" + keychain
                         + "\nSIGNING_KEYCHAIN_RECEIPT=" + str(receipt) + "\n")
        transferred = True
    finally:
        if not transferred:
            cleanup_state(state)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("--cleanup-owned", action="store_true")
    parser.add_argument("--team")
    parser.add_argument("--application-id")
    parser.add_argument("--receipt", required=True)
    args = parser.parse_args()
    runner_temp, context = hosted_context()
    def interrupted(_number, _frame):
        raise BridgeError("interrupted")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    if args.cleanup_owned:
        receipt = Path(args.receipt)
        require(receipt.parent == runner_temp, "cleanup-receipt-path")
        report, state = owned_state(receipt, runner_temp, context)
        cleanup_state(state)
        report["cleanupConfirmed"] = True
        report["originalSearchListRestored"] = True
        report["ownedKeychainDeleted"] = True
        # Preserve the private evidence, updating only after actual restoration.
        temporary = receipt.with_name(receipt.name + ".cleanup")
        write_private(temporary, json_bytes(report))
        os.replace(temporary, receipt)
    else:
        prepare(args, runner_temp, context)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Whitelisted phase only: never traceback, command argv, certificate,
        # PKCS12, password, subprocess stdout/stderr or environment content.
        phase = str(error) if isinstance(error, BridgeError) else "unexpected-private-failure"
        print("Keychain candidate failed: " + phase, file=sys.stderr)
        sys.exit(1)
