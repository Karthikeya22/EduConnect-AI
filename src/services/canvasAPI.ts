import { supabase, GRADE_PUBLICATION_DISABLED } from '@/src/lib/supabase';

export const canvasAPI = {
    getCustomHeaders() {
        const customToken = localStorage.getItem('custom_canvas_token');
        if (customToken) {
             return { 'x-canvas-token': customToken };
        }
        return {};
    },

    async syncPreferences(
        email: string,
        updates: {
            canvas_token?: string;
            canvas_token_expiry?: string;
            llm_api_key?: string;
            llm_provider?: string;
        },
    ) {
        try {
            const payload: any = {
                teacher_email: email,
                ...updates,
            };
            if (updates.llm_api_key !== undefined) {
                payload.gemini_api_key = updates.llm_api_key;
            }

            const { error } = await supabase
                .from('teacher_preferences')
                .upsert(payload, { onConflict: 'teacher_email' });

            if (error) throw error;
            return true;
        } catch (e) {
            console.error("Failed to sync preferences with backend:", e);
            throw e;
        }
    },

    /** @deprecated use syncPreferences — kept for call-site compatibility */
    async syncTokenWithBackend(
        email: string,
        token: string,
        expiry: string,
        llmApiKey?: string,
        llmProvider?: string,
    ) {
        const updates: any = {
            canvas_token: token,
            canvas_token_expiry: expiry,
        };
        if (llmApiKey !== undefined) updates.llm_api_key = llmApiKey;
        if (llmProvider !== undefined) updates.llm_provider = llmProvider;
        return this.syncPreferences(email, updates);
    },

    async fetchTokenFromBackend(email: string) {
        try {
            const { data, error } = await supabase
                .from('teacher_preferences')
                .select('canvas_token, canvas_token_expiry, gemini_api_key, llm_api_key, llm_provider')
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

    // Grade publication is disabled (Rule #1). No approval gate exists yet, so this
    // must not invoke anything.
    async postGrade(_courseId: string, _assignmentId: string, _studentId: string, _grade: number | string, _comment: string): Promise<never> {
        throw new Error(GRADE_PUBLICATION_DISABLED);
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

    async getPageViews(courseId: string, studentId: string, startTime?: string, endTime?: string) {
        try {
            const { data, error } = await supabase.functions.invoke('canvas-get-page-views', {
                body: { courseId, studentId, startTime, endTime },
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

    async listCourseFilesFromCanvas(courseId: string) {
        const token = localStorage.getItem('custom_canvas_token');
        if (!token) {
            throw new Error('Connect your Canvas API token (Course Selection → Verify Canvas) to load course files.');
        }
        const headers = { Authorization: `Bearer ${token}` };
        const all: any[] = [];
        const seen = new Set<string>();
        let url: string | null = `/canvas-api/api/v1/courses/${encodeURIComponent(courseId)}/files?per_page=100`;
        for (let page = 0; page < 30 && url; page++) {
            const res = await fetch(url, { headers });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`Canvas files ${res.status}: ${text.slice(0, 180)}`);
            }
            const body = await res.json();
            if (!Array.isArray(body)) break;
            for (const file of body) {
                const id = file?.id != null ? String(file.id) : '';
                if (!id || seen.has(id)) continue;
                seen.add(id);
                all.push(file);
            }
            const link = res.headers.get('Link') || '';
            const next = link.match(/<([^>]+)>;\s*rel="next"/);
            if (!next) break;
            url = next[1].replace(/^https:\/\/[^/]+/, '/canvas-api');
        }
        return all;
    },

    async getCourseFiles(courseId: string) {
        let edgeFiles: any[] | null = null;
        try {
            const { data, error } = await supabase.functions.invoke('canvas-get-course-files', {
                body: { courseId },
                headers: this.getCustomHeaders()
            });
            if (!error && Array.isArray(data)) edgeFiles = data;
            if (edgeFiles && edgeFiles.length > 0) return edgeFiles;
            const msg = data?.error || error?.message;
            if (msg) console.warn('canvas-get-course-files unavailable, listing Canvas directly:', msg);
        } catch (e: any) {
            console.warn('canvas-get-course-files failed, listing Canvas directly:', e);
        }
        try {
            const direct = await this.listCourseFilesFromCanvas(courseId);
            if (direct.length > 0) return direct;
        } catch (e: any) {
            if (!edgeFiles) throw e;
        }
        return edgeFiles || [];
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



