"""Verify operator-owned unpublished staging in the signing executor repository."""
import json
import os
import re
import urllib.request

def validate(release, *, repository, tag, run, source, index):
    if repository!='openagent-uno/openagent-app' or tag!='host-tools-b6-staging-'+run or not re.fullmatch('[0-9]+',run):
        raise ValueError('Unexpected staging repository or run-bound tag')
    if release.get('draft') is not True or release.get('tag_name')!=tag:
        raise ValueError('Only the exact private draft staging release is accepted')
    expected={'source_repository':'openagent-uno/openagent','source_commit':source,
              'canonical_run':run,'candidate_index_sha256':index}
    if json.loads(release.get('body',''))!=expected:
        raise ValueError('Staging provenance differs from the root-reviewed candidate')
    names={asset['name'] for asset in release['assets']}
    wanted={'release-index.json','openagent_host_tools-1.0.0b6-py3-none-any.whl'}
    for platform in ('darwin-arm64','darwin-x64','linux-arm64','linux-x64','win32-arm64','win32-x64'):
        wanted.update(('openagent-host-tools-'+platform+'.tar.gz','openagent-host-tools-'+platform+'.tar.gz.sha256'))
    if names!=wanted or len(release['assets'])!=len(wanted):
        raise ValueError('Draft staging contains a different candidate inventory')
    digest=next(asset.get('digest') for asset in release['assets'] if asset['name']=='release-index.json')
    if digest and digest!='sha256:'+index:
        raise ValueError('GitHub asset digest differs from the reviewed candidate index')

def main():
    tag=os.environ['STAGING_TAG'];run=os.environ['CANONICAL_RUN'];repo=os.environ['GITHUB_REPOSITORY']
    if repo!='openagent-uno/openagent-app' or tag!='host-tools-b6-staging-'+run or not re.fullmatch('[0-9]+',run):raise ValueError('Invalid staging repository or tag')
    req=urllib.request.Request('https://api.github.com/repos/'+repo+'/releases/tags/'+tag,
        headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json'})
    with urllib.request.urlopen(req,timeout=30) as r:release=json.load(r)
    validate(release,repository=repo,tag=tag,run=run,source=os.environ['CANONICAL_SOURCE'],index=os.environ['CANDIDATE_INDEX_SHA256'])
    print(json.dumps({'draft':True,'staging_tag':tag,'canonical_run':run,'public_release_created':False}))
if __name__=='__main__':main()
