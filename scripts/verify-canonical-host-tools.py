"""Bind a canonical CI candidate to the operator-reviewed source and index."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.request

PLATFORMS=('darwin-arm64','darwin-x64','linux-arm64','linux-x64','win32-arm64','win32-x64')
def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda:handle.read(1<<20),b''):h.update(block)
    return h.hexdigest()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('directory',type=Path)
    parser.add_argument('--canonical',type=Path,required=True)
    parser.add_argument('--platform',choices=PLATFORMS)
    args=parser.parse_args()
    source=os.environ['CANONICAL_SOURCE']; run=os.environ['CANONICAL_RUN']; expected=os.environ['CANDIDATE_INDEX_SHA256']
    if not re.fullmatch('[a-f0-9]{40}',source) or not re.fullmatch('[0-9]+',run) or not re.fullmatch('[a-f0-9]{64}',expected):
        raise ValueError('Full immutable source, numeric run and reviewed index SHA256 are required')
    actual=subprocess.check_output(['git','rev-parse','HEAD'],cwd=args.canonical,text=True).strip()
    if actual!=source:raise ValueError('Canonical checkout differs from the approved source')
    subprocess.run(['git','diff','--quiet','HEAD'],cwd=args.canonical,check=True)
    req=urllib.request.Request('https://api.github.com/repos/openagent-uno/openagent/actions/runs/'+run,headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json'})
    with urllib.request.urlopen(req,timeout=30) as response:receipt=json.load(response)
    if receipt.get('head_sha')!=source or receipt.get('conclusion')!='success' or receipt.get('event')!='workflow_dispatch' or receipt.get('path')!='.github/workflows/host-tools-bundles.yml':
        raise ValueError('CI candidate source, event, path or conclusion differs')
    root=args.directory.resolve();index_file=root/'release-index.json'
    if digest(index_file)!=expected:raise ValueError('Candidate index differs from its reviewed hash')
    index=json.loads(index_file.read_text(encoding='utf-8'))
    if index.get('source_commit')!=source or index.get('source_repository')!='openagent-uno/openagent' or index.get('version')!='1.0.0b6' or set(index['platforms'])!=set(PLATFORMS):
        raise ValueError('Candidate index has the wrong source, version or platform set')
    scripts=args.canonical/'packages/host-tools/scripts';sys.path.insert(0,str(scripts))
    from verify_bundle_archive import verify_archive
    for platform in ((args.platform,) if args.platform else PLATFORMS):
        spec=index['platforms'][platform];name='openagent-host-tools-'+platform+'.tar.gz'
        if spec['asset']!=name or digest(root/name)!=spec['archive_sha256']:raise ValueError('Archive differs from the candidate index')
        archive=verify_archive(root/name,expected_platform=platform,expected_version='1.0.0b6')
        if hashlib.sha256(archive.manifest_bytes).hexdigest()!=spec['bundle_manifest_sha256']:raise ValueError('Bundle manifest differs from the candidate index')
    wheel=index['python_wheel'];name='openagent_host_tools-1.0.0b6-py3-none-any.whl'
    if wheel['asset']!=name or digest(root/name)!=wheel['sha256']:raise ValueError('Canonical wheel differs from the candidate index')
    print(json.dumps({'source':source,'canonical_run':run,'candidate_index_sha256':expected,'verified_platforms':[args.platform] if args.platform else list(PLATFORMS),'verification':'input-candidate-only','secrets_exported':False}))
if __name__=='__main__':main()
