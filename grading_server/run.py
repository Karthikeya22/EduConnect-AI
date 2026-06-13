import os
import sys
import subprocess

# Add parent directory (workspace root) and current directory to path
root_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(root_dir)
sys.path.append(parent_dir)
sys.path.append(root_dir)

# Set temporary directory to workspace tmp directory to avoid "No space left on device" on full C: drive
workspace_tmp = os.path.join(parent_dir, "tmp")
os.makedirs(workspace_tmp, exist_ok=True)
os.environ["TEMP"] = workspace_tmp
os.environ["TMP"] = workspace_tmp

print(f"Starting EduConnect AI Grading Server from: {root_dir}")
print("Checking for existing processes on port 5557...")

# Try to kill existing process on 5557 (Windows)
try:
    result = subprocess.check_output('netstat -ano | findstr :5557', shell=True).decode()
    if result:
        pids = set()
        for line in result.strip().split('\n'):
            parts = line.split()
            if len(parts) >= 5:
                pids.add(parts[-1])
        for pid in pids:
            if pid != '0':
                print(f"Killing existing process {pid} on port 5557...")
                subprocess.run(f'taskkill /F /PID {pid}', shell=True)
except Exception:
    pass

# Run the app
try:
    import grading_server.app
    print("Module grading_server found. Starting Flask...")
    env = os.environ.copy()
    env['PYTHONPATH'] = parent_dir + os.pathsep + env.get('PYTHONPATH', '')
    subprocess.run([sys.executable, "-u", "-m", "grading_server.app"], cwd=parent_dir, env=env)
except ImportError as e:
    print(f"Error: {e}")
    print("Attempting direct execution...")
    env = os.environ.copy()
    env['PYTHONPATH'] = parent_dir + os.pathsep + env.get('PYTHONPATH', '')
    subprocess.run([sys.executable, "-u", "app.py"], cwd=root_dir, env=env)

