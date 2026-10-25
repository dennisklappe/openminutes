import re
from typing import BinaryIO

CHUNK = 1024 * 1024

# A hub name such as "small", "large-v3" or "Systran/faster-whisper-small". An absolute path, a
# relative path or a name with ".." would make the library open a file or fetch an arbitrary repo.
MODEL_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}(/[A-Za-z0-9][A-Za-z0-9._-]{0,95})?")


class UploadTooLarge(Exception):
    pass


def valid_model(name: str) -> bool:
    return MODEL_NAME.fullmatch(name) is not None and ".." not in name


def copy_limited(source: BinaryIO, target: BinaryIO, max_bytes: int) -> int:
    """Copies the upload to disk and gives up once it is larger than max_bytes."""
    total = 0
    while chunk := source.read(CHUNK):
        total += len(chunk)
        if total > max_bytes:
            raise UploadTooLarge(f"The upload is larger than {max_bytes} bytes")
        target.write(chunk)
    return total
