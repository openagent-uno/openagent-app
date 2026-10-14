"""SOURCE-ONLY bounded neutral seed contracts. No network, keys or application payload."""
import argparse
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location('neutral_source_seed', Path(__file__).with_name('generic-private-source-seed.py'))
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)


def tar_fixture(file, extras=(), replace_helper=False):
    records = [('source/tools/release/remote-signing/restore_source.py', b'# neutral fixture one\n', tarfile.REGTYPE),
               ('source/tools/release/remote-signing/validate_contract.py', b'# neutral fixture two\n', tarfile.REGTYPE),
               ('source/ignored.txt', b'unrelated neutral bytes', tarfile.REGTYPE)]
    if replace_helper:
        records = records[1:]
    with tarfile.open(file, 'w:gz') as archive:
        for name, body, kind in [*records, *extras]:
            item = tarfile.TarInfo(name)
            item.type = kind
            item.size = len(body) if kind == tarfile.REGTYPE else 0
            if kind != tarfile.REGTYPE: item.linkname = 'unrelated-target'
            archive.addfile(item, io.BytesIO(body) if kind == tarfile.REGTYPE else None)


class SeedContracts(unittest.TestCase):
    def test_draft_lookup_uses_only_exact_reviewed_release_id_url(self):
        with patch.dict(os.environ, {'GITHUB_REPOSITORY': 'neutral/executor'}), \
             patch.object(seed, 'response', return_value=io.BytesIO(b'{"id":7}')) as response:
            self.assertEqual(seed.fetch_release(7, 'synthetic-not-a-credential'), {'id': 7})
        response.assert_called_once_with('https://api.github.com/repos/neutral/executor/releases/7',
                                         token='synthetic-not-a-credential')

    def test_invalid_release_id_stops_before_request(self):
        for value in (0, -1, True, '7', 1 << 63):
            with self.subTest(value=value), patch.object(seed, 'response', side_effect=AssertionError('no API')) as response:
                with self.assertRaisesRegex(ValueError, 'exact-private-release-id-required'):
                    seed.fetch_release(value, 'synthetic-not-a-credential')
                response.assert_not_called()

    def test_wrong_id_or_tag_stops_before_download_or_code_execution(self):
        for release_id, tag in ((2, 'neutral-input'), (1, 'wrong-tag')):
            with self.subTest(release_id=release_id, tag=tag), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                args = argparse.Namespace(source='a' * 40, nonce='b' * 32, tag='neutral-input', release_id=1,
                    index_sha256='c' * 64, asset_set_sha256='d' * 64, packet=root / 'packet',
                    helpers=root / 'helpers', checkout=root / 'checkout', metadata=root / 'metadata.json')
                release = {'id': release_id, 'tag_name': tag, 'draft': True, 'prerelease': True}
                with patch.dict(os.environ, {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
                    'GITHUB_REPOSITORY': 'neutral/executor', 'GH_TOKEN': 'synthetic-not-a-credential'}), \
                     patch.object(seed, 'fetch_release', return_value=release) as fetch, \
                     patch.object(seed, 'download', side_effect=AssertionError('no download')) as download, \
                     patch.object(seed.subprocess, 'run', side_effect=AssertionError('no code')) as execute:
                    with self.assertRaisesRegex(ValueError, 'owned-unpublished-draft-required'):
                        seed.bootstrap(args)
                    fetch.assert_called_once_with(1, 'synthetic-not-a-credential')
                    download.assert_not_called(); execute.assert_not_called()
                self.assertFalse(args.packet.exists())

    def test_default_transport_is_get_only_and_redirect_removes_authorization(self):
        requests = []
        class Opener:
            def open(self, request, timeout):
                requests.append(request)
                if len(requests) == 1:
                    raise urllib.error.HTTPError(request.full_url, 302, 'redirect',
                        {'Location': 'https://release-assets.githubusercontent.com/neutral?signature=fixture'}, io.BytesIO())
                return io.BytesIO(b'neutral')
        with patch.dict(os.environ, {'GITHUB_REPOSITORY': 'neutral/executor'}), \
             patch.object(seed.urllib.request, 'build_opener', return_value=Opener()):
            with seed.response('https://api.github.com/repos/neutral/executor/releases/assets/1',
                               token='synthetic-not-a-credential', asset=True) as body:
                self.assertEqual(body.read(), b'neutral')
        self.assertEqual([row.get_method() for row in requests], ['GET', 'GET'])
        self.assertTrue(requests[0].has_header('Authorization'))
        self.assertFalse(requests[1].has_header('Authorization'))

    def test_foreign_redirect_is_denied_before_followup_request(self):
        requests = []
        class Opener:
            def open(self, request, timeout):
                requests.append(request)
                raise urllib.error.HTTPError(request.full_url, 302, 'redirect',
                    {'Location': 'https://foreign.example.invalid/private'}, io.BytesIO())
        with patch.dict(os.environ, {'GITHUB_REPOSITORY': 'neutral/executor'}), \
             patch.object(seed.urllib.request, 'build_opener', return_value=Opener()):
            with self.assertRaisesRegex(ValueError, 'redirect-denied'):
                seed.response('https://api.github.com/repos/neutral/executor/releases/assets/1',
                              token='synthetic-not-a-credential', asset=True)
        self.assertEqual(len(requests), 1)

    def test_closed_tar_stages_only_two_bounded_regular_helpers(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            tar_fixture(root / 'source.tar.gz')
            seed.extract_helpers(root / 'source.tar.gz', root / 'helpers')
            self.assertEqual({file.name for file in (root / 'helpers').iterdir()},
                             {'restore_source.py', 'validate_contract.py'})
            self.assertEqual((root / 'helpers/restore_source.py').read_bytes(), b'# neutral fixture one\n')
            self.assertFalse((root / 'ignored.txt').exists())

    def test_traversal_duplicates_and_helper_links_cannot_be_executed_or_followed(self):
        for case in ('traversal', 'duplicate', 'symlink', 'hardlink'):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                name = 'source/../outside' if case == 'traversal' else 'source/tools/release/remote-signing/restore_source.py'
                kind = {'symlink': tarfile.SYMTYPE, 'hardlink': tarfile.LNKTYPE}.get(case, tarfile.REGTYPE)
                tar_fixture(root / 'source.tar.gz', [(name, b'foreign', kind)],
                            replace_helper=case in ('symlink', 'hardlink'))
                with self.assertRaises(ValueError):
                    seed.extract_helpers(root / 'source.tar.gz', root / 'helpers')
                self.assertFalse((root / 'outside').exists())

    def test_duplicate_index_keys_cannot_change_reviewed_scope(self):
        with self.assertRaisesRegex(ValueError, 'duplicate-json-key'):
            seed.json_bytes(b'{"sourceCommit":"first","sourceCommit":"second"}')

    def test_publication_during_download_blocks_original_source_execution(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            tar_fixture(root / 'fixture.tar.gz')
            payloads = {'source.tar.gz': (root / 'fixture.tar.gz').read_bytes(),
                        'source-commit.raw': b'neutral-commit-fixture', 'source-tree.json': b'{}'}
            assets = {name: {'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()}
                      for name, body in payloads.items()}
            source, nonce = 'a' * 40, 'b' * 32
            index = {'sourceCommit': source, 'nonce': nonce, 'stagedBy': 'fixture-owner', 'assets': assets}
            index_bytes = json.dumps(index).encode()
            payloads['input-index.json'] = index_bytes
            rows = [{'id': number, 'name': name, 'size': len(body), 'digest': 'sha256:' + hashlib.sha256(body).hexdigest(),
                     'state': 'uploaded', 'url': 'https://api.github.com/repos/neutral/executor/releases/assets/' + str(number)}
                    for number, (name, body) in enumerate(payloads.items(), 1)]
            release = {'id': 1, 'url': 'https://api.github.com/repos/neutral/executor/releases/1',
                       'draft': True, 'prerelease': True, 'tag_name': 'neutral-input',
                       'author': {'login': 'fixture-owner'}, 'assets': rows}
            published = json.loads(json.dumps(release)); published['draft'] = False
            by_id = {row['id']: payloads[row['name']] for row in rows}
            args = argparse.Namespace(source=source, nonce=nonce, tag='neutral-input', release_id=1,
                index_sha256=hashlib.sha256(index_bytes).hexdigest(),
                asset_set_sha256=hashlib.sha256(json.dumps(assets, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
                packet=root / 'packet', helpers=root / 'helpers', checkout=root / 'restored', metadata=root / 'release.json')
            environment = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
                           'GITHUB_REPOSITORY': 'neutral/executor', 'GH_TOKEN': 'synthetic-not-a-credential'}
            with patch.dict(os.environ, environment), \
                 patch.object(seed, 'fetch_release', side_effect=[release, published]), \
                 patch.object(seed, 'response', side_effect=lambda url, **kwargs: io.BytesIO(by_id[int(url.rsplit('/', 1)[1])])), \
                 patch.object(seed, 'extract_helpers', side_effect=AssertionError('must not extract')) as extract, \
                 patch.object(seed.subprocess, 'run', side_effect=AssertionError('must not execute')) as execute:
                with self.assertRaisesRegex(ValueError, 'published-or-replaced'):
                    seed.bootstrap(args)
                extract.assert_not_called(); execute.assert_not_called()
            self.assertFalse(args.checkout.exists())

    def test_nonhosted_context_is_denied_before_api_or_local_output(self):
        with patch.dict(os.environ, {'GITHUB_ACTIONS': 'false'}), \
             patch.object(seed, 'fetch_release', side_effect=AssertionError('must not call API')) as api:
            with self.assertRaisesRegex(ValueError, 'actual-hosted-executor-required'):
                seed.bootstrap(argparse.Namespace())
            api.assert_not_called()


if __name__ == '__main__':
    unittest.main()
