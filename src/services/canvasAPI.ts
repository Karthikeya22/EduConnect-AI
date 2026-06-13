import { supabase } from '@/src/lib/supabase';

export const canvasAPI = {
    getCustomHeaders() {
        const customToken = localStorage.getItem('custom_canvas_token');
        if (customToken) {
             return { 'x-canvas-token': customToken };
        }
        return {};
    },

    async syncTokenWithBackend(email: string, token: string, expiry: string, geminiKey?: string) {
        try {
            const payload: any = {
                teacher_email: email, 
                canvas_token: token, 
                canvas_token_expiry: expiry 
            };
            if (geminiKey !== undefined) {
                payload.gemini_api_key = geminiKey;
            }
            
            const { error } = await supabase
                .from('teacher_preferences')
                .upsert(payload, { onConflict: 'teacher_email' });
            
            if (error) throw error;
            return true;
        } catch (e) {
            console.error("Failed to sync Canvas token with backend:", e);
            throw e;
        }
    },

    async fetchTokenFromBackend(email: string) {
        try {
            const { data, error } = await supabase
                .from('teacher_preferences')
                .select('canvas_token, canvas_token_expiry, gemini_api_key')
                .eq('teacher_email', email)
                .single();
            
            if (error && error.code !== 'PGRST116') throw error; // PGRST116 is "not found"
            return data;
        } catch (e) {
            console.error("Failed to fetch Canvas token from backend:", e);
            return null;
        }
    },

    async getCourses() {
        try {
            const { data, error } = await supabase.functions.invoke('canvas-get-courses', {
                headers: this.getCustomHeaders()
            });
            if (error) {
                const msg = data?.error || error.message || "Failed to fetch courses";
                console.error("Canvas API getCourses Error:", msg, { data, error });
                throw new Error(msg);
            }
            if (!data) throw new Error("No data returned from getCourses");
            if (data?.error) throw new Error(data.error);
            return data;
        } catch (e: any) {
            console.error("canvasAPI.getCourses critical failure:", e);
            throw e;
        }
    },

    async getAssignments(courseId: string) {
        try {
            const { data, error } = await supabase.functions.invoke('canvas-get-assignments', {
                body: { courseId },
                headers: this.getCustomHeaders()
            });
            if (error) {
                const msg = data?.error || error.message || "Failed to fetch assignments";
                console.error("Canvas API getAssignments Error:", msg, { data, error });
                throw new Error(msg);
            }
            if (!data) throw new Error("No data returned from getAssignments");
            if (data?.error) throw new Error(data.error);
            return data;
        } catch (e: any) {
            console.error("canvasAPI.getAssignments critical failure:", e);
            throw e;
        }
    },

    async getSubmissions(courseId: string, assignmentId?: string) {
        try {
            const { data, error } = await supabase.functions.invoke('canvas-get-submissions', {
                body: { courseId, assignmentId },
                headers: this.getCustomHeaders()
            });
            if (error) {
                const msg = data?.error || error.message || "Failed to fetch submissions";
                console.error("Canvas API getSubmissions Error:", msg, { data, error });
                throw new Error(msg);
            }
            if (!data) throw new Error("No data returned from getSubmissions");
            if (data?.error) throw new Error(data.error);
            return data;
        } catch (e: any) {
            console.error("canvasAPI.getSubmissions critical failure:", e);
            throw e;
        }
    },

    async getDiscussionTopics(courseId: string) {
        try {
            const { data, error } = await supabase.functions.invoke('canvas-get-discussions', {
                body: { courseId },
                headers: this.getCustomHeaders()
            });
            if (error) {
                const msg = data?.error || error.message || "Failed to fetch discussions";
                console.error("Canvas API getDiscussionTopics Error:", msg, { data, error });
                throw new Error(msg);
            }
            if (!data) throw new Error("No data returned from getDiscussionTopics");
            if (data?.error) throw new Error(data.error);
            return data;
        } catch (e: any) {
            console.error("canvasAPI.getDiscussionTopics critical failure:", e);
            throw e;
        }
    },

    async getDiscussionEntries(courseId: string, topicId: string) {
        try {
            const { data, error } = await supabase.functions.invoke('canvas-get-discussion-entries', {
                body: { courseId, topicId },
                headers: this.getCustomHeaders()
            });
            if (error) {
                const msg = data?.error || error.message || "Failed to fetch discussion entries";
                console.error("Canvas API getDiscussionEntries Error:", msg, { data, error });
                throw new Error(msg);
            }
            if (!data) throw new Error("No data returned from getDiscussionEntries");
            if (data?.error) throw new Error(data.error);
            return data;
        } catch (e: any) {
            console.error("canvasAPI.getDiscussionEntries critical failure:", e);
            throw e;
        }
    },

    async postGrade(courseId: string, assignmentId: string, studentId: string, grade: number | string, comment: string) {
        try {
            const { data, error } = await supabase.functions.invoke('canvas-post-grade', {
                body: { courseId, assignmentId, studentId, grade, comment },
                headers: this.getCustomHeaders()
            });
            if (error) {
                const msg = data?.error || error.message || "Failed to post grade";
                console.error("Canvas API postGrade Error:", msg, { data, error });
                throw new Error(msg);
            }
            if (!data) throw new Error("No data returned from postGrade");
            if (data?.error) throw new Error(data.error);
            return data;
        } catch (e: any) {
            console.error("canvasAPI.postGrade critical failure:", e);
            throw e;
        }
    },

    async getDashboardStats(courseId: string) {
        try {
            const { data, error } = await supabase.functions.invoke('canvas-get-dashboard-stats', {
                body: { courseId },
                headers: this.getCustomHeaders()
            });
            if (error) {
                const msg = data?.error || error.message || "Failed to fetch dashboard stats";
                console.error("Canvas API getDashboardStats Error:", msg, { data, error });
                throw new Error(msg);
            }
            if (!data) throw new Error("No data returned from getDashboardStats");
            if (data?.error) throw new Error(data.error);
            return data;
        } catch (e: any) {
            console.error("canvasAPI.getDashboardStats critical failure:", e);
            throw e;
        }
    },

    async getAnalyticsSummaries(courseId: string) {
        try {
            const { data, error } = await supabase.functions.invoke('canvas-get-analytics-summaries', {
                body: { courseId },
                headers: this.getCustomHeaders()
            });
            if (error) {
                const msg = data?.error || error.message || "Failed to fetch analytics summaries";
                console.error("Canvas API getAnalyticsSummaries Error:", msg, { data, error });
                throw new Error(msg);
            }
            if (!data) throw new Error("No data returned from getAnalyticsSummaries");
            if (data?.error) throw new Error(data.error);
            return data;
        } catch (e: any) {
            console.error("canvasAPI.getAnalyticsSummaries critical failure:", e);
            throw e;
        }
    },

    async getPageViews(studentId: string, startTime?: string, endTime?: string) {
        try {
            const { data, error } = await supabase.functions.invoke('canvas-get-page-views', {
                body: { studentId, startTime, endTime },
                headers: this.getCustomHeaders()
            });
            if (error) {
                const msg = data?.error || error.message || "Failed to fetch page views";
                console.error("Canvas API getPageViews Error:", msg, { data, error });
                throw new Error(msg);
            }
            if (!data) throw new Error("No data returned from getPageViews");
            if (data?.error) throw new Error(data.error);
            return data;
        } catch (e: any) {
            console.error("canvasAPI.getPageViews critical failure:", e);
            throw e;
        }
    },

    async getStudentCourseActivity(courseId: string, studentId: string) {
        try {
            const { data, error } = await supabase.functions.invoke('canvas-get-student-course-activity', {
                body: { courseId, studentId },
                headers: this.getCustomHeaders()
            });
            if (error) {
                const msg = data?.error || error.message || "Failed to fetch student course activity";
                console.error("Canvas API getStudentCourseActivity Error:", msg, { data, error });
                throw new Error(msg);
            }
            if (!data) throw new Error("No data returned from getStudentCourseActivity");
            if (data?.error) throw new Error(data.error);
            return data;
        } catch (e: any) {
            console.error("canvasAPI.getStudentCourseActivity critical failure:", e);
            throw e;
        }
    },

    async postDiscussionReply(courseId: string, topicId: string, message: string, entryId?: string) {
        try {
            const { data, error } = await supabase.functions.invoke('canvas-post-discussion-reply', {
                body: { courseId, topicId, message, entryId },
                headers: this.getCustomHeaders()
            });
            if (error) {
                const msg = data?.error || error.message || "Failed to post discussion reply";
                console.error("Canvas API postDiscussionReply Error:", msg, { data, error });
                throw new Error(msg);
            }
            if (!data) throw new Error("No data returned from postDiscussionReply");
            if (data?.error) throw new Error(data.error);
            return data;
        } catch (e: any) {
            console.error("canvasAPI.postDiscussionReply critical failure:", e);
            throw e;
        }
    },

    async getModules(courseId: string) {
        try {
            const { data, error } = await supabase.functions.invoke('canvas-get-modules', {
                body: { courseId },
                headers: this.getCustomHeaders()
            });
            if (error) {
                const msg = data?.error || error.message || "Failed to fetch modules";
                console.error("Canvas API getModules Error:", msg, { data, error });
                throw new Error(msg);
            }
            if (!data) throw new Error("No data returned from getModules");
            if (data?.error) throw new Error(data.error);
            return data;
        } catch (e: any) {
            console.error("canvasAPI.getModules critical failure:", e);
            throw e;
        }
    },

    async getCourseFiles(courseId: string) {
        try {
            const { data, error } = await supabase.functions.invoke('canvas-get-course-files', {
                body: { courseId },
                headers: this.getCustomHeaders()
            });
            if (error) {
                const msg = data?.error || error.message || "Failed to fetch course files";
                console.error("Canvas API getCourseFiles Error:", msg, { data, error });
                throw new Error(msg);
            }
            if (!data) throw new Error("No data returned from getCourseFiles");
            if (data?.error) throw new Error(data.error);
            return data;
        } catch (e: any) {
            console.error("canvasAPI.getCourseFiles critical failure:", e);
            throw e;
        }
    },

    async downloadCanvasFile(url: string) {
        try {
            const headers: any = {};
            const customToken = localStorage.getItem('custom_canvas_token');
            if (customToken) {
                headers['Authorization'] = `Bearer ${customToken}`;
            }
            const res = await fetch(url, { headers });
            if (!res.ok) {
                throw new Error(`Failed to download file from canvas: ${res.statusText}`);
            }
            return await res.blob();
        } catch (e: any) {
            console.error("canvasAPI.downloadCanvasFile error:", e);
            throw e;
        }
    }
};



