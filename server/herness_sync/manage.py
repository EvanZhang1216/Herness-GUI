import argparse
import json
from .database import create_pool, migrate
from .blobs import BlobStore
from .retention import cleanup

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['migrate', 'cleanup'])
    args = parser.parse_args()
    with create_pool() as pool:
        pool.wait()
        if args.command == 'migrate':
            migrate(pool)
            print('Schema migration complete')
        else:
            print(json.dumps(cleanup(pool, BlobStore())))
