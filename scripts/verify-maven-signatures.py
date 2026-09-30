"""Verify a staged release using a key downloaded from a Central-supported server.

Uses a fresh public-only keyring. Never exports or uploads a private key.
"""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--repository', default='work/maven-repository')
parser.add_argument('--fingerprint', default='91AA2B46B9485CACA005B2B03AA49E19541FC814')
parser.add_argument('--gpg', default=shutil.which('gpg'))
args = parser.parse_args()
fingerprint = args.fingerprint.upper()
if len(fingerprint) != 40 or any(c not in '0123456789ABCDEF' for c in fingerprint):
    raise SystemExit('Expected a full OpenPGP v4 fingerprint')
if not args.gpg:
    raise SystemExit('Install GnuPG or supply --gpg')
signatures = sorted(Path(args.repository).rglob('*.asc'))
if not signatures:
    raise SystemExit('No detached signatures found; stage signed publications first')
scratch = Path('work').resolve()
scratch.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='public-key-check-', dir=scratch) as directory:
    home = Path(directory)
    key = home / 'public.asc'
    url = 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x' + fingerprint
    with urllib.request.urlopen(url, timeout=60) as response:
        public = response.read(1_000_001)
    if len(public) > 1_000_000 or b'-----BEGIN PGP PUBLIC KEY BLOCK-----' not in public or b'PRIVATE KEY' in public:
        raise SystemExit('Keyserver did not return a public verification key')
    key.write_bytes(public)
    gpg_home = str(home)
    cygpath = Path(args.gpg).resolve().with_name('cygpath.exe')
    if os.name == 'nt' and cygpath.is_file():
        gpg_home = subprocess.check_output([str(cygpath), '-u', gpg_home], text=True).strip()
    base = [args.gpg, '--homedir', gpg_home, '--batch']
    listing = subprocess.run(base + ['--with-colons', '--show-keys', str(key)], capture_output=True, check=True).stdout
    fingerprints = [line.split(b':')[9].decode() for line in listing.splitlines() if line.startswith(b'fpr:')]
    if not fingerprints or fingerprints[0] != fingerprint:
        raise SystemExit('Downloaded public key fingerprint mismatch')
    subprocess.run(base + ['--import', str(key)], capture_output=True, check=True)
    for signature in signatures:
        if not signature.read_bytes().startswith(b'-----BEGIN PGP SIGNATURE-----'):
            raise SystemExit('Expected a detached public signature')
        result = subprocess.run(base + ['--status-fd', '1', '--verify', str(signature), str(signature)[:-4]], capture_output=True)
        if result.returncode != 0 or ('[GNUPG:] VALIDSIG ' + fingerprint + ' ').encode() not in result.stdout:
            raise SystemExit('Signature verification failed: ' + signature.name)
print(f'Verified {len(signatures)} signatures with the downloaded public key in an isolated keyring.')
