with open("backend/tests/test_api.py", "r") as f:
    content = f.read()

import re

# Remove conflict markers
new_content = re.sub(r'<<<<<<< Updated upstream\n(.*?)=======\n(.*?)>>>>>>> Stashed changes\n', r'\1\n\2', content, flags=re.DOTALL)

with open("backend/tests/test_api.py", "w") as f:
    f.write(new_content)
