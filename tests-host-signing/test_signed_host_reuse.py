import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch,MagicMock

spec=importlib.util.spec_from_file_location('reuse',Path(__file__).resolve().parents[1]/'scripts/verify-signed-host-reuse.py')
reuse=importlib.util.module_from_spec(spec);spec.loader.exec_module(reuse)

class FiniteSignatureReuse(unittest.TestCase):
    def test_signed_log_redirect_never_forwards_existing_read_token(self):
        error=reuse.urllib.error.HTTPError('https://api.github.com/fixed',302,'redirect',
            {'Location':'https://example.blob.core.windows.net/signed-log'},None)
        opener=MagicMock();opener.open.side_effect=error
        response=MagicMock();response.__enter__.return_value=response;response.read.return_value=b'fixture'
        with patch.dict(reuse.os.environ,GH_TOKEN='synthetic-read-token'),patch.object(reuse.urllib.request,'build_opener',return_value=opener),patch.object(reuse.urllib.request,'urlopen',return_value=response) as redirected:
            self.assertEqual(reuse.read_api('actions/jobs/1/logs',raw=True),'fixture')
            redirected.assert_called_once_with('https://example.blob.core.windows.net/signed-log',timeout=30)
        error.headers['Location']='https://untrusted.invalid/log'
        with patch.dict(reuse.os.environ,GH_TOKEN='synthetic-read-token'),patch.object(reuse.urllib.request,'build_opener',return_value=opener),patch.object(reuse.urllib.request,'urlopen') as redirected:
            with self.assertRaises(ValueError):reuse.read_api('actions/jobs/1/logs',raw=True)
            redirected.assert_not_called()
    def fixture(self):
        run={'id':int(reuse.RUN),'head_sha':reuse.EXECUTOR,'status':'completed','conclusion':'failure',
             'event':'workflow_dispatch','path':'.github/workflows/sign-canonical-host-tools.yml'}
        jobs=[{'name':f'macos-sign ({runner}, {platform})','status':'completed','conclusion':'success'}
              for platform,runner in (('darwin-arm64','macos-15'),('darwin-x64','macos-15-intel'))]
        jobs.append({'name':'assemble','status':'completed','conclusion':'failure'})
        return run,jobs
    def test_exact_qualified_macs_and_only_known_assembly_failure_are_reusable(self):
        run,jobs=self.fixture();reuse.validate_run(run,jobs,reuse.FAILURE)
        for field,value in [('head_sha','f'*40),('id',1),('status','in_progress'),('path','other.yml'),('conclusion','cancelled')]:
            with self.subTest(field=field),self.assertRaises(ValueError):reuse.validate_run(dict(run,**{field:value}),jobs,reuse.FAILURE)
        with self.assertRaises(ValueError):reuse.validate_run(run,jobs,'Unrelated assembly failure')
    def test_failed_missing_or_duplicated_native_gate_is_rejected(self):
        run,jobs=self.fixture()
        for faulty in ([dict(jobs[0],conclusion='failure'),*jobs[1:]],jobs[1:],[*jobs,jobs[0]]):
            with self.assertRaises(ValueError):reuse.validate_run(run,faulty,reuse.FAILURE)
    def test_input_provenance_binds_original_source_index_and_exact_platform(self):
        proof={'source':reuse.SOURCE,'canonical_run':reuse.CANONICAL_RUN,'candidate_index_sha256':reuse.INDEX,
               'verified_platforms':['darwin-arm64'],'verification':'input-candidate-only','secrets_exported':False}
        reuse.validate_input(proof,'darwin-arm64')
        for change in ({'source':'f'*40},{'candidate_index_sha256':'0'*64},{'verified_platforms':['darwin-x64']},{'secrets_exported':True}):
            with self.assertRaises(ValueError):reuse.validate_input(dict(proof,**change),'darwin-arm64')
if __name__=='__main__':unittest.main()
