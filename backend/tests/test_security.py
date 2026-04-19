import unittest

from security import is_safe_path


class TestSecurity(unittest.TestCase):
    def setUp(self):
        self.static_dir = "/app/backend/static"

    def test_safe_paths(self):
        self.assertTrue(is_safe_path(self.static_dir, "index.html"))
        self.assertTrue(is_safe_path(self.static_dir, "assets/logo.png"))
        self.assertTrue(is_safe_path(self.static_dir, "js/app.js"))

    def test_traversal_attempts(self):
        self.assertFalse(is_safe_path(self.static_dir, "../secret.txt"))
        self.assertFalse(is_safe_path(self.static_dir, "../../etc/passwd"))
        self.assertFalse(is_safe_path(self.static_dir, "assets/../../etc/passwd"))

    def test_absolute_paths(self):
        self.assertFalse(is_safe_path(self.static_dir, "/etc/passwd"))

    def test_empty_path(self):
        self.assertFalse(is_safe_path(self.static_dir, ""))

    def test_null_byte(self):
        # Though os.path.abspath handles it, it's good to check
        self.assertFalse(is_safe_path(self.static_dir, "index.html\0.php"))

if __name__ == "__main__":
    unittest.main()
