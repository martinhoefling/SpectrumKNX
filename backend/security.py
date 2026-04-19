import os

def is_safe_path(base_dir: str, path: str) -> bool:
    """
    Checks if the requested path is safe and stays within the base directory.
    This prevents path traversal attacks.
    """
    if not path or '\0' in path:
        return False

    abs_base_dir = os.path.abspath(base_dir)
    requested_path = os.path.abspath(os.path.join(abs_base_dir, path))

    # Check if the requested path is within the base directory
    return os.path.commonpath([abs_base_dir, requested_path]) == abs_base_dir
