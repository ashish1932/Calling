import json
import os

log_path = 'C:/Users/aryas/.gemini/antigravity-ide/brain/c02917cb-c8a5-43b7-8f28-cee0a34e64c4/.system_generated/logs/transcript.jsonl'
output_path = 'recovered_app.js'

app_js_content = None

with open(log_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            step = json.loads(line)
            if 'tool_calls' in step:
                for call in step['tool_calls']:
                    func = call.get('function', {})
                    name = func.get('name')
                    if name in ['write_to_file', 'replace_file_content', 'multi_replace_file_content']:
                        args = func.get('arguments', '')
                        if 'app.js' in args:
                            print(f"Found app.js modified in step {step.get('step_index')} with tool {name}")
                            # For simplicity, if we see write_to_file we can just capture it, but replace_file_content might be harder to reconstruct.
                            # We can just look for the last time the file was fully written, or print the diffs.
        except Exception as e:
            pass

print("Done parsing.")
