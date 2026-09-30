"""Validate the complete Android release locally before signing or uploading."""
import argparse
import io
import json
import re
import struct
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

GROUP = 'io.github.leandrocharlier.flipper'
ARTIFACTS = {
    'flipper', 'flipper-noop', 'flipper-network-plugin', 'flipper-litho-plugin',
    'flipper-leakcanary-plugin', 'flipper-leakcanary2-plugin',
    'flipper-retrofit2-protobuf-plugin', 'flipper-jetpack-compose-plugin',
    'flipper-openssl', 'flipper-yoga', 'flipper-flexlayout',
    'flipper-imagepipeline-native', 'flipper-nativeimagefilters',
    'flipper-nativeimagetranscoder', 'flipper-inspection-lib',
}
NS = {'m': 'http://maven.apache.org/POM/4.0.0'}
PRIVATE_KEY = re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----[\r\n]+[A-Za-z0-9+/=]{30}')

def require(condition, message):
    if not condition:
        raise RuntimeError(message)

def inspect_archive(data, label, native):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for entry in archive.infolist():
            name = entry.filename
            require(not name.startswith(('/', '\\')) and '..' not in Path(name).parts,
                    f'Unsafe archive path in {label}')
            require(not any(part in name.lower().split('/') for part in
                            ('.publishing', '.signing', 'local.properties', 'private-keys-v1.d', '.git')),
                    f'Local-only file in {label}')
            require(not name.lower().endswith(('.flipper', '.pem', '.key', '.p12', '.pfx', '.keystore', '.jks', '.gpg', '.kbx')),
                    f'Forbidden private/session/certificate file in {label}: {name}')
            if entry.is_dir():
                continue
            content = archive.read(entry)
            require(not PRIVATE_KEY.search(content), f'Private key material in {label}: {name}')
            require(not re.search(rb'(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{70,})', content),
                    f'Credential pattern in {label}: {name}')
            if name.endswith('.jar'):
                inspect_archive(content, f'{label}/{name}', native)
            if name.endswith('.so') and ('arm64-v8a' in name or 'x86_64' in name):
                require(content[:5] == b'\x7fELF\x02', f'Expected ELF64: {label}/{name}')
                endian = '<' if content[5] == 1 else '>'
                offset = struct.unpack_from(endian+'Q', content, 32)[0]
                size, count = struct.unpack_from(endian+'HH', content, 54)
                loads = []
                for index in range(count):
                    header = struct.unpack_from(endian+'IIQQQQQQ', content, offset+index*size)
                    if header[0] == 1:
                        loads.append(header[-1])
                require(loads and all(value >= 16384 for value in loads),
                        f'Native library is not aligned for 16 KB: {label}/{name}')
                native.append(f'{label}/{name}')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repository', default='work/maven-repository')
    parser.add_argument('--version', default='1.0.0')
    parser.add_argument('--report', default='work/maven-validation.json')
    args = parser.parse_args()
    root = Path(args.repository)/GROUP.replace('.', '/')
    found = {p.name for p in root.iterdir() if p.is_dir() and (p/args.version).is_dir()}
    require(found == ARTIFACTS, f'All plugins must be present. Missing: {sorted(ARTIFACTS-found)}; unexpected: {sorted(found-ARTIFACTS)}')
    native = []
    total = 0
    for artifact in sorted(ARTIFACTS):
        base = root/artifact/args.version/f'{artifact}-{args.version}'
        pom = ET.parse(str(base)+'.pom').getroot()
        require(pom.findtext('m:groupId', namespaces=NS) == GROUP, f'Wrong namespace: {artifact}')
        require(pom.findtext('m:artifactId', namespaces=NS) == artifact, f'Wrong artifactId: {artifact}')
        for field in ('version', 'name', 'description', 'url', 'licenses/license/name', 'developers/developer/name', 'scm/url'):
            require(pom.findtext('/'.join('m:'+p for p in field.split('/')), namespaces=NS), f'Missing POM {field}: {artifact}')
        for dependency in pom.findall('m:dependencies/m:dependency', NS):
            group = dependency.findtext('m:groupId', namespaces=NS)
            name = dependency.findtext('m:artifactId', namespaces=NS)
            version = dependency.findtext('m:version', namespaces=NS)
            require(group not in ('local.flipper', 'com.facebook.flipper'), f'Unpublished/upstream Flipper dependency: {artifact} -> {group}:{name}')
            if group == GROUP:
                require(name in ARTIFACTS and version == args.version, f'Missing community dependency: {artifact} -> {name}:{version}')
        for suffix in ('.aar', '-sources.jar', '-javadoc.jar'):
            file = Path(str(base)+suffix)
            require(file.is_file(), f'Missing publication file: {file.name}')
            total += file.stat().st_size
            inspect_archive(file.read_bytes(), file.name, native)
    require(native, 'No native libraries were checked')
    result = {'version': args.version, 'artifacts': sorted(ARTIFACTS), 'artifactCount': len(ARTIFACTS),
              'native64BitEntriesChecked': len(native), 'artifactBytes': total, 'passed': True}
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(result))

if __name__ == '__main__':
    main()
