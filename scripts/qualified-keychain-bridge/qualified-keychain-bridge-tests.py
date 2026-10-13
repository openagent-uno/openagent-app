"""Future hosted-only candidate contracts; intentionally not executed locally."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("signing_keychain_candidate",
                                            Path(__file__).with_name("qualified-keychain-bridge.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
HOSTED = (sys.platform == "darwin" and os.environ.get("GITHUB_ACTIONS") == "true"
          and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted")


@unittest.skipUnless(HOSTED, "remote hosted macOS only; no local execution")
class CandidateContracts(unittest.TestCase):
    def test_search_list_preserves_spaces_and_order(self):
        self.assertEqual(bridge.parse_search_list('  "/owned/key chain-db"\n "/login/keychain-db"\n'),
                         ["/owned/key chain-db", "/login/keychain-db"])

    def test_malformed_duplicate_relative_search_list_denied(self):
        for value in ('"/a"\n"/a"', '"relative"', '/unquoted', '"/a\\n"\n"/b"\nnot-quoted'):
            with self.subTest(value=value), self.assertRaises(bridge.BridgeError):
                bridge.parse_search_list(value)

    def test_exact_developer_id(self):
        identity = 'A' * 40
        self.assertEqual(bridge.identity_from_output('  1) ' + identity
                         + ' "Developer ID Application: QA (' + bridge.TEAM + ')"\n'),
                         (identity, 'Developer ID Application: QA (' + bridge.TEAM + ')'))

    def test_wrong_team_ambiguous_ad_hoc_denied(self):
        row = '  1) ' + 'A' * 40 + ' "Developer ID Application: QA (' + bridge.TEAM + ')"\n'
        for value in (row + row, row.replace(bridge.TEAM, "WRONGTEAM1"), 'Signature=adhoc',
                      row.replace('Developer ID Application:', 'Apple Development:')):
            with self.subTest(value=value), self.assertRaises(bridge.BridgeError):
                bridge.identity_from_output(value)

    def test_child_environment_does_not_forward_import_secrets(self):
        with patch.dict(os.environ, {"CSC_LINK": "TEST_P12", "CSC_KEY_PASSWORD": "TEST_PASSWORD",
                                     "APPLE_APP_SPECIFIC_PASSWORD": "TEST_APP_PASSWORD"}):
            env = bridge.child_environment()
        self.assertTrue(all(key not in env for key in
                            ("CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_APP_SPECIFIC_PASSWORD")))

    def test_hosted_guard_precedes_commands(self):
        with patch.dict(os.environ, {"GITHUB_ACTIONS": "false"}), patch.object(bridge, "command") as command:
            with self.assertRaises(bridge.BridgeError):
                bridge.hosted_context()
            command.assert_not_called()
        for value in ("", "not-reverse-dns", "org..example", "org.*.signing", "org.example\nsecret", "a." + "b" * 256):
            with self.subTest(value=value), patch.dict(os.environ, {"SIGNING_APPLICATION_ID": value}):
                with self.assertRaises(bridge.BridgeError):
                    bridge.application_id()
        with patch.dict(os.environ, {"SIGNING_APPLICATION_ID": "org.example.signing"}):
            self.assertEqual(bridge.application_id(), "org.example.signing")

    def test_non_private_or_linked_receipt_denied(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "receipt.json"
            path.write_text("{}")
            path.chmod(0o644)
            with self.assertRaises(bridge.BridgeError):
                bridge.regular_private(path)
            path.chmod(0o600)
            os.link(path, root / "hardlink.json")
            with self.assertRaises(bridge.BridgeError):
                bridge.regular_private(path)

    def test_certificate_wrong_ou_not_accepted(self):
        import base64
        import hashlib
        der = b"TEST_CERTIFICATE_BYTES"
        pem = b"-----BEGIN CERTIFICATE-----\n" + base64.b64encode(der) + b"\n-----END CERTIFICATE-----"
        with patch.object(bridge, "command", return_value=b"subject=\n OU = WRONGTEAM1\n CN = Developer ID Application: QA\n"):
            with self.assertRaisesRegex(bridge.BridgeError, "certificate-team-ou"):
                bridge.cert_proof(pem, hashlib.sha1(der).hexdigest().upper())

    def test_cleanup_restores_before_deleting_only_owned_keychain(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "owned"
            root.mkdir(mode=0o700)
            keychain = root / "sign.keychain-db"
            keychain.write_bytes(b"TEST_KEYCHAIN")
            original = ["/login/key chain", "/system/other-keychain"]
            state = {"keychain": str(keychain), "ownedRoot": str(root), "originalSearchList": original}
            calls = []
            def command(args, phase, **_kwargs):
                calls.append((args, phase))
                if phase == "delete-owned-keychain":
                    keychain.unlink()
                return b""
            with patch.object(bridge, "command", side_effect=command), patch.object(bridge, "search_list", return_value=original):
                bridge.cleanup_state(state)
            self.assertEqual(calls[0][0], ["/usr/bin/security", "list-keychains", "-d", "user", "-s", *original])
            self.assertEqual(calls[1][0], ["/usr/bin/security", "delete-keychain", str(keychain)])
            self.assertFalse(root.exists())

    def test_restore_mismatch_retains_owned_keychain(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            keychain = root / "sign.keychain-db"
            keychain.write_bytes(b"TEST_KEYCHAIN")
            with patch.object(bridge, "command") as command, patch.object(bridge, "search_list", return_value=["/changed"]):
                with self.assertRaisesRegex(bridge.BridgeError, "restored-search-list-mismatch"):
                    bridge.cleanup_state({"ownedRoot": str(root), "keychain": str(keychain), "originalSearchList": ["/original"]})
                self.assertEqual(command.call_count, 1)
                self.assertTrue(keychain.exists())

    def test_fixed_first_party_canary_compile_is_hosted_owned_and_has_no_injection(self):
        with tempfile.TemporaryDirectory() as directory:
            runner_temp = Path(directory).resolve()
            root = runner_temp / (bridge.PREFIX + "contract")
            root.mkdir(mode=0o700)
            with patch.object(bridge, "hosted_context", side_effect=bridge.BridgeError("hosted-macos-only")), \
                    patch.object(bridge, "command") as command:
                with self.assertRaisesRegex(bridge.BridgeError, "hosted-macos-only"):
                    bridge.compile_canary(root)
                command.assert_not_called()
                self.assertEqual(list(root.iterdir()), [])
            context = {"applicationId": "org.example.signing"}
            bridge.write_private(root / "ownership.json", bridge.json_bytes({"context": context, "ownedRoot": str(root)}))
            def compile_command(args, phase, **options):
                self.assertEqual(phase, "canary-compile")
                self.assertEqual(args, ["/usr/bin/xcrun", "--sdk", "macosx", "clang", "-arch", "arm64",
                                       "-Werror", "-O0", "-x", "c", str(root / "signing-canary.c"),
                                       "-o", str(root / "signing-canary")])
                self.assertEqual((root / "signing-canary.c").read_bytes(), b"int main(void){return 0;}\n")
                self.assertEqual(options, {"environment": {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "TMPDIR": str(root)}, "cwd": root})
                bridge.write_private(root / "signing-canary", b"mocked compiler output")
                return b""
            injected = {"CFLAGS": "BAD_INPUT", "LDFLAGS": "BAD_INPUT", "SDKROOT": "BAD_INPUT",
                        "DEVELOPER_DIR": "BAD_INPUT", "DYLD_INSERT_LIBRARIES": "BAD_INPUT", "CPATH": "BAD_INPUT"}
            with patch.object(bridge, "hosted_context", return_value=(runner_temp, context)), \
                    patch.object(bridge.platform, "machine", return_value="arm64"), \
                    patch.object(bridge, "command", side_effect=compile_command), \
                    patch.object(bridge.shutil, "copyfile", side_effect=AssertionError("OS binary copy forbidden")), \
                    patch.dict(os.environ, injected):
                self.assertEqual(bridge.compile_canary(root), root / "signing-canary")
            # The only newly published failure detail is a bounded return code
            # or signal enum, never arguments, environment or process output.
            for returncode, suffix in ((-9, "signal=SIGKILL"), (126, "exit=126"), (9999, "exit=OTHER")):
                result = type("Result", (), {"returncode": returncode, "stdout": b"PRIVATE_OUTPUT", "stderr": b"PRIVATE_ERROR"})()
                with patch.object(bridge.subprocess, "run", return_value=result):
                    with self.assertRaisesRegex(bridge.BridgeError, suffix) as rejected:
                        bridge.command(["PRIVATE_ARG"], "canary-execute")
                self.assertNotIn("PRIVATE", str(rejected.exception))


@unittest.skipUnless(HOSTED and os.environ.get("SIGNING_TEST_KEYCHAIN_BRIDGE") == "true",
                     "explicit future remote signing authorization required")
class ActualHostedCanary(unittest.TestCase):
    def test_actual_developer_id_and_exact_search_list_cleanup(self):
        import hashlib
        runner_temp, context = bridge.hosted_context()
        receipt = runner_temp / ("signing-keychain-contract-" + str(os.getpid()) + ".json")
        args = type("Args", (), {"team": bridge.TEAM, "application_id": bridge.application_id(),
                                 "receipt": str(receipt)})()
        original = bridge.search_list()
        try:
            bridge.prepare(args, runner_temp, context)
            report, state = bridge.owned_state(receipt, runner_temp, context)
            self.assertTrue(report["canaryVerified"] and report["canaryExecuted"])
            self.assertFalse(report["publicRelease"] or report["packageQualified"])
            bridge.cleanup_state(state)
            self.assertEqual(bridge.search_list(), original)
            self.assertFalse(Path(report["keychain"]).exists())
            self.assertFalse(Path(report["ownedRoot"]).exists())
        finally:
            # Do not mask a failure or delete an unrelated search list/keychain.
            if receipt.exists():
                report = json.loads(bridge.regular_private(receipt))
                if Path(report["ownedRoot"]).exists():
                    _, state = bridge.owned_state(receipt, runner_temp, context)
                    bridge.cleanup_state(state)
        # Separate qualification output: never publish the raw prepare receipt,
        # which correctly keeps cleanupConfirmed=false. Reaching this line means
        # all actual assertions and the finally cleanup have succeeded.
        output = Path(os.environ["SIGNING_KEYCHAIN_QUALIFICATION_OUTPUT"])
        self.assertEqual(output.parent, runner_temp)
        files = ["qualified-keychain-bridge.sh", "qualified-keychain-bridge.py",
                 "qualified-keychain-bridge-tests.py", "qualified-keychain-bridge-qualification.yml"]
        source_hashes = {name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
                         for name in files}
        qualification = {"schema": "qualified-keychain-qualification-v1", "result": "passed",
                         "context": context, "team": bridge.TEAM, "applicationId": bridge.application_id(),
                         "bridgeSourceSHA256": source_hashes,
                         "certificateSHA256": report["certificateSHA256"],
                         "identitySHA1": report["identitySHA1"], "canarySHA256": report["canarySHA256"],
                         "canaryVerified": True, "canaryExecuted": True, "cleanupConfirmed": True,
                         "originalSearchListRestored": True, "ownedKeychainDeleted": True,
                         "ownedRootDeleted": True, "publicRelease": False, "packageQualified": False,
                         "scope": "hosted keychain and owned Developer ID canary only"}
        bridge.write_private(output, bridge.json_bytes(qualification))


if __name__ == "__main__":
    unittest.main()
