"""Small provisioning checks: temporary files only, no pip or model imports."""
import json
from contextlib import redirect_stdout
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import install_shared as installer


class InstallerTests(unittest.TestCase):
    def test_isolated_install_orchestration_and_repeat_skip_package_installs(self):
        # All paths and subprocesses are replaced; this is not a real install.
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'source'
            snapshot = source / 'hub/models--test--model/snapshots/abc'
            snapshot.mkdir(parents=True)
            (snapshot / 'config.json').write_text('{}')
            models = [{'repo': 'test/model', 'revision': 'abc', 'files': {'config.json': 2}}]
            (root / 'models.json').write_text(json.dumps(models))
            for kind in ('speech', 'embed'):
                (root / f'{kind}-requirements.txt').write_text('example==1.0\n')
            commands = []

            def fake_run(*args, **kwargs):
                commands.append(tuple(str(arg) for arg in args))
                if args[1:3] == ('-m', 'venv'):
                    base = args[3]
                    (base / 'bin').mkdir(parents=True)
                    (base / 'bin/python').write_text('fake interpreter, never executed')
                    (base / 'bin/python').chmod(0o700)
                    (base / 'pyvenv.cfg').write_text('fake environment')

            original_umask = installer.os.umask(0o077)
            try:
                with patch.object(installer, 'HERE', root), patch.object(installer, 'SHARED', root / 'shared'), \
                        patch.object(installer, 'FFMPEG', snapshot / 'config.json'), \
                        patch.object(installer.os, 'geteuid', return_value=501), \
                        patch('sys.argv', ['installer', '--source-hf', str(source), '--wheelhouse', str(root / 'wheels')]), \
                        patch.object(installer, 'run', side_effect=fake_run), \
                        patch.object(installer.subprocess, 'check_output', return_value=str(root / 'cache')), \
                        redirect_stdout(io.StringIO()):
                    installer.main()
                    target = root / 'shared/hf/hub/models--test--model/snapshots/abc/config.json'
                    stamp = target.stat().st_mtime_ns
                    installer.main()
                    self.assertEqual(stamp, target.stat().st_mtime_ns)
            finally:
                installer.os.umask(original_umask)
            self.assertEqual(sum('venv' in command for command in commands), 2)
            self.assertEqual(sum('install' in command for command in commands), 2)
            self.assertTrue(all('--no-deps' in command for command in commands if 'install' in command))
            self.assertEqual(sum('-c' in command for command in commands), 4)
            for location in ('runtime/speech', 'runtime/embed', 'hf'):
                self.assertTrue((root / 'shared' / location / '.memoria-complete').is_file())
            self.assertEqual(target.stat().st_mode & 0o777, 0o644)

    def test_dry_run_does_not_create_shared_files_or_run_commands(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'source'
            snapshot = source / 'hub/models--test--model/snapshots/abc'
            snapshot.mkdir(parents=True)
            (snapshot / 'config.json').write_text('{}')
            models = [{'repo': 'test/model', 'revision': 'abc', 'files': {'config.json': 2}}]
            (root / 'models.json').write_text(json.dumps(models))
            for kind in ('speech', 'embed'):
                (root / f'{kind}-requirements.txt').write_text('example==1.0\n')
            output = io.StringIO()
            with patch.object(installer, 'HERE', root), patch.object(installer, 'SHARED', root / 'shared'), \
                    patch.object(installer.os, 'geteuid', return_value=501), \
                    patch('sys.argv', ['installer', '--dry-run', '--source-hf', str(source)]), \
                    patch.object(installer, 'run', side_effect=AssertionError('dry-run executed a command')), \
                    redirect_stdout(output):
                installer.main()
            self.assertFalse((root / 'shared').exists())
            self.assertIn('2 bytes', output.getvalue())
            self.assertIn('DRY RUN:', output.getvalue())

    def test_offline_lock_replaces_only_pinned_direct_urls(self):
        text = 'numpy==2.4.5\nmlx-audio @ https://example.invalid/git.zip\nen_core_web_sm @ https://example.invalid/model.whl\n'
        self.assertEqual(installer.offline_requirements(text),
                         'numpy==2.4.5\nmlx-audio==0.6.3\nen_core_web_sm==3.8.0\n')
        with self.assertRaises(KeyError):
            installer.offline_requirements('unreviewed @ https://example.invalid/package.zip')

    def test_snapshot_validation_rejects_missing_or_truncated_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            files = {'weights': 3}
            with self.assertRaises(ValueError):
                installer.validate_snapshot(root, files)
            (root / 'weights').write_bytes(b'ab')
            with self.assertRaises(ValueError):
                installer.validate_snapshot(root, files)
            (root / 'weights').write_bytes(b'abc')
            installer.validate_snapshot(root, files)

    def test_copy_dereferences_source_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            blob, source, target = (root / name for name in ('blob', 'source', 'target'))
            blob.write_bytes(b'not model weights')
            source.symlink_to(blob)
            installer.copy_if_changed(source, target)
            self.assertFalse(target.is_symlink())
            stamp = target.stat().st_mtime_ns
            installer.copy_if_changed(source, target)
            self.assertEqual(target.stat().st_mtime_ns, stamp)
            target.unlink()
            target.symlink_to(blob)
            with self.assertRaises(ValueError):
                installer.copy_if_changed(source, target)

    def test_permissions_are_readable_but_not_shared_writable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            outside, tree = root / 'outside', root / 'tree'
            outside.write_text('leave permissions unchanged')
            outside.chmod(0o600)
            tree.mkdir()
            (tree / 'python').symlink_to(outside)
            regular = tree / 'regular'
            regular.write_text('data')
            executable = tree / 'executable'
            executable.write_text('script')
            executable.chmod(0o700)
            installer.public_tree(tree)
            self.assertEqual(tree.stat().st_mode & 0o777, 0o755)
            self.assertEqual(regular.stat().st_mode & 0o777, 0o644)
            self.assertEqual(executable.stat().st_mode & 0o777, 0o755)
            self.assertEqual(outside.stat().st_mode & 0o777, 0o600)

    def test_model_manifest_pins_four_revisions_and_packaged_voice_weights(self):
        models = json.loads((installer.HERE / 'models.json').read_text())
        self.assertEqual([model['repo'] for model in models], ['mlx-community/parakeet-tdt-0.6b-v3', 'mlx-community/Nemotron-3-Diarization',
                                                               'mlx-community/Qwen3.5-4B-MLX-4bit', 'mlx-community/embeddinggemma-2-5bit'])
        for model in models:
            self.assertRegex(model['revision'], r'^[0-9a-f]{40}$')
            self.assertIn('config.json', model['files'])
            self.assertTrue(any(name.endswith('.safetensors') for name in model['files']))
        # The speech recogniser carries a SentencePiece tokenizer; the language and embedding models a JSON one.
        self.assertIn('tokenizer.model', models[0]['files'])
        self.assertTrue(all('tokenizer.json' in model['files'] for model in models[2:]))
        # Resemblyzer's encoder.pt is installed with its wheel, not an HF repo.
        speech = (installer.HERE / 'speech-requirements.txt').read_text()
        self.assertIn('Resemblyzer==0.1.4', speech)


if __name__ == '__main__':
    unittest.main()
