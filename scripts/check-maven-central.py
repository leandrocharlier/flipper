"""Check the complete release set on Maven Central without credentials."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import re
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

from importlib.util import module_from_spec, spec_from_file_location

spec = spec_from_file_location('maven_validation', Path(__file__).with_name('validate-maven-artifacts.py'))
validation = module_from_spec(spec)
spec.loader.exec_module(validation)

parser = argparse.ArgumentParser()
parser.add_argument('--expect', choices=('published', 'unpublished'), required=True)
parser.add_argument('--version')
args = parser.parse_args()
properties = (Path(__file__).resolve().parents[1] / 'gradle.properties').read_text()
version = args.version or re.search(r'^VERSION_NAME=(.+)$', properties, re.M)[1].strip()
if not re.fullmatch(r'\d+\.\d+\.\d+(?:[-.][A-Za-z0-9]+)*', version):
    raise SystemExit('Expected a release version; snapshots are not supported')
if 'SNAPSHOT' in version.upper():
    raise SystemExit('Snapshots are not supported by this release check')

def check(artifact):
    url = f'https://repo.maven.apache.org/maven2/{validation.GROUP.replace(".", "/")}/{artifact}/{version}/{artifact}-{version}.pom'
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            pom = ET.fromstring(response.read())
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return artifact, False
        raise
    for field, expected in [('groupId', validation.GROUP), ('artifactId', artifact), ('version', version)]:
        if pom.findtext('m:' + field, namespaces=validation.NS) != expected:
            raise RuntimeError(f'Unexpected published coordinates for {artifact}')
    return artifact, True

with ThreadPoolExecutor(max_workers=4) as pool:
    results = dict(pool.map(check, sorted(validation.ARTIFACTS)))
published = sorted(name for name, present in results.items() if present)
if args.expect == 'published' and len(published) != len(results):
    raise SystemExit('Incomplete publication; missing: ' + ', '.join(sorted(set(results) - set(published))))
if args.expect == 'unpublished' and published:
    raise SystemExit(f'Version {version} already exists on Central ({len(published)}/{len(results)} artifacts). Choose a new version; do not republish it.')
print(f'PASS: {version}: {len(published)}/{len(results)} artifacts published; expected {args.expect}.')
