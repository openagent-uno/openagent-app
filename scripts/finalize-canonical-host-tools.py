"""Preserve original non-macOS payloads and emit a bounded signing attestation."""
import hashlib
import json
import os
from pathlib import Path
import sys

root=Path(sys.argv[1]);original=json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))
final=json.loads((root/'release-index.json').read_text(encoding='utf-8'))
for field in ('schema','version','source_repository','source_commit','source_ref','python_wheel'):
    if original[field]!=final[field]:raise ValueError('Signing changed canonical provenance or wheel: '+field)
for target in ('linux-arm64','linux-x64','win32-arm64','win32-x64'):
    if original['platforms'][target]!=final['platforms'][target]:raise ValueError('Signing changed an original non-macOS target')
proof={'schema':1,'qualification':'signed-native-candidate','source_repository':final['source_repository'],
       'source_commit':final['source_commit'],'version':final['version'],
       'canonical_run':os.environ['CANONICAL_RUN'],'candidate_index_sha256':os.environ['CANDIDATE_INDEX_SHA256'],
       'signing_executor_repository':os.environ['GITHUB_REPOSITORY'],'signing_executor_commit':os.environ['GITHUB_SHA'],
       'signing_run':os.environ['GITHUB_RUN_ID'],
       'private_staging_tag':os.environ.get('STAGING_TAG') or None,
       'candidate_retrieval':'private-draft' if os.environ.get('STAGING_TAG') else 'canonical-actions-artifact','macos_signed_notarized_targets':['darwin-arm64','darwin-x64'],
       'unchanged_native_targets':['linux-arm64','linux-x64','win32-arm64','win32-x64'],
       'windows_authenticode_claimed':False,'public_release_created':False,
       'linux_arm64_coverage':{'native_core':True,'native_computer_control':True,'browser_catalog_probe':True,'browser_navigation':False},
       'acceptance_boundary':'Synthetic CI fixtures; no real-provider OAuth or persisted user-profile acceptance',
       'original_archives':original['platforms'],'final_archives':final['platforms']}
(root/'qualification.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8')
entries=[]
for path in sorted(root.iterdir()):
    if path.is_file() and (path.name.endswith(('.tar.gz','.tar.gz.sha256','.whl')) or path.name in ('release-index.json','qualification.json')):
        digest=hashlib.sha256()
        with path.open('rb') as handle:
            for block in iter(lambda:handle.read(1<<20),b''):digest.update(block)
        entries.append(digest.hexdigest()+'  '+path.name+'\n')
(root/'SHA256SUMS').write_text(''.join(entries),encoding='utf-8')
