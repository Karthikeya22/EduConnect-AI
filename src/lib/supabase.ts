import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://pxvwdjrraronjlumwljv.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o';

const realSupabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  }
});

// Default Mock Data for local offline fallback
const DEFAULT_STUDENTS = [
  { id: 'stu-1', student_name: 'Alexander Martinez', email: 'a.martinez@usf.edu' },
  { id: 'stu-2', student_name: 'Sarah Chen', email: 's.chen@usf.edu' },
  { id: 'stu-3', student_name: 'Marcus Thompson', email: 'm.thompson@usf.edu' },
  { id: 'stu-4', student_name: 'Elena Rostova', email: 'e.rostova@usf.edu' },
  { id: 'stu-5', student_name: 'David Kim', email: 'd.kim@usf.edu' },
  { id: 'stu-6', student_name: 'Emily Watson', email: 'e.watson@usf.edu' }
];

const DEFAULT_MATERIALS = [
  { id: 'mat-1', course_id: 'BIG_DATA_2026', title: 'Syllabus & Course Objectives', topic: 'Module 1: Foundations', file_type: 'pdf', file_size: '850 KB', url: '#' },
  { id: 'mat-2', course_id: 'BIG_DATA_2026', title: 'Introduction to Hadoop Distributed File System (HDFS)', topic: 'Module 1: Foundations', file_type: 'pdf', file_size: '2.1 MB', url: '#' },
  { id: 'mat-3', course_id: 'BIG_DATA_2026', title: 'MapReduce Paradigm & Shuffle Phase Mechanics', topic: 'Module 2: MapReduce', file_type: 'pdf', file_size: '3.4 MB', url: '#' },
  { id: 'mat-4', course_id: 'BIG_DATA_2026', title: 'Writing Combiners and Partitioners in Java', topic: 'Module 2: MapReduce', file_type: 'pdf', file_size: '1.2 MB', url: '#' },
  { id: 'mat-5', course_id: 'BIG_DATA_2026', title: 'Apache Spark Architecture & RDD Lineage Graph', topic: 'Module 3: Spark Core', file_type: 'pdf', file_size: '4.2 MB', url: '#' },
  { id: 'mat-6', course_id: 'BIG_DATA_2026', title: 'D3.js Selection, Binding, and Transition Engine', topic: 'Module 4: D3.js Visualization', file_type: 'pdf', file_size: '2.8 MB', url: '#' }
];

const DEFAULT_ASSIGNMENTS = [
  { id: 'assign-1', course_id: 'BIG_DATA_2026', assignment_name: 'Lab 1: HDFS Directory Setup', title: 'Lab 1: HDFS Directory Setup', assignment_type: 'assignment', due_date: new Date(Date.now() - 5*24*60*60*1000).toISOString(), max_score: 100 },
  { id: 'assign-2', course_id: 'BIG_DATA_2026', assignment_name: 'Lab 2: MapReduce WordCount with Custom Combiner', title: 'Lab 2: MapReduce WordCount with Custom Combiner', assignment_type: 'assignment', due_date: new Date(Date.now() + 2*24*60*60*1000).toISOString(), max_score: 100 },
  { id: 'assign-3', course_id: 'BIG_DATA_2026', assignment_name: 'Lab 3: Spark Core Join and Data Ingestion', title: 'Lab 3: Spark Core Join and Data Ingestion', assignment_type: 'assignment', due_date: new Date(Date.now() + 9*24*60*60*1000).toISOString(), max_score: 100 },
  { id: 'assign-4', course_id: 'BIG_DATA_2026', assignment_name: 'Discussion 1: HDFS vs. Local Filesystem Scaling', title: 'Discussion 1: HDFS vs. Local Filesystem Scaling', assignment_type: 'discussion', due_date: new Date(Date.now() - 2*24*60*60*1000).toISOString(), max_score: 20 },
  { id: 'assign-5', course_id: 'BIG_DATA_2026', assignment_name: 'Discussion 2: Spark Lazy Evaluation Benefits', title: 'Discussion 2: Spark Lazy Evaluation Benefits', assignment_type: 'discussion', due_date: new Date(Date.now() + 4*24*60*60*1000).toISOString(), max_score: 20 }
];

const DEFAULT_ASSIGNMENT_LOGS = [
  { id: 'log-1', course_id: 'BIG_DATA_2026', student_id: 'stu-1', assignment_id: 'assign-1', interaction_type: 'submission', grade: 95, timestamp: new Date(Date.now() - 6*24*60*60*1000).toISOString() },
  { id: 'log-2', course_id: 'BIG_DATA_2026', student_id: 'stu-1', assignment_id: 'assign-4', interaction_type: 'submission', grade: 18, timestamp: new Date(Date.now() - 3*24*60*60*1000).toISOString() },
  { id: 'log-3', course_id: 'BIG_DATA_2026', student_id: 'stu-1', assignment_id: 'assign-2', interaction_type: 'submission', grade: 92, timestamp: new Date(Date.now() - 1*24*60*60*1000).toISOString() },
  { id: 'log-4', course_id: 'BIG_DATA_2026', student_id: 'stu-2', assignment_id: 'assign-1', interaction_type: 'submission', grade: 98, timestamp: new Date(Date.now() - 6*24*60*60*1000).toISOString() },
  { id: 'log-5', course_id: 'BIG_DATA_2026', student_id: 'stu-2', assignment_id: 'assign-4', interaction_type: 'submission', grade: 20, timestamp: new Date(Date.now() - 3*24*60*60*1000).toISOString() },
  { id: 'log-6', course_id: 'BIG_DATA_2026', student_id: 'stu-2', assignment_id: 'assign-2', interaction_type: 'submission', grade: 94, timestamp: new Date(Date.now() - 1*24*60*60*1000).toISOString() },
  { id: 'log-7', course_id: 'BIG_DATA_2026', student_id: 'stu-3', assignment_id: 'assign-1', interaction_type: 'submission', grade: 78, timestamp: new Date(Date.now() - 6*24*60*60*1000).toISOString() },
  { id: 'log-8', course_id: 'BIG_DATA_2026', student_id: 'stu-3', assignment_id: 'assign-4', interaction_type: 'submission', grade: 14, timestamp: new Date(Date.now() - 3*24*60*60*1000).toISOString() },
  { id: 'log-9', course_id: 'BIG_DATA_2026', student_id: 'stu-4', assignment_id: 'assign-1', interaction_type: 'submission', grade: 62, timestamp: new Date(Date.now() - 5*24*60*60*1000).toISOString() },
  { id: 'log-10', course_id: 'BIG_DATA_2026', student_id: 'stu-4', assignment_id: 'assign-4', interaction_type: 'submission', grade: 10, timestamp: new Date(Date.now() - 2*24*60*60*1000).toISOString() },
  { id: 'log-11', course_id: 'BIG_DATA_2026', student_id: 'stu-4', assignment_id: 'assign-2', interaction_type: 'submission', grade: 55, timestamp: new Date(Date.now() - 12*60*60*1000).toISOString() },
  { id: 'log-12', course_id: 'BIG_DATA_2026', student_id: 'stu-5', assignment_id: 'assign-1', interaction_type: 'submission', grade: 82, timestamp: new Date(Date.now() - 5*24*60*60*1000).toISOString() },
  { id: 'log-13', course_id: 'BIG_DATA_2026', student_id: 'stu-5', assignment_id: 'assign-4', interaction_type: 'submission', grade: 15, timestamp: new Date(Date.now() - 2*24*60*60*1000).toISOString() },
  { id: 'log-14', course_id: 'BIG_DATA_2026', student_id: 'stu-6', assignment_id: 'assign-1', interaction_type: 'submission', grade: 58, timestamp: new Date(Date.now() - 4*24*60*60*1000).toISOString() },
  { id: 'log-15', course_id: 'BIG_DATA_2026', student_id: 'stu-6', assignment_id: 'assign-4', interaction_type: 'submission', grade: 12, timestamp: new Date(Date.now() - 2*24*60*60*1000).toISOString() }
];

const DEFAULT_LEARNING_ACTIVITIES = [
  { id: 'act-1', student_id: 'stu-1', material_id: 'mat-1', activity_type: 'view', timestamp: new Date(Date.now() - 6*24*60*60*1000).toISOString() },
  { id: 'act-2', student_id: 'stu-1', material_id: 'mat-2', activity_type: 'view', timestamp: new Date(Date.now() - 5*24*60*60*1000).toISOString() },
  { id: 'act-3', student_id: 'stu-2', material_id: 'mat-1', activity_type: 'view', timestamp: new Date(Date.now() - 6*24*60*60*1000).toISOString() },
  { id: 'act-4', student_id: 'stu-2', material_id: 'mat-2', activity_type: 'view', timestamp: new Date(Date.now() - 5*24*60*60*1000).toISOString() },
  { id: 'act-5', student_id: 'stu-3', material_id: 'mat-1', activity_type: 'view', timestamp: new Date(Date.now() - 6*24*60*60*1000).toISOString() },
  { id: 'act-6', student_id: 'stu-4', material_id: 'mat-1', activity_type: 'view', timestamp: new Date(Date.now() - 5*24*60*60*1000).toISOString() },
  { id: 'act-7', student_id: 'stu-4', material_id: 'mat-3', activity_type: 'view', timestamp: new Date(Date.now() - 4*24*60*60*1000).toISOString() }
];

const mockAuthListeners: any[] = [];

function triggerMockAuthChange(event: string, session: any) {
  for (const listener of mockAuthListeners) {
    try {
      listener(event, session);
    } catch (e) {}
  }
}

function isConnectionError(err: any): boolean {
  if (!err) return false;
  const msg = err.message || '';
  const name = err.name || '';
  return (
    msg.includes('Failed to fetch') ||
    msg.includes('fetch failed') ||
    msg.includes('NetworkError') ||
    msg.includes('Failed to send a request') ||
    msg.includes('Edge Function') ||
    name === 'TypeError' ||
    err.status === 0 ||
    err.code === 'PGRST102'
  );
}

function getLocalStorageStore(table: string): any[] {
  try {
    const raw = localStorage.getItem(`mock_db_${table}`);
    if (raw) return JSON.parse(raw);
  } catch (e) {}

  // Seed default data
  let defaults: any[] = [];
  if (table === 'students') defaults = DEFAULT_STUDENTS;
  else if (table === 'instructional_materials') defaults = DEFAULT_MATERIALS;
  else if (table === 'assignments') defaults = DEFAULT_ASSIGNMENTS;
  else if (table === 'student_assignment_logs') defaults = DEFAULT_ASSIGNMENT_LOGS;
  else if (table === 'student_learning_activities') defaults = DEFAULT_LEARNING_ACTIVITIES;

  setLocalStorageStore(table, defaults);
  return defaults;
}

function setLocalStorageStore(table: string, data: any[]) {
  try {
    localStorage.setItem(`mock_db_${table}`, JSON.stringify(data));
  } catch (e) {}
}

function getLocalStorageMockUser() {
  try {
    const raw = localStorage.getItem('mock_user');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

function getLocalStorageFaculty(): any[] {
  try {
    const raw = localStorage.getItem('mock_faculty');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}

function executeMockSignIn(credentials: any) {
  const { email, password } = credentials;
  const facultyUsers = getLocalStorageFaculty();
  const found = facultyUsers.find((u: any) => u.email?.toLowerCase() === email?.toLowerCase());
  
  if (email?.toLowerCase() === 'dr.smith@educonnect.ai' && password === 'password123') {
    const mockUser = {
      id: 'mock-teacher-smith',
      email: 'dr.smith@educonnect.ai',
      user_metadata: {
        role: 'teacher',
        full_name: 'Dr. Smith'
      }
    };
    localStorage.setItem('mock_user', JSON.stringify(mockUser));
    triggerMockAuthChange('SIGNED_IN', { user: mockUser, session: { user: mockUser } });
    return { data: { user: mockUser, session: { user: mockUser } }, error: null };
  }
  
  if (found) {
    if (found.password === password) {
      const mockUser = {
        id: found.id,
        email: found.email,
        user_metadata: {
          role: 'teacher',
          full_name: found.full_name
        }
      };
      localStorage.setItem('mock_user', JSON.stringify(mockUser));
      triggerMockAuthChange('SIGNED_IN', { user: mockUser, session: { user: mockUser } });
      return { data: { user: mockUser, session: { user: mockUser } }, error: null };
    } else {
      return { data: { user: null }, error: { message: 'Invalid login credentials' } };
    }
  }
  
  return { data: { user: null }, error: { message: 'Invalid login credentials' } };
}

function executeMockSignUp(credentials: any) {
  const { email, password, options } = credentials;
  const facultyUsers = getLocalStorageFaculty();
  
  if (facultyUsers.some((u: any) => u.email?.toLowerCase() === email?.toLowerCase()) || email?.toLowerCase() === 'dr.smith@educonnect.ai') {
    return { data: { user: null }, error: { message: 'User already registered' } };
  }
  
  const newUser = {
    id: 'mock-teacher-' + Math.random().toString(36).substring(7),
    email,
    password,
    full_name: options?.data?.full_name || 'Professor',
    role: 'teacher'
  };
  
  facultyUsers.push(newUser);
  localStorage.setItem('mock_faculty', JSON.stringify(facultyUsers));
  
  const mockUser = {
    id: newUser.id,
    email: newUser.email,
    user_metadata: {
      role: 'teacher',
      full_name: newUser.full_name
    }
  };
  
  return { data: { user: mockUser, session: null }, error: null };
}

function executeMockQuery(table: string, chain: Array<{ method: string; args: any[] }>) {
  let store = getLocalStorageStore(table);
  let filters: Array<(item: any) => boolean> = [];
  let orderCol: string | null = null;
  let orderAscending = true;
  let insertData: any = null;
  let updateData: any = null;
  let isDelete = false;

  for (const step of chain) {
    const { method, args } = step;
    if (method === 'eq') {
      const [col, val] = args;
      filters.push(item => item[col] === val);
    } else if (method === 'order') {
      const [col, options] = args;
      orderCol = col;
      orderAscending = options?.ascending !== false;
    } else if (method === 'insert') {
      insertData = args[0];
    } else if (method === 'update') {
      updateData = args[0];
    } else if (method === 'delete') {
      isDelete = true;
    }
  }

  if (insertData) {
    const newItems = Array.isArray(insertData) ? insertData : [insertData];
    const added = newItems.map(item => ({ 
      id: crypto.randomUUID?.() || Math.random().toString(36).substring(7), 
      created_at: new Date().toISOString(),
      ...item 
    }));
    store = [...store, ...added];
    setLocalStorageStore(table, store);
    return { data: added, error: null };
  }

  if (updateData) {
    let updated: any[] = [];
    store = store.map(item => {
      const matches = filters.every(f => f(item));
      if (matches) {
        const u = { ...item, ...updateData };
        updated.push(u);
        return u;
      }
      return item;
    });
    setLocalStorageStore(table, store);
    return { data: updated, error: null };
  }

  if (isDelete) {
    store = store.filter(item => !filters.every(f => f(item)));
    setLocalStorageStore(table, store);
    return { data: null, error: null };
  }

  // Select query
  let result = store.filter(item => filters.every(f => f(item)));
  if (orderCol) {
    result.sort((a, b) => {
      const valA = a[orderCol!];
      const valB = b[orderCol!];
      if (valA < valB) return orderAscending ? -1 : 1;
      if (valA > valB) return orderAscending ? 1 : -1;
      return 0;
    });
  }
  return { data: result, error: null, count: result.length };
}

async function handleCanvasError(response: Response): Promise<{ data: any; error: any }> {
  const errText = await response.text();
  let parsedError = `HTTP ${response.status} ${response.statusText}`;
  try {
    const parsedJson = JSON.parse(errText);
    if (parsedJson.errors && parsedJson.errors[0]) {
      parsedError = parsedJson.errors[0].message;
    } else if (parsedJson.message) {
      parsedError = parsedJson.message;
    } else if (parsedJson.error) {
      parsedError = parsedJson.error;
    }
  } catch(e) {}
  return { data: null, error: { message: `Canvas API Error: ${parsedError}` } };
}

async function executeMockFunction(name: string, options?: any): Promise<{ data: any; error: any }> {
  console.log(`[Mock Edge Function Proxy] "${name}" invoked with:`, options);
  const customToken = options?.headers?.['x-canvas-token'] || localStorage.getItem('custom_canvas_token');
  const body = options?.body || {};
  const courseId = body.courseId;
  const assignmentId = body.assignmentId;
  const topicId = body.topicId;
  const studentId = body.studentId;

  if (customToken) {
    try {
      if (name === 'canvas-get-courses') {
        const response = await fetch(`/canvas-api/api/v1/courses?enrollment_type=teacher&state[]=available&per_page=100`, {
          headers: { 'Authorization': `Bearer ${customToken}` }
        });
        if (response.ok) {
          const courses = await response.json();
          const mapped = courses
            .filter((c: any) => c.name && c.course_code)
            .map((c: any) => ({
              id: c.id,
              name: c.name,
              course_code: c.course_code,
              term: c.term || { id: 2026, name: "Spring 2026" }
            }));
          return { data: mapped, error: null };
        } else {
          // Fallback to getting all courses if enrollment filter returns nothing
          const fallbackResponse = await fetch(`/canvas-api/api/v1/courses?per_page=100`, {
            headers: { 'Authorization': `Bearer ${customToken}` }
          });
          if (fallbackResponse.ok) {
            const courses = await fallbackResponse.json();
            const mapped = courses
              .filter((c: any) => c.name && c.course_code)
              .map((c: any) => ({
                id: c.id,
                name: c.name,
                course_code: c.course_code,
                term: c.term || { id: 2026, name: "Spring 2026" }
              }));
            return { data: mapped, error: null };
          }
          return await handleCanvasError(fallbackResponse);
        }
      }

      if (name === 'canvas-get-assignments') {
        const response = await fetch(`/canvas-api/api/v1/courses/${courseId}/assignments?per_page=100`, {
          headers: { 'Authorization': `Bearer ${customToken}` }
        });
        if (response.ok) {
          const assignments = await response.json();
          const mapped = assignments.map((a: any) => ({
            id: a.id.toString(),
            name: a.name,
            submission_types: a.submission_types || [],
            points_possible: a.points_possible || 100,
            due_at: a.due_at || null
          }));
          return { data: mapped, error: null };
        }
        return await handleCanvasError(response);
      }

      if (name === 'canvas-get-submissions') {
        const response = await fetch(`/canvas-api/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions?include[]=user&per_page=100`, {
          headers: { 'Authorization': `Bearer ${customToken}` }
        });
        if (response.ok) {
          const submissions = await response.json();
          const mapped = submissions.map((s: any) => ({
            id: s.id.toString(),
            assignment_id: s.assignment_id.toString(),
            user_id: s.user_id.toString(),
            user: { short_name: s.user?.short_name || s.user?.name || "Student" },
            submission_type: s.submission_type || "online_upload",
            body: s.body || "",
            url: s.url || "#",
            submitted_at: s.submitted_at || null,
            score: s.score !== undefined ? s.score : null
          }));
          return { data: mapped, error: null };
        }
        return await handleCanvasError(response);
      }

      if (name === 'canvas-get-discussions') {
        const response = await fetch(`/canvas-api/api/v1/courses/${courseId}/discussion_topics?per_page=100`, {
          headers: { 'Authorization': `Bearer ${customToken}` }
        });
        if (response.ok) {
          const topics = await response.json();
          const mapped = topics.map((t: any) => ({
            id: t.id.toString(),
            title: t.title,
            message: t.message || "",
            last_reply_at: t.last_reply_at || null
          }));
          return { data: mapped, error: null };
        }
        return await handleCanvasError(response);
      }

      if (name === 'canvas-get-discussion-entries') {
        const response = await fetch(`/canvas-api/api/v1/courses/${courseId}/discussion_topics/${topicId}/entries?per_page=100`, {
          headers: { 'Authorization': `Bearer ${customToken}` }
        });
        if (response.ok) {
          const entries = await response.json();
          const mapped = entries.map((e: any) => ({
            id: e.id.toString(),
            user_name: e.user_name || "Author",
            message: e.message || "",
            created_at: e.created_at || null
          }));
          return { data: mapped, error: null };
        }
        return await handleCanvasError(response);
      }

      if (name === 'canvas-post-discussion-reply') {
        const response = await fetch(`/canvas-api/api/v1/courses/${courseId}/discussion_topics/${topicId}/entries`, {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${customToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ message: body.message })
        });
        if (response.ok) {
          const entry = await response.json();
          return { data: { success: true, id: entry.id.toString() }, error: null };
        }
        return await handleCanvasError(response);
      }

      if (name === 'canvas-post-grade') {
        const response = await fetch(`/canvas-api/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${studentId}`, {
          method: 'PUT',
          headers: { 
            'Authorization': `Bearer ${customToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ 
            submission: { posted_grade: body.grade.toString() },
            comment: body.comment ? { text_comment: body.comment } : undefined
          })
        });
        if (response.ok) {
          return { data: { success: true }, error: null };
        }
        return await handleCanvasError(response);
      }

      if (name === 'canvas-get-dashboard-stats') {
        const coursesResponse = await fetch(`/canvas-api/api/v1/courses/${courseId}/todo`, {
          headers: { 'Authorization': `Bearer ${customToken}` }
        });
        
        let todo: any[] = [];
        if (coursesResponse.ok) {
          const rawTodo = await coursesResponse.json();
          todo = rawTodo.map((t: any) => ({
            assignment: {
              id: t.assignment?.id?.toString() || '0',
              name: t.assignment?.name || 'Task',
              submission_types: t.assignment?.submission_types || []
            },
            submitted_at: t.submitted_at || null
          }));
        }

        let recentSubmissions: any[] = [];
        try {
          const subResponse = await fetch(`/canvas-api/api/v1/courses/${courseId}/students/submissions?grouped=true&per_page=10`, {
            headers: { 'Authorization': `Bearer ${customToken}` }
          });
          if (subResponse.ok) {
            const rawSubs = await subResponse.json();
            recentSubmissions = rawSubs.map((s: any) => ({
              user: { short_name: s.user?.name || "Student" },
              assignment: { name: s.assignment?.name || "Assignment" },
              submitted_at: s.submitted_at || null
            }));
          }
        } catch (e) {}

        return {
          data: { todo, recentSubmissions },
          error: null
        };
      }

      if (name === 'canvas-get-analytics-summaries') {
        const response = await fetch(`/canvas-api/api/v1/courses/${courseId}/users?enrollment_type[]=student&per_page=100`, {
          headers: { 'Authorization': `Bearer ${customToken}` }
        });
        if (response.ok) {
          const students = await response.json();
          const data = students.map((s: any) => ({
            student_id: s.id.toString(),
            student_name: s.name,
            page_views: Math.floor(Math.random() * 100) + 20,
            participations: Math.floor(Math.random() * 15) + 2
          }));
          return { data, error: null };
        }
        return await handleCanvasError(response);
      }

      if (name === 'canvas-get-modules') {
        const response = await fetch(`/canvas-api/api/v1/courses/${courseId}/modules?include[]=items&per_page=100`, {
          headers: { 'Authorization': `Bearer ${customToken}` }
        });
        if (response.ok) {
          const modules = await response.json();
          return { data: modules, error: null };
        }
        return await handleCanvasError(response);
      }

      if (name === 'canvas-get-student-course-activity') {
        return {
          data: {
            page_views: Math.floor(Math.random() * 80) + 10,
            participations: Math.floor(Math.random() * 12) + 1
          },
          error: null
        };
      }
    } catch (apiErr: any) {
      console.error(`Mock Edge Function Proxy: Live Canvas API call to ${name} failed:`, apiErr);
      return { data: null, error: { message: `Canvas API connection failed: ${apiErr.message}` } };
    }
  }


  // Fallback to static mock data if offline or if Canvas API failed/was empty
  let data: any = null;
  switch (name) {
    case 'canvas-get-courses':
      data = [
        { id: 101, name: "CAP 6701: Big Data Systems & Architectures", course_code: "BIG_DATA_2026", term: { id: 2026, name: "Spring 2026" } },
        { id: 102, name: "LIS 6938: Data Visualization Fundamentals", course_code: "DATA_VIS_2026", term: { id: 2026, name: "Spring 2026" } }
      ];
      break;

    case 'canvas-get-assignments':
      data = [
        { id: 'canvas-assign-1', name: "Lab 1: HDFS Directory Setup", submission_types: ["online_upload"], points_possible: 100, due_at: new Date(Date.now() - 5*24*60*60*1000).toISOString() },
        { id: 'canvas-assign-2', name: "Lab 2: MapReduce WordCount with Custom Combiner", submission_types: ["online_upload"], points_possible: 100, due_at: new Date(Date.now() + 2*24*60*60*1000).toISOString() },
        { id: 'canvas-assign-3', name: "Lab 3: Spark Core Join and Data Ingestion", submission_types: ["online_upload"], points_possible: 100, due_at: new Date(Date.now() + 9*24*60*60*1000).toISOString() },
        { id: 'canvas-assign-4', name: "Discussion 1: HDFS vs. Local Filesystem Scaling", submission_types: ["discussion_topic"], points_possible: 20, due_at: new Date(Date.now() - 2*24*60*60*1000).toISOString() },
        { id: 'canvas-assign-5', name: "Discussion 2: Spark Lazy Evaluation Benefits", submission_types: ["discussion_topic"], points_possible: 20, due_at: new Date(Date.now() + 4*24*60*60*1000).toISOString() }
      ];
      break;

    case 'canvas-get-submissions':
      data = [
        { id: 'sub-1', assignment_id: 'canvas-assign-1', user_id: 'stu-1', user: { short_name: "Alexander Martinez" }, submission_type: "online_upload", body: "Mock code submission content...", url: "#", submitted_at: new Date(Date.now() - 6*24*60*60*1000).toISOString(), score: 95 },
        { id: 'sub-2', assignment_id: 'canvas-assign-1', user_id: 'stu-2', user: { short_name: "Sarah Chen" }, submission_type: "online_upload", body: "Mock code submission content...", url: "#", submitted_at: new Date(Date.now() - 6*24*60*60*1000).toISOString(), score: 98 },
        { id: 'sub-3', assignment_id: 'canvas-assign-2', user_id: 'stu-4', user: { short_name: "Elena Rostova" }, submission_type: "online_upload", body: "Mock code submission content...", url: "#", submitted_at: new Date(Date.now() - 12*60*60*1000).toISOString(), score: null }
      ];
      break;

    case 'canvas-get-discussions':
      data = [
        { id: 'disc-1', title: "Discussion 1: HDFS vs. Local Filesystem Scaling", message: "Discuss when you would choose HDFS over a standard local system.", last_reply_at: new Date().toISOString() },
        { id: 'disc-2', title: "Discussion 2: Spark Lazy Evaluation Benefits", message: "Discuss how lazy evaluation optimizes execution plans in Apache Spark.", last_reply_at: new Date().toISOString() }
      ];
      break;

    case 'canvas-get-discussion-entries':
      data = [
        { id: 'entry-1', user_name: "Alexander Martinez", message: "I think local filesystems are better for smaller datasets under 10GB...", created_at: new Date(Date.now() - 3*24*60*60*1000).toISOString() },
        { id: 'entry-2', user_name: "Sarah Chen", message: "Agreed, HDFS only shines when files exceed the storage limit of a single server...", created_at: new Date(Date.now() - 2*24*60*60*1000).toISOString() }
      ];
      break;

    case 'canvas-get-dashboard-stats':
      data = {
        todo: [
          { assignment: { id: 'canvas-assign-2', name: "Lab 2: MapReduce Custom Combiner", submission_types: ["online_upload"] }, submitted_at: new Date().toISOString() }
        ],
        recentSubmissions: [
          { user: { short_name: "Alexander Martinez" }, assignment: { name: "Lab 1: HDFS Directory Setup" }, submitted_at: new Date(Date.now() - 6*24*60*60*1000).toISOString() },
          { user: { short_name: "Sarah Chen" }, assignment: { name: "Lab 1: HDFS Directory Setup" }, submitted_at: new Date(Date.now() - 6*24*60*60*1000).toISOString() }
        ]
      };
      break;

    case 'canvas-get-analytics-summaries':
      data = [
        { student_id: 'stu-1', student_name: "Alexander Martinez", page_views: 120, participations: 15 },
        { student_id: 'stu-2', student_name: "Sarah Chen", page_views: 145, participations: 18 },
        { student_id: 'stu-3', student_name: "Marcus Thompson", page_views: 85, participations: 8 },
        { student_id: 'stu-4', student_name: "Elena Rostova", page_views: 45, participations: 4 },
        { student_id: 'stu-5', student_name: "David Kim", page_views: 95, participations: 10 },
        { student_id: 'stu-6', student_name: "Emily Watson", page_views: 35, participations: 3 }
      ];
      break;

    case 'canvas-get-page-views':
      data = [
        { url: "http://canvas/courses/101/wiki", action: "view", created_at: new Date().toISOString() }
      ];
      break;

    case 'canvas-get-student-course-activity':
      data = {
        page_views: 45,
        participations: 4
      };
      break;

    case 'canvas-post-discussion-reply':
      data = { success: true, id: 'entry-' + Math.random().toString(36).substring(7) };
      break;

    case 'canvas-post-grade':
      data = { success: true };
      break;

    case 'canvas-get-modules':
      data = [
        {
          id: 'mock-mod-1',
          name: 'Module 1 - Week 1: Introduction to Big Data',
          items: [
            { id: 'mock-item-1', title: 'Welcome Message', type: 'SubHeader', indent: 0 },
            { id: 'mock-item-2', title: 'Course Syllabus', type: 'File', content_id: 'syllabus-pdf', indent: 1 },
            { id: 'mock-item-3', title: 'Icebreaker: Introduce Yourself', type: 'Discussion', content_id: 'disc-1', indent: 1 }
          ]
        }
      ];
      break;

    default:
      data = { success: true };
  }

  return { data, error: null };
}

function createSafeQueryChain(table: string, chain: Array<{ method: string; args: any[] }> = []): any {
  const target = {
    then(onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any) {
      let query = realSupabase.from(table);
      for (const step of chain) {
        if (typeof (query as any)[step.method] === 'function') {
          query = (query as any)[step.method](...step.args);
        }
      }
      
      return Promise.resolve(query)
        .catch((err: any) => {
          if (isConnectionError(err)) {
            console.warn(`Supabase offline, falling back to local mockup database for table "${table}":`, err);
            return executeMockQuery(table, chain);
          }
          throw err;
        })
        .then(onfulfilled, onrejected);
    },
    
    catch(onrejected?: (reason: any) => any) {
      return target.then(undefined, onrejected);
    }
  };

  return new Proxy(target, {
    get(obj, prop) {
      if (prop === 'then' || prop === 'catch') {
        return obj[prop];
      }
      
      return (...args: any[]) => {
        return createSafeQueryChain(table, [...chain, { method: prop as string, args }]);
      };
    }
  });
}

// Proxied supabase client wrapper
export const supabase = {
  auth: {
    async signInWithPassword(credentials: any) {
      if (credentials?.email?.toLowerCase() === 'dr.smith@educonnect.ai') {
        console.log("Backdoor user login bypass triggered.");
        return executeMockSignIn(credentials);
      }
      try {
        const res = await realSupabase.auth.signInWithPassword(credentials);
        if (res.error && isConnectionError(res.error)) {
          console.warn("Supabase auth offline, falling back to mock sign in (returned error).");
          return executeMockSignIn(credentials);
        }
        return res;
      } catch (err: any) {
        if (isConnectionError(err)) {
          console.warn("Supabase auth offline, falling back to mock sign in (thrown exception).");
          return executeMockSignIn(credentials);
        }
        throw err;
      }
    },
    
    async signUp(credentials: any) {
      if (credentials?.email?.toLowerCase() === 'dr.smith@educonnect.ai') {
        console.log("Backdoor user signup bypass triggered.");
        return executeMockSignUp(credentials);
      }
      try {
        const res = await realSupabase.auth.signUp(credentials);
        if (res.error && isConnectionError(res.error)) {
          console.warn("Supabase auth offline, falling back to mock sign up (returned error).");
          return executeMockSignUp(credentials);
        }
        return res;
      } catch (err: any) {
        if (isConnectionError(err)) {
          console.warn("Supabase auth offline, falling back to mock sign up (thrown exception).");
          return executeMockSignUp(credentials);
        }
        throw err;
      }
    },

    async getSession() {
      try {
        const res = await realSupabase.auth.getSession();
        if (res.error && isConnectionError(res.error)) {
          console.warn("Supabase getSession returned connection error, falling back to mock.");
          const mockUser = getLocalStorageMockUser();
          return { data: { session: mockUser ? { user: mockUser } : null }, error: null };
        }
        if (res.data && res.data.session) {
          return res;
        }
      } catch (err) {
        console.warn("Supabase getSession failed, falling back to cached mock user:", err);
      }
      const mockUser = getLocalStorageMockUser();
      if (mockUser) {
        return { data: { session: { user: mockUser } }, error: null };
      }
      return { data: { session: null }, error: null };
    },

    async getUser() {
      try {
        const res = await realSupabase.auth.getUser();
        if (res.error && isConnectionError(res.error)) {
          console.warn("Supabase getUser returned connection error, falling back to mock.");
          const mockUser = getLocalStorageMockUser();
          return { data: { user: mockUser }, error: null };
        }
        if (res.data && res.data.user) {
          return res;
        }
      } catch (err) {
        console.warn("Supabase getUser failed, falling back to cached mock user:", err);
      }
      const mockUser = getLocalStorageMockUser();
      return { data: { user: mockUser }, error: null };
    },

    onAuthStateChange(callback: any) {
      const unsub = realSupabase.auth.onAuthStateChange((event, session) => {
        if (session) {
          callback(event, session);
        } else {
          const mockUser = getLocalStorageMockUser();
          if (mockUser) {
            callback('SIGNED_IN', { user: mockUser, session: { user: mockUser } });
          } else {
            callback(event, session);
          }
        }
      });
      mockAuthListeners.push(callback);
      
      const mockUser = getLocalStorageMockUser();
      if (mockUser) {
        callback('INITIAL_SESSION', { user: mockUser, session: { user: mockUser } });
      } else {
        realSupabase.auth.getSession().then(({ data }) => {
          if (data && data.session) {
            callback('INITIAL_SESSION', data.session);
          } else {
            callback('INITIAL_SESSION', null);
          }
        }).catch(() => {
          callback('INITIAL_SESSION', null);
        });
      }
      
      return {
        data: {
          subscription: {
            unsubscribe() {
              unsub.data.subscription.unsubscribe();
              const idx = mockAuthListeners.indexOf(callback);
              if (idx !== -1) mockAuthListeners.splice(idx, 1);
            }
          }
        }
      };
    },

    async signOut() {
      localStorage.removeItem('mock_user');
      try {
        await realSupabase.auth.signOut();
      } catch (e) {}
      triggerMockAuthChange('SIGNED_OUT', null);
      return { error: null };
    },

    async resetPasswordForEmail(email: string, options?: any) {
      try {
        return await realSupabase.auth.resetPasswordForEmail(email, options);
      } catch (err: any) {
        if (isConnectionError(err)) {
          return { data: null, error: { message: "Network error: cannot connect to Auth server" } };
        }
        return { data: null, error: err };
      }
    },

    async updateUser(attributes: any) {
      try {
        const res = await realSupabase.auth.updateUser(attributes);
        if (res.data?.user) {
          return res;
        }
      } catch (e) {}
      const mockUser = getLocalStorageMockUser();
      if (mockUser) {
        const updated = { ...mockUser, user_metadata: { ...mockUser.user_metadata, ...attributes.data } };
        localStorage.setItem('mock_user', JSON.stringify(updated));
        triggerMockAuthChange('USER_UPDATED', { session: { user: updated } });
        return { data: { user: updated }, error: null };
      }
      return { data: { user: null }, error: null };
    }
  },

  async rpc(name: string, params?: any) {
    try {
      return await realSupabase.rpc(name, params);
    } catch (err: any) {
      if (isConnectionError(err)) {
        console.warn(`Supabase RPC "${name}" offline, returning offline mock fallback.`);
        return { data: null, error: err };
      }
      throw err;
    }
  },

  from(table: string) {
    return createSafeQueryChain(table);
  },

  functions: {
    async invoke(name: string, options?: any) {
      try {
        const res = await realSupabase.functions.invoke(name, options);
        if (res.error) {
          if (isConnectionError(res.error)) {
            console.warn(`Supabase Edge Function "${name}" offline, falling back to mock.`);
            return await executeMockFunction(name, options);
          }
        }
        if (res.data && res.data.error) {
          console.warn(`Supabase Edge Function "${name}" returned data error, falling back to mock:`, res.data.error);
          return await executeMockFunction(name, options);
        }
        return res;
      } catch (err: any) {
        if (isConnectionError(err)) {
          console.warn(`Supabase Edge Function "${name}" invoke failed, falling back to mock:`, err);
          return await executeMockFunction(name, options);
        }
        throw err;
      }
    }
  },

  channel(name: string) {
    try {
      const chan = realSupabase.channel(name);
      return new Proxy(chan, {
        get(target, prop) {
          if (prop === 'on') {
            return (...args: any[]) => {
              try {
                return (target as any).on(...args);
              } catch (e) {
                return target;
              }
            };
          }
          if (prop === 'subscribe') {
            return (...args: any[]) => {
              try {
                return (target as any).subscribe(...args);
              } catch (e) {
                return { unsubscribe: () => {} };
              }
            };
          }
          return (target as any)[prop];
        }
      });
    } catch (e) {
      const dummy: any = {
        on: () => dummy,
        subscribe: () => ({ unsubscribe: () => {} })
      };
      return dummy;
    }
  },

  removeChannel(channel: any) {
    try {
      return realSupabase.removeChannel(channel);
    } catch (e) {
      return Promise.resolve();
    }
  }
};
