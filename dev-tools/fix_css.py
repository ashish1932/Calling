import re
import sys

css_file = "css/styles.css"
try:
    with open(css_file, "r", encoding="utf-8") as f:
        content = f.read()
except FileNotFoundError:
    print(f"Error: {css_file} not found.", file=sys.stderr)
    sys.exit(1)

# Reduce border radii globally to 6px or 8px.
content = re.sub(r'border-radius:\s*2[0-9]px;', 'border-radius: 8px;', content)
content = re.sub(r'border-radius:\s*1[0-9]px;', 'border-radius: 6px;', content)

# Remove drop shadows on cards and replace with borders
content = re.sub(r'box-shadow:\s*var\(--shadow-neon\);', 'border: 1px solid var(--border-light);', content)
content = re.sub(r'box-shadow:\s*var\(--shadow-pulse\);', 'border: 1px solid var(--border-light);', content)
content = re.sub(r'box-shadow:\s*0\s+[0-9]+px\s+[0-9]+px\s+rgba\([^)]+\);', '', content)

# Reduce excessive padding on cards
content = re.sub(r'padding:\s*28px;', 'padding: 16px;', content)
content = re.sub(r'padding:\s*24px;', 'padding: 16px;', content)

# Update pill colors to be more professional and desaturated
content = content.replace('rgba(255, 82, 82, 0.1)', 'rgba(239, 68, 68, 0.1)')
content = content.replace('rgba(0, 242, 254, 0.1)', 'rgba(59, 130, 246, 0.1)')
content = content.replace('rgba(165, 94, 234, 0.1)', 'rgba(79, 70, 229, 0.1)')
content = content.replace('rgba(32, 191, 107, 0.1)', 'rgba(16, 185, 129, 0.1)')
content = content.replace('rgba(220, 38, 38, 0.15)', 'rgba(220, 38, 38, 0.1)')

# Update active nav item
nav_item_active_orig = """.nav-item.active {
  background: var(--accent-blue);
  color: #ffffff;
  border: 1px solid transparent;
}"""
nav_item_active_new = """.nav-item.active {
  background: rgba(59, 130, 246, 0.1);
  color: var(--accent-blue);
  border-left: 3px solid var(--accent-blue);
  border-radius: 0 6px 6px 0;
}"""
if ".nav-item.active" in content:
    content = re.sub(r'\.nav-item\.active\s*\{[^}]+\}', nav_item_active_new, content)

# Change .nav-item.active svg stroke
nav_item_active_svg_orig = """.nav-item.active svg {
  stroke: #ffffff;
}"""
nav_item_active_svg_new = """.nav-item.active svg {
  stroke: var(--accent-blue);
}"""
if ".nav-item.active svg" in content:
    content = re.sub(r'\.nav-item\.active svg\s*\{[^}]+\}', nav_item_active_svg_new, content)

# Remove background blur from login modal
content = re.sub(r'backdrop-filter:\s*blur\([^)]+\);', '', content)

with open(css_file, "w", encoding="utf-8") as f:
    f.write(content)

print("CSS updated successfully.")
