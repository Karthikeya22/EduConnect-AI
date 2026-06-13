const token = '13~TcnHE4GaQCYUKQMUV3mXeeh6rYQtXJQ9Nf4HEVNcWfYvCVCmmBuPu7vQX2GKAWXv';

async function run() {
  console.log("Fetching courses from Canvas...");
  const resCourses = await fetch('https://usflearn.instructure.com/api/v1/courses?per_page=100', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const courses = await resCourses.json();
  if (resCourses.ok) {
    console.log("Courses found:", courses.map(c => ({ id: c.id, name: c.name, code: c.course_code })));
    
    // Find course matching EME6035
    const course = courses.find(c => c.name?.includes('EME6035') || c.course_code?.includes('EME6035'));
    if (course) {
      console.log(`\nUsing course: ${course.name} (ID: ${course.id})`);
      
      // Fetch assignments
      console.log("Fetching assignments...");
      const resAss = await fetch(`https://usflearn.instructure.com/api/v1/courses/${course.id}/assignments?per_page=100`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const assignments = await resAss.json();
      console.log("Assignments found:", assignments.map(a => ({ id: a.id, name: a.name })));
      
      // Fetch submissions for the first assignment
      const assignment = assignments[0];
      if (assignment) {
        console.log(`\nFetching submissions for assignment: ${assignment.name} (ID: ${assignment.id})`);
        const resSubs = await fetch(`https://usflearn.instructure.com/api/v1/courses/${course.id}/assignments/${assignment.id}/submissions?include[]=user&per_page=100`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const subs = await resSubs.json();
        console.log(`Submissions count: ${subs.length}`);
        if (subs.length > 0) {
          console.log("First submission user:", subs[0].user);
        }
      }
    }
  } else {
    console.error("Failed to fetch courses:", courses);
  }
}

run();
