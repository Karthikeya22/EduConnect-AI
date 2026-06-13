import sys
from html.parser import HTMLParser

class JSXParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []
        self.line_offset = 0

    def handle_starttag(self, tag, attrs):
        if tag[0].islower():  # Basic heuristic for standard tags vs Components
            self.stack.append((tag, self.getpos()[0] + self.line_offset))

    def handle_endtag(self, tag):
        if tag[0].islower():
            if self.stack and self.stack[-1][0] == tag:
                self.stack.pop()
            else:
                print(f"Mismatched closing tag </{tag}> at line {self.getpos()[0] + self.line_offset}")

with open('pages/GradingHub.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Very naive stripping to avoid braces {} interfering with HTML parser too much
def clean_jsx(code):
    out = ""
    for line in code:
        # Avoid JSX expressions ruining tags
        out += line
    return out

# we will just do a pure counter of <div> vs </div>
div_count = 0
for i, line in enumerate(lines):
    # This is a naive heuristic!
    line_clean = line.split('//')[0] # remove line comments
    open_divs = line_clean.count('<div')
    close_divs = line_clean.count('</div')
    div_count += (open_divs - close_divs)
    if div_count < 0:
         print(f"Negative div count at {i+1}: {line.strip()}")
         break

print("Final div count:", div_count)
