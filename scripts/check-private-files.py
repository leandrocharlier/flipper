"""Reject local credentials/private keys in the Git index or commits being pushed.

Prints only a generic failure, never secret values or matching source lines.
The localhost sample CA is public and is the only permitted certificate file.
"""
import re
import subprocess
import sys
from pathlib import Path

PUBLIC_CA = 'android/sample/src/debug/res/raw/mock_api_dev_ca.pem'
FORBIDDEN_PARTS = {'.signing', '.publishing', 'local.properties', 'private-keys-v1.d'}
FORBIDDEN_SUFFIXES = ('.keystore', '.jks', '.p12', '.pfx', '.key', '.gpg', '.kbx', '.enc', '.flipper', '.pem')
KEY = re.compile(rb'-----BEGIN (?:[A-Z ]*PRIVATE KEY(?: BLOCK)?)-----\r?\n[A-Za-z0-9+/=]{30,}')
TOKEN = re.compile(rb'(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{70,})')

def git(*args):
    return subprocess.check_output(['git', *args], stderr=subprocess.DEVNULL)

def reject(path, content, secrets):
    normalized = path.replace('\\', '/').lower()
    return (bool(set(normalized.split('/')) & FORBIDDEN_PARTS)
            or (normalized.endswith(FORBIDDEN_SUFFIXES) and normalized != PUBLIC_CA)
            or bool(KEY.search(content) or TOKEN.search(content))
            or any(value in content for value in secrets))

def main():
    root = Path(git('rev-parse', '--show-toplevel').decode().strip())
    secrets = []
    config = root / 'local.properties'
    if config.is_file():
        # Local Maven tokens and generated signing passwords contain no escapes.
        for line in config.read_bytes().splitlines():
            name, separator, value = line.partition(b'=')
            if separator and (b'password' in name.lower() or name.strip() == b'mavenCentralUsername'):
                value = value.strip()
                if len(value) >= 8:
                    secrets.append(value)
    candidates = []
    if '--pre-push' in sys.argv:
        for line in sys.stdin:
            _, local, _, remote = line.split()
            if set(local) == {'0'}:
                continue
            # Inspect each new commit, including files removed again before HEAD.
            args = (f'{remote}..{local}',) if set(remote) != {'0'} else (local, '--not', '--remotes')
            commits = git('rev-list', *args).decode().splitlines()
            for commit in commits:
                files = git('diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-m', '--diff-filter=ACMR', '-z', commit)
                candidates.extend((f'{commit}:{path}', path) for path in files.decode().split('\0') if path)
    else:
        # Inspect the complete index, not the potentially different working copy.
        candidates = [(f':{path}', path) for path in git('ls-files', '-z').decode().split('\0') if path]
    with subprocess.Popen(['git', 'cat-file', '--batch'], stdin=subprocess.PIPE, stdout=subprocess.PIPE) as reader:
        try:
            for reference, path in candidates:
                reader.stdin.write(reference.encode() + b'\n')
                reader.stdin.flush()
                header = reader.stdout.readline().split()
                if len(header) != 3:
                    raise RuntimeError('Privacy check could not read a Git object; blocking operation.')
                content = reader.stdout.read(int(header[2]))
                reader.stdout.read(1)
                if reject(path, content, secrets):
                    raise RuntimeError('Git operation blocked: local/private file or credential detected. Nothing was uploaded by this check.')
        finally:
            reader.stdin.close()
    print('Privacy check passed: no prohibited files or detected credentials.')

if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(str(error) if isinstance(error, RuntimeError) else 'Privacy check could not complete; blocking Git operation.', file=sys.stderr)
        sys.exit(1)
