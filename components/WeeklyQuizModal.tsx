
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { GoogleGenAI, Type } from "@google/genai";
import * as Icons from './Icons';

interface WeeklyQuizModalProps {
    moduleId: string;
    moduleContent: string;
    onClose: () => void;
    onApproved: (quizData: { id: string; title: string }) => void;
}

interface QuizQuestion {
    question: string;
    answer: string;
}

const WeeklyQuizModal: React.FC<WeeklyQuizModalProps> = ({ moduleId, moduleContent, onClose, onApproved }) => {
    const [generating, setGenerating] = useState(true);
    const [publishing, setPublishing] = useState(false);
    const [quizTitle, setQuizTitle] = useState("Weekly Knowledge Ledger");
    const [questions, setQuestions] = useState<QuizQuestion[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        generateQuiz();
    }, []);

    const generateQuiz = async () => {
        setGenerating(true);
        setError(null);
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
            const prompt = `You are an AI Curriculum Architect. Based on the following module content summary, generate 5 challenging multiple-choice or short-answer questions for a weekly quiz.
            
            MODULE CONTENT:
            ${moduleContent}
            
            Return a JSON object with a "title" field and a "questions" array. Each question must have "question" and "answer" tags.`;

            const schema = {
                type: Type.OBJECT,
                properties: {
                    title: { type: Type.STRING },
                    questions: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                question: { type: Type.STRING },
                                answer: { type: Type.STRING }
                            },
                            required: ["question", "answer"]
                        }
                    }
                },
                required: ["title", "questions"]
            };

            const response = await ai.models.generateContent({
                model: "gemini-3-flash-preview",
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: {
                    responseMimeType: "application/json",
                    responseSchema: schema
                }
            });

            const result = JSON.parse(response.text || "{}");
            setQuizTitle(result.title || "Weekly Knowledge Ledger");
            setQuestions(result.questions || []);
        } catch (err: any) {
            console.error("AI Quiz Architecture Failed:", err);
            setError("The AI Architect encountered a logic error while devising the quiz. Please retry.");
        } finally {
            setGenerating(false);
        }
    };

    const handleApprove = async () => {
        if (questions.length === 0) return;
        setPublishing(true);
        try {
            const finalContent = JSON.stringify({
                instruction: "Complete this weekly module checkpoint. Results contribute to your final mastery ledger.",
                timeLimitMinutes: 15,
                questions: questions
            });

            const { data, error } = await supabase.from('assignments').insert({
                course_id: 'BIG_DATA_2026',
                assignment_name: quizTitle,
                assignment_type: 'quiz',
                topic: 'Weekly Checkpoint',
                content: finalContent,
                points_possible: questions.length * 10,
                due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 1 week from now
            }).select();

            if (error) throw error;
            if (data && data[0]) {
                onApproved({ id: data[0].id, title: quizTitle });
            }
        } catch (err) {
            console.error("Quiz Publication Failed:", err);
            setError("Failed to sync the quiz to the section ledger.");
        } finally {
            setPublishing(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm animate-in fade-in transition-all">
            <div className="bg-white dark:bg-[#0B1120] w-full max-w-4xl rounded-[3rem] shadow-2xl border border-zinc-100 dark:border-white/5 overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <header className="p-8 border-b border-zinc-100 dark:border-white/5 flex items-center justify-between bg-zinc-50/50 dark:bg-white/5">
                    <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shrink-0">
                            <Icons.IconBot className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tighter uppercase font-['Space_Grotesk']">Weekly Quiz Architect</h2>
                            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">AI Content Generation Interface</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-10 h-10 rounded-full hover:bg-zinc-200 dark:hover:bg-white/10 flex items-center justify-center text-zinc-400">✕</button>
                </header>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-10 space-y-8">
                    {generating ? (
                        <div className="py-20 flex flex-col items-center justify-center space-y-6">
                            <div className="w-16 h-16 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin"></div>
                            <div className="text-center">
                                <p className="text-lg font-black text-zinc-900 dark:text-white tracking-tight">AI Architect is Analyzing Module Assets...</p>
                                <p className="text-sm font-bold text-zinc-400">Constructing logic-verified checkpoint questions.</p>
                            </div>
                        </div>
                    ) : error ? (
                        <div className="py-20 text-center space-y-6">
                            <div className="text-6xl text-rose-500">⚠</div>
                            <p className="text-lg font-bold text-zinc-600 dark:text-zinc-400 max-w-md mx-auto">{error}</p>
                            <button onClick={generateQuiz} className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg">Retry Architecture</button>
                        </div>
                    ) : (
                        <div className="animate-in slide-in-from-bottom-4 duration-500">
                            <div className="mb-10">
                                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1 mb-2 block">Proposed Ledger Title</label>
                                <input
                                    value={quizTitle}
                                    onChange={(e) => setQuizTitle(e.target.value)}
                                    className="w-full h-16 px-6 bg-zinc-50 dark:bg-white/5 border-2 border-zinc-100 dark:border-white/5 rounded-2xl text-xl font-black text-zinc-900 dark:text-white focus:border-indigo-500 outline-none transition-all"
                                />
                            </div>

                            <div className="space-y-6">
                                <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest ml-1">Proposed Questions ({questions.length})</h3>
                                {questions.map((q, idx) => (
                                    <div key={idx} className="p-8 bg-zinc-50 dark:bg-white/5 rounded-[2rem] border-2 border-zinc-100 dark:border-white/5 space-y-4 group hover:border-indigo-400 transition-all">
                                        <div className="flex items-start space-x-4">
                                            <span className="w-8 h-8 rounded-full bg-white dark:bg-zinc-800 flex items-center justify-center text-[10px] font-black text-indigo-600 border border-zinc-100 dark:border-white/10 shrink-0">{idx + 1}</span>
                                            <div className="flex-1">
                                                <input
                                                    value={q.question}
                                                    onChange={(e) => {
                                                        const newQs = [...questions];
                                                        newQs[idx].question = e.target.value;
                                                        setQuestions(newQs);
                                                    }}
                                                    className="w-full bg-transparent border-none focus:ring-0 text-lg font-black text-zinc-900 dark:text-white p-0"
                                                />
                                                <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-white/10">
                                                    <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest mb-2 block font-['Space_Grotesk']">Logic Key: Correct Answer</span>
                                                    <input
                                                        value={q.answer}
                                                        onChange={(e) => {
                                                            const newQs = [...questions];
                                                            newQs[idx].answer = e.target.value;
                                                            setQuestions(newQs);
                                                        }}
                                                        className="w-full bg-emerald-500/5 dark:bg-emerald-500/10 px-4 py-2.5 rounded-xl text-xs font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <footer className="p-8 bg-zinc-50/50 dark:bg-white/5 border-t border-zinc-100 dark:border-white/5 flex items-center justify-end space-x-4">
                    <button onClick={onClose} className="px-8 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-zinc-600 transition-colors">Discard Architect</button>
                    {!generating && !error && (
                        <button
                            onClick={handleApprove}
                            disabled={publishing}
                            className="px-8 py-4 bg-[#18181B] dark:bg-indigo-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center space-x-3 disabled:opacity-50"
                        >
                            {publishing ? (
                                <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                            ) : (
                                <>
                                    <span>Approve & Publish to Ledger</span>
                                    <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">→</span>
                                </>
                            )}
                        </button>
                    )}
                </footer>
            </div>
        </div>
    );
};

export default WeeklyQuizModal;
