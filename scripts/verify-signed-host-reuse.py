"""Reuse only the two qualified B6 signatures whose original assembly path failed."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import urllib.request
import urllib.error
import urllib.parse

RUN='38467343111'
EXECUTOR='3c8cfdbc4595336677610ddbb2a6ebef077caf49'
SOURCE='aa8dafb3ef14066dbdaadbbf66bc9b3a00b801e0'
CANONICAL_RUN='38457527270'
INDEX='f59b6a5f4e622120b9c9e2c84ce89c8377281053169f4c7fb74bf696cb9b46ab'
MACS=('darwin-arm64','darwin-x64')
FAILURE="cp: cannot stat 'signed/canonical-signed-host-tools-darwin-arm64/openagent-host-tools-darwin-arm64.tar.gz': No such file or directory"

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

def read_api(path, *, raw=False):
    request=urllib.request.Request('https://api.github.com/repos/openagent-uno/openagent-app/'+path,
        headers={'Accept':'application/vnd.github+json','Authorization':'Bearer '+os.environ['GH_TOKEN']})
    try:response=urllib.request.build_opener(NoRedirect()).open(request,timeout=30)
    except urllib.error.HTTPError as error:
        if not raw or error.code!=302:raise
        url=error.headers['Location'];parsed=urllib.parse.urlparse(url)
        if parsed.scheme!='https' or not (parsed.hostname or '').endswith(('.blob.core.windows.net','.githubusercontent.com')):
            raise ValueError('Unexpected GitHub job log destination')
        response=urllib.request.urlopen(url,timeout=30)  # Signed log URL; never forward the read token.
    with response:data=response.read((2<<20)+1)
    if len(data)>2<<20:raise ValueError('Signing metadata exceeds its bounded budget')
    return data.decode() if raw else json.loads(data)

def validate_run(run, jobs, log):
    if (run.get('id')!=int(RUN) or run.get('head_sha')!=EXECUTOR or run.get('status')!='completed'
        or run.get('event')!='workflow_dispatch' or run.get('path')!='.github/workflows/sign-canonical-host-tools.yml'
        or run.get('conclusion') not in ('success','failure')):raise ValueError('Unapproved signing source or run')
    for platform,runner in (('darwin-arm64','macos-15'),('darwin-x64','macos-15-intel')):
        matches=[job for job in jobs if job['name']==f'macos-sign ({runner}, {platform})']
        if len(matches)!=1 or matches[0].get('status')!='completed' or matches[0].get('conclusion')!='success':
            raise ValueError('Both native signature and archive gates must have succeeded')
    if run['conclusion']=='failure':
        matches=[job for job in jobs if job['name']=='assemble']
        if len(matches)!=1 or matches[0].get('conclusion')!='failure' or FAILURE not in log:
            raise ValueError('Only the known assembly path failure may be reused')

def validate_input(proof, platform):
    if proof!={'source':SOURCE,'canonical_run':CANONICAL_RUN,'candidate_index_sha256':INDEX,
        'verified_platforms':[platform],'verification':'input-candidate-only','secrets_exported':False}:
        raise ValueError('Signed payload input provenance differs from the approved candidate')

def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as data:
        for block in iter(lambda:data.read(1<<20),b''):h.update(block)
    return h.hexdigest()

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--payload-directory',type=Path);parser.add_argument('--canonical',type=Path)
    args=parser.parse_args()
    if (os.environ.get('SIGNED_RUN')!=RUN or os.environ.get('CANONICAL_SOURCE')!=SOURCE
        or os.environ.get('CANONICAL_RUN')!=CANONICAL_RUN or os.environ.get('CANDIDATE_INDEX_SHA256')!=INDEX):
        raise ValueError('Reuse is limited to the exact reviewed B6 source and runs')
    run=read_api('actions/runs/'+RUN);jobs=read_api('actions/runs/'+RUN+'/jobs?per_page=100')['jobs']
    assembly=next((job for job in jobs if job['name']=='assemble'),None)
    log=read_api('actions/jobs/'+str(assembly['id'])+'/logs',raw=True) if run['conclusion']=='failure' and assembly else ''
    validate_run(run,jobs,log)
    receipt={'schema':1,'signing_run':RUN,'signing_executor_commit':EXECUTOR,'source_commit':SOURCE,
        'canonical_run':CANONICAL_RUN,'candidate_index_sha256':INDEX,'both_native_signature_gates':'success',
        'original_assembly_failure':'known_artifact_path' if run['conclusion']=='failure' else None,'signed_archives':{}}
    if args.payload_directory:
        if not args.canonical:raise ValueError('Canonical verifier is required for archive reuse')
        sys.path.insert(0,str(args.canonical/'packages/host-tools/scripts'))
        from verify_bundle_archive import verify_archive
        for platform in MACS:
            root=args.payload_directory/('canonical-signed-host-tools-'+platform)
            proof=root/'input-qualification.json';validate_input(json.loads(proof.read_text()),platform)
            archive=root/'canonical/packages/host-tools/dist'/('openagent-host-tools-'+platform+'.tar.gz')
            sha=digest(archive)
            if Path(str(archive)+'.sha256').read_text().split()[0]!=sha:raise ValueError('Signed archive checksum differs')
            verified=verify_archive(archive,expected_platform=platform,expected_version='1.0.0b6')
            receipt['signed_archives'][platform]={'archive_sha256':sha,'bundle_manifest_sha256':hashlib.sha256(verified.manifest_bytes).hexdigest(),
                'input_qualification_sha256':digest(proof)}
    print(json.dumps(receipt,sort_keys=True))
if __name__=='__main__':main()
