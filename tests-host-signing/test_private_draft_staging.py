import copy
import importlib.util
from pathlib import Path
import json
import unittest

script=Path(__file__).resolve().parents[1]/'scripts/verify-draft-host-staging.py'
spec=importlib.util.spec_from_file_location('draft_staging',script)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class PrivateDraftStaging(unittest.TestCase):
    def fixture(self):
        names=['release-index.json','openagent_host_tools-1.0.0b6-py3-none-any.whl']
        for platform in ('darwin-arm64','darwin-x64','linux-arm64','linux-x64','win32-arm64','win32-x64'):
            names += ['openagent-host-tools-'+platform+'.tar.gz','openagent-host-tools-'+platform+'.tar.gz.sha256']
        return {'draft':True,'tag_name':'host-tools-b6-staging-42',
                'body':json.dumps({'source_repository':'openagent-uno/openagent','source_commit':'a'*40,
                    'canonical_run':'42','candidate_index_sha256':'b'*64}),
                'assets':[{'name':name,'digest':'sha256:'+'b'*64 if name=='release-index.json' else None} for name in names]}
    def check(self,release,**kwargs):
        module.validate(release,repository='openagent-uno/openagent-app',tag=kwargs.get('tag','host-tools-b6-staging-42'),run='42',source='a'*40,index='b'*64)
    def test_exact_unpublished_inventory_and_provenance_pass(self):self.check(self.fixture())
    def test_public_wrong_run_source_inventory_or_digest_rejected(self):
        for defect in ('published','source','missing','digest'):
            with self.subTest(defect=defect):
                item=self.fixture()
                if defect=='published':item['draft']=False
                if defect=='source':item['body']='{}'
                if defect=='missing':item['assets'].pop()
                if defect=='digest':item['assets'][0]['digest']='sha256:'+'c'*64
                with self.assertRaises(ValueError):self.check(item)
        with self.assertRaises(ValueError):self.check(self.fixture(),tag='host-tools-b6-staging-43')
if __name__=='__main__':unittest.main()
