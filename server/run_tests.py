"""Run real PostgreSQL/HTTP/Hermes integration contracts against a dedicated test database."""
import os
import sys
import unittest
from pathlib import Path

root = Path(__file__).resolve().parent
sys.path.insert(0, str(root))
if len(sys.argv) > 1:
    for line in Path(sys.argv.pop(1)).read_text(encoding='utf-8-sig').splitlines():
        key, separator, value = line.partition('=')
        if separator and key == 'DATABASE_URL':
            os.environ[key] = value.replace('127.0.0.1:5432', '127.0.0.1:55432')
suite = unittest.defaultTestLoader.discover(str(root / 'tests'))
result = unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(not result.wasSuccessful())
