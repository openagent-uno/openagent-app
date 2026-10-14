#!/usr/bin/env python3
"""SOURCE-ONLY candidate: minimal hash-bound private-draft bootstrap. No upload/signing."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import urllib.error
import urllib.parse
import urllib.request


def require(value, reason):
    if not value:
        raise ValueError(reason)


def checksum(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def json_bytes(body):
    def closed(pairs):
        result = {}
        for name, value in pairs:
            require(name not in result, 'duplicate-json-key')
            result[name] = value
        return result
    return json.loads(body, object_pairs_hook=closed)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, url):
        return None


def response(url, *, token, asset=False):
    repository = os.environ['GITHUB_REPOSITORY']
    require(url.startswith('https://api.github.com/repos/' + repository + '/releases/'),
            'executor-api-origin-required')
    headers = {'Authorization': 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28',
               'Accept': 'application/octet-stream' if asset else 'application/vnd.github+json'}
    opener = urllib.request.build_opener(NoRedirect())
    try:
        return opener.open(urllib.request.Request(url, headers=headers), timeout=60)
    except urllib.error.HTTPError as error:
        if not asset or error.code not in (301, 302, 303, 307, 308):
            raise ValueError('private-draft-request-failed') from None
        target = urllib.parse.urlsplit(error.headers.get('Location', ''))
        require(target.scheme == 'https' and target.hostname == 'release-assets.githubusercontent.com'
                and target.port in (None, 443) and not target.username and not target.password
                and not target.fragment, 'private-asset-redirect-denied')
        error.close()
        # Signed location and authorization are never printed; second redirect denied.
        return opener.open(urllib.request.Request(target.geturl()), timeout=60)


def fetch_release(tag, token):
    url = 'https://api.github.com/repos/' + os.environ['GITHUB_REPOSITORY'] + '/releases/tags/' + tag
    with response(url, token=token) as stream:
        body = stream.read((16 << 20) + 1)
    require(len(body) <= 16 << 20, 'bounded-draft-metadata-required')
    return json_bytes(body)


def immutable_release(release):
    # GitHub download counters legitimately change during transfer. Pin only
    # ownership/publication/identity and actual asset records, not those counters.
    return {key: release.get(key) for key in ('id', 'url', 'draft', 'prerelease', 'tag_name', 'author')} | {
        'assets': sorted(({key: row.get(key) for key in ('id', 'name', 'url', 'state', 'size', 'digest')}
                          for row in release.get('assets', [])), key=lambda row: row['name'])}


def download(row, file, specification, token):
    require(type(row.get('id')) is int and row['id'] > 0 and row.get('state') == 'uploaded'
            and row.get('size') == specification['bytes']
            and row.get('digest') == 'sha256:' + specification['sha256'], 'reviewed-asset-record-required')
    url = 'https://api.github.com/repos/' + os.environ['GITHUB_REPOSITORY'] + '/releases/assets/' + str(row['id'])
    require(row.get('url') == url, 'owned-asset-origin-required')
    size, digest = 0, hashlib.sha256()
    with response(url, token=token, asset=True) as source, file.open('xb') as output:
        while block := source.read(1 << 20):
            size += len(block)
            require(size <= specification['bytes'], 'download-exceeds-reviewed-size')
            digest.update(block)
            output.write(block)
    require(size == specification['bytes'] and digest.hexdigest() == specification['sha256'],
            'downloaded-asset-hash-mismatch')


def extract_helpers(archive, directory):
    # Only these two regular CODE files are staged. Never extractall or execute
    # source before its entire TAR hash has matched the root-reviewed index.
    suffixes = {'tools/release/remote-signing/restore_source.py',
                'tools/release/remote-signing/validate_contract.py'}
    directory.mkdir(mode=0o700)
    found = set()
    members, expansion = 0, 0
    with tarfile.open(archive) as source:
        for member in source:
            members += 1
            expansion += member.size
            require(members <= 100000 and expansion <= 2 << 30, 'source-tar-budget-exceeded')
            path = PurePosixPath(member.name)
            require(not path.is_absolute() and '..' not in path.parts and '\\' not in member.name
                    and ':' not in member.name, 'unsafe-source-tar-member')
            name = '/'.join(path.parts[1:])
            if name not in suffixes:
                continue
            require(name not in found and member.isfile() and 0 < member.size <= 1 << 20,
                    'bootstrap-helper-must-be-one-bounded-regular-file')
            found.add(name)
            with source.extractfile(member) as body, (directory / path.name).open('xb') as output:
                while block := body.read(1 << 20):
                    output.write(block)
    require(found == suffixes, 'original-source-bootstrap-helpers-required')


def bootstrap(args):
    require(os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
            and re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', os.environ.get('GITHUB_REPOSITORY', '')),
            'actual-hosted-executor-required')
    require(re.fullmatch('[0-9a-f]{40}', args.source) and re.fullmatch('[0-9a-f]{32}', args.nonce)
            and all(re.fullmatch('[0-9a-f]{64}', value) for value in (args.index_sha256, args.asset_set_sha256)),
            'exact-reviewed-source-and-hashes-required')
    require(re.fullmatch('[A-Za-z0-9._-]+', args.tag), 'exact-private-draft-tag-required')
    token = os.environ.get('GH_TOKEN', '')
    require(token and not args.packet.exists() and not args.helpers.exists() and not args.checkout.exists(),
            'token-and-fresh-owned-paths-required')
    release = fetch_release(args.tag, token)
    require(release.get('draft') is True and release.get('prerelease') is True
            and release.get('tag_name') == args.tag and type(release.get('id')) is int,
            'owned-unpublished-draft-required')
    rows = release.get('assets', [])
    records = {row['name']: row for row in rows}
    require(len(records) == len(rows) and 'input-index.json' in records, 'closed-index-asset-required')
    index_size = records['input-index.json'].get('size')
    require(type(index_size) is int and 0 < index_size <= 16 << 20, 'bounded-index-required')
    args.packet.mkdir(mode=0o700)
    download(records['input-index.json'], args.packet / 'input-index.json',
             {'bytes': index_size, 'sha256': args.index_sha256}, token)
    index = json_bytes((args.packet / 'input-index.json').read_bytes())
    require(index.get('sourceCommit') == args.source and index.get('nonce') == args.nonce
            and release.get('author', {}).get('login') == index.get('stagedBy'), 'reviewed-draft-owner-and-scope-required')
    assets = index['assets']
    require(hashlib.sha256(json.dumps(assets, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            == args.asset_set_sha256 and set(records) == set(assets) | {'input-index.json'},
            'root-reviewed-closed-asset-map-required')
    require({'source.tar.gz', 'source-commit.raw', 'source-tree.json'} <= set(assets)
            and 0 < len(assets) <= 32, 'source-input-assets-required')
    total = 0
    for name, specification in sorted(assets.items()):
        require(re.fullmatch('[A-Za-z0-9._-]+', name) and name not in ('.', '..', 'input-index.json')
                and set(specification) == {'bytes', 'sha256'} and type(specification['bytes']) is int
                and 0 < specification['bytes'] <= 5 << 30
                and re.fullmatch('[0-9a-f]{64}', specification['sha256']), 'bounded-basename-asset-required')
        total += specification['bytes']
        require(total <= 12 << 30, 'aggregate-private-input-budget-exceeded')
        download(records[name], args.packet / name, specification, token)
    final = fetch_release(args.tag, token)
    require(immutable_release(final) == immutable_release(release), 'draft-published-or-replaced-during-bootstrap')
    extract_helpers(args.packet / 'source.tar.gz', args.helpers)
    # No API credential is provided to code from the authenticated private TAR.
    environment = {name: value for name, value in os.environ.items()
                   if name not in ('GH_TOKEN', 'GITHUB_TOKEN') and not name.startswith('GIT_')}
    result = subprocess.run([sys.executable, str(args.helpers / 'restore_source.py'),
                             '--input', str(args.packet), '--output', str(args.checkout)],
                            env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=600)
    require(result.returncode == 0, 'original-source-restoration-failed')
    with args.metadata.open('x', encoding='utf-8') as output:
        json.dump(final, output)


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('packet', 'helpers', 'checkout', 'metadata'):
        parser.add_argument('--' + name, type=Path, required=True)
    for name in ('tag', 'source', 'nonce', 'index-sha256', 'asset-set-sha256'):
        parser.add_argument('--' + name, required=True)
    try:
        bootstrap(parser.parse_args())
    except Exception:
        raise SystemExit('PRIVATE_SOURCE_BOOTSTRAP_REJECTED') from None
    print('AUTHENTIC_PRIVATE_SOURCE_BOOTSTRAPPED_NOT_RELEASE_QUALIFIED')
