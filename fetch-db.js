const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;

async function check() {
    const res = await fetch(`${url}/rest/v1/student_assignment_logs?select=*,assignments(*)`, {
        headers: {
            'apikey': key,
            'Authorization': `Bearer ${key}`
        }
    });
    const data = await res.json();
    console.log("Total logs:", data.length);
    if (data.length > 0) {
        console.log("First log:", JSON.stringify(data[0], null, 2));
    }
}
check();
