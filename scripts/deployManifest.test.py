#!/usr/bin/env python3
"""Offline deployment regression tests; ssh/rsync are stubs, not network clients."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import sys
sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('manifest', ROOT / 'scripts/deployManifest.py')
manifest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manifest)


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        for name in ['bin', 'scripts', 'api']:
            (self.root / name).mkdir()
        shutil.copy(ROOT / 'bin/deploy.sh', self.root / 'bin/deploy.sh')
        shutil.copy(ROOT / 'scripts/deployManifest.py', self.root / 'scripts/deployManifest.py')
        (self.root / '.gitignore').write_text('.env*\nprivate/\nnode_modules/\n')
        (self.root / 'existing.ts').write_text('old')
        subprocess.run(['git', '-C', str(self.root), 'add', '.'], check=True)
        (self.root / 'new.ts').write_text('new')
        (self.root / 'public/assets/avatar').mkdir(parents=True)
        (self.root / 'public/assets/avatar/new.webp').write_bytes(b'image')
        (self.root / 'api/new.php').write_text('<?php')
        (self.root / '.env.local').write_text('DO_NOT_DEPLOY=synthetic')
        subprocess.run(['git', '-C', str(self.root), 'add', '-f', '.env.local'], check=True)
        (self.root / 'private').mkdir()
        (self.root / 'private/evidence.json').write_text('private')
        (self.root / 'private/houki-kakomon/sets').mkdir(parents=True)
        (self.root / 'private/houki-kakomon/sets/1sou-houki-2024.json').write_text('{}')
        (self.root / 'link.ts').symlink_to(self.root / '.env.local')
        self.tools = self.root / 'fake-tools'
        self.tools.mkdir()
        self.log = self.root / 'calls.jsonl'
        self.key = self.root / 'test-key'
        self.key.write_text('synthetic')
        for command in ['ssh', 'rsync']:
            script = self.tools / command
            script.write_text('''#!/usr/bin/env python3
import json,os,sys
body=sys.stdin.read() if os.path.basename(sys.argv[0])=='ssh' else ''
with open(os.environ['TEST_LOG'],'a') as f: f.write(json.dumps({'tool':os.path.basename(sys.argv[0]),'args':sys.argv[1:],'body':body})+'\\n')
if os.environ.get('FAIL_DB')=='1' and 'bin/migrate.php' in body: sys.exit(7)
''')
            script.chmod(0o755)
        self.env = {**os.environ, 'PATH': str(self.tools) + ':' + os.environ['PATH'], 'DEPLOY_SSH_KEY': str(self.key), 'DEPLOY_PATH': '/test/app', 'DEPLOY_API_PATH': '/test/php-api', 'TEST_LOG': str(self.log)}

    def tearDown(self):
        self.tmp.cleanup()

    def run_deploy(self, *args, **env):
        result = subprocess.run(['bash', str(self.root / 'bin/deploy.sh'), *args], env={**self.env, **env}, text=True, capture_output=True)
        calls = [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []
        return result, calls

    def test_new_files_and_private_boundaries(self):
        app = manifest.collect(self.root, 'app')
        self.assertIn('new.ts', app)
        self.assertIn('public/assets/avatar/new.webp', app)
        self.assertIn('private/houki-kakomon/sets/1sou-houki-2024.json', app)
        self.assertNotIn('private/evidence.json', app)
        self.assertNotIn('.env.local', app)
        self.assertNotIn('link.ts', app)
        self.assertEqual(manifest.collect(self.root, 'api'), ['new.php'])
        (self.root / 'existing.ts').unlink()
        self.assertNotIn('existing.ts', manifest.collect(self.root, 'app'))

    def test_list_files_needs_no_key_or_connection(self):
        result, calls = self.run_deploy('--list-files', DEPLOY_SSH_KEY='/missing')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, [])

    def test_dry_run_never_builds_or_changes_db(self):
        result, calls = self.run_deploy('--dry-run', '--with-build', '--with-db')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([c['tool'] for c in calls], ['rsync', 'rsync'])
        self.assertTrue(all('--dry-run' in c['args'] for c in calls))
        self.assertTrue(all('--delete' not in c['args'] for c in calls))

    def test_build_then_db_then_reload(self):
        result, calls = self.run_deploy('--with-build', '--with-db')
        self.assertEqual(result.returncode, 0, result.stderr)
        scripts = [c['body'] for c in calls if c['tool'] == 'ssh']
        self.assertEqual(len(scripts), 4)
        self.assertIn('composer', scripts[0])
        self.assertIn('run build', scripts[1])
        self.assertIn('bin/migrate.php', scripts[2])
        self.assertIn('reload ecosystem', scripts[3])
        self.assertIn('/test/php-api', scripts[2])

    def test_db_failure_stops_before_reload(self):
        result, calls = self.run_deploy('--with-build', '--with-db', FAIL_DB='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('reload ecosystem' in c['body'] for c in calls))

    def test_db_is_explicit_not_default(self):
        result, calls = self.run_deploy('--with-build')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any('bin/migrate.php' in c['body'] for c in calls))


if __name__ == '__main__':
    unittest.main()
