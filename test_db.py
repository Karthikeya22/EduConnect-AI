import sqlite3
conn = sqlite3.connect(r'd:\EduConnect AI\EduConnect-AI\.code-review-graph\graph.db')
cursor = conn.cursor()
cursor.execute("SELECT name, file_path FROM nodes WHERE file_path LIKE '%GradingHub%'")
print(cursor.fetchall())
