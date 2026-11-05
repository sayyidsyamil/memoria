import tempfile
import unittest
from pathlib import Path

from engine import Engine
from private_storage import mark_private


class PrivateStorageTests(unittest.TestCase):
    def test_private_folders_ignore_their_whole_content_in_git(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = mark_private(Path(folder) / '.memoria-recordings')
            self.assertEqual((directory / '.gitignore').read_text().splitlines()[-1], '*')
            (directory / '.gitignore').write_text('*\n# kept as the user left it\n')
            mark_private(directory)
            self.assertIn('kept as the user left it', (directory / '.gitignore').read_text())

    def test_the_engine_marks_its_state_folder_private(self):
        with tempfile.TemporaryDirectory() as folder:
            engine = Engine(folder)
            engine.db.close()
            self.assertTrue((Path(folder) / '.memoria-memory' / '.gitignore').is_file())


if __name__ == '__main__':
    unittest.main()
