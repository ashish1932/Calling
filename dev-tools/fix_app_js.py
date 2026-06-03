import re
import sys

app_js = "js/app.js"
try:
    with open(app_js, "r", encoding="utf-8") as f:
        content = f.read()
except FileNotFoundError:
    print(f"Error: {app_js} not found.", file=sys.stderr)
    sys.exit(1)

# Login Input Field
# Replace border-radius: 12px; with border-radius: 6px; in login styles
# .login-input-field
content = re.sub(r'(\.login-input-field\s*\{[^}]*)border-radius:\s*12px;', r'\1border-radius: 6px;', content)
# Add outline: 1px solid var(--accent-blue); on focus
content = re.sub(r'(\.login-input-field:focus\s*\{[^}]*)border-color:\s*var\(--accent-blue\);', r'\1border-color: var(--accent-blue);\n          outline: 1px solid var(--accent-blue);', content)

# Remove background blur from login modal inline styles if any
content = re.sub(r'backdrop-filter:\s*blur\([^)]+\);', '', content)

# Kanban Styles
# Increase data density, remove double lines
# Find .kanban-card styles inline or class
content = re.sub(r'border:\s*2px\s*solid', 'border: 1px solid', content)
# Tighten kanban column spacing (assuming it uses gap: 20px or padding)
content = re.sub(r'padding:\s*16px;\s*margin-bottom:\s*16px;', 'padding: 12px; margin-bottom: 12px;', content)

with open(app_js, "w", encoding="utf-8") as f:
    f.write(content)

print("app.js updated.")
