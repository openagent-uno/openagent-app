import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT=Path(__file__).resolve().parents[1]/'scripts/finalize-canonical-host-tools.py'
class SigningAttestation(unittest.TestCase):
    def fixture(self, defect=None):
        platforms=('darwin-arm64','darwin-x64','linux-arm64','linux-x64','win32-arm64','win32-x64')
        original={'schema':1,'version':'1.0.0b6','source_repository':'openagent-uno/openagent',
                  'source_commit':'a'*40,'source_ref':'v1.0.0b6','python_wheel':{'asset':'fixture.whl','sha256':'b'*64},
                  'platforms':{key:{'archive_sha256':'c'*64} for key in platforms}}
        final=json.loads(json.dumps(original))
        final['platforms']['darwin-arm64']['archive_sha256']='d'*64
        final['platforms']['darwin-x64']['archive_sha256']='e'*64
        if defect=='linux':final['platforms']['linux-arm64']['archive_sha256']='f'*64
        if defect=='source':final['source_commit']='f'*40
        if defect=='wheel':final['python_wheel']['sha256']='f'*64
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'release-index.json').write_text(json.dumps(final))
            original_path=root/'original.json';original_path.write_text(json.dumps(original))
            result=subprocess.run([sys.executable,str(SCRIPT),str(root),str(original_path)],capture_output=True,
                env=dict(os.environ,CANONICAL_RUN='1',CANDIDATE_INDEX_SHA256='0'*64,
                         GITHUB_REPOSITORY='openagent-uno/openagent-app',GITHUB_SHA='1'*40,GITHUB_RUN_ID='2'))
            proof=json.loads((root/'qualification.json').read_text()) if (root/'qualification.json').exists() else None
            return result.returncode,proof
    def test_signed_macs_preserve_other_targets_and_do_not_claim_windows_signature(self):
        code,proof=self.fixture();self.assertEqual(code,0);self.assertFalse(proof['windows_authenticode_claimed']);self.assertFalse(proof['linux_arm64_coverage']['browser_navigation'])
        self.assertEqual(proof['unchanged_native_targets'],['linux-arm64','linux-x64','win32-arm64','win32-x64'])
    def test_changed_original_target_source_or_wheel_has_no_attestation(self):
        for defect in ('linux','source','wheel'):
            with self.subTest(defect=defect):
                code,proof=self.fixture(defect);self.assertNotEqual(code,0);self.assertIsNone(proof)
if __name__=='__main__':unittest.main()
