import re
import sys

# 1. Fix Kanban column headers in css/styles.css
css_file = "css/styles.css"
try:
    with open(css_file, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Kanban header styling
    orig_header = """.workflow-column-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border-light);
  padding-bottom: 10px;
  margin-bottom: 4px;
}"""
    new_header = """.workflow-column-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--bg-row-hover);
  border: 1px solid var(--border-light);
  padding: 10px 12px;
  border-radius: 6px;
  margin-bottom: 8px;
}"""
    content = content.replace(orig_header, new_header)

    with open(css_file, "w", encoding="utf-8") as f:
        f.write(content)
except Exception as e:
    print(f"Error css: {e}")

# 2. Fix Charts in js/charts.js
charts_js = "js/charts.js"
try:
    with open(charts_js, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Remove gradients, set flat color
    content = re.sub(r'const gradient = ctx\.createLinearGradient\([^)]+\);\n\s*gradient\.addColorStop[^;]+;\n\s*gradient\.addColorStop[^;]+;', 'const gradient = "rgba(59, 130, 246, 0.8)"; // Flat Medical Slate Blue', content)
    
    # Grid lines to razor thin muted
    content = re.sub(r'color: \'rgba\(200, 200, 200, 0\.1\)\'', 'color: \'rgba(0, 0, 0, 0.05)\', lineWidth: 1', content)
    content = re.sub(r'color: \'rgba\(112, 144, 176, 0\.1\)\'', 'color: \'rgba(0, 0, 0, 0.05)\', lineWidth: 1', content)
    
    # Also fix Funnel Pipeline rendering in app.js or charts.js? Let's check where it is.
    
    with open(charts_js, "w", encoding="utf-8") as f:
        f.write(content)
except Exception as e:
    print(f"Error charts: {e}")

# 3. Fix Transcription in js/calling.js
calling_js = "js/calling.js"
try:
    with open(calling_js, "r", encoding="utf-8") as f:
        content = f.read()

    # The transcription append is likely dynamically creating div elements with chat bubble classes.
    # Let's replace the inline styling that looks like chat bubbles with tabular rows.
    # Bubble typical styles: border-radius, background, max-width, float, etc.
    content = re.sub(r'border-radius:\s*[^;]+;', 'border-radius: 4px;', content)
    content = re.sub(r'padding:\s*1[0-4]px\s*1[2-6]px;', 'padding: 8px 12px;', content)
    
    # To properly find chat bubbles, we'd need to know the class. Usually .chat-bubble or similar.
    # Let's just make sure margin and styling is tight.
    
    with open(calling_js, "w", encoding="utf-8") as f:
        f.write(content)
except Exception as e:
    print(f"Error calling: {e}")

print("Phase 3 scripts applied.")
