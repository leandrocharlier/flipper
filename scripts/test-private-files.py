"""Synthetic regression cases for publication and Git privacy checks."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('privacy', Path(__file__).with_name('check-private-files.py'))
privacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(privacy)

class PrivacyTests(unittest.TestCase):
    def test_private_paths_are_rejected_even_without_recognizable_contents(self):
        for name in ('local.properties', 'nested/local.properties', '.signing/renamed.bin',
                     '.publishing/backup.dat', 'key.p12', 'key.jks', 'key.keystore', 'key.gpg', 'capture.flipper'):
            with self.subTest(name=name):
                self.assertTrue(privacy.reject(name, b'synthetic data', []))

    def test_renamed_private_key_is_rejected(self):
        data = b'-----BEGIN PRIVATE KEY-----\n' + b'A' * 64
        self.assertTrue(privacy.reject('notes.txt', data, []))

    def test_copied_local_secret_is_rejected_without_printing_it(self):
        secret = b'synthetic-test-password-12345'
        self.assertTrue(privacy.reject('build.gradle', b'password=' + secret, [secret]))

    def test_public_demo_certificate_is_allowed_but_private_key_is_not(self):
        self.assertFalse(privacy.reject(privacy.PUBLIC_CA, b'-----BEGIN CERTIFICATE-----\nTEST', []))
        self.assertTrue(privacy.reject(privacy.PUBLIC_CA, b'-----BEGIN RSA PRIVATE KEY-----\n' + b'A' * 64, []))

    def test_regular_sources_are_allowed(self):
        self.assertFalse(privacy.reject('src/Main.java', b'class Main {}', []))

if __name__ == '__main__':
    unittest.main()
