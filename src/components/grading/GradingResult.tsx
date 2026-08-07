import React, { useState } from 'react';
import * as Icons from '../ui/Icons';
import { GradingOutput, CriterionVerdict } from '../../types/grading';

interface GradingResultProps {
  result: GradingOutput;
  rubricContext?: any[];
  onEvidenceAnchorClick?: (anchor: string) => void;
}

export const GradingResult: React.FC<GradingResultProps> = ({ result, rubricContext = [], onEvidenceAnchorClick }) => {
  const [openCriterion, setOpenCriterion] = useState<string | null>(null);

  const copyToClipboard = () => {
    const summary = `AI Grading Summary
Content: ${result.content_score}/${result.content_max || '?'} | Structure: ${result.structure_score}/${result.structure_max || '?'} | Total: ${result.total}/${result.total_max || '?'}

${result.criteria_verdicts.map(v => 
  `[${v.criterion_name}] (${v.status}): ${v.justification}${v.missing_keywords.length > 0 ? `\nMissing: ${v.missing_keywords.join(', ')}` : ''}`
).join('\n\n')}

${result.misconception_hint ? `Misconception: ${result.misconception_hint}` : ''}`;

    navigator.clipboard.writeText(summary);
    alert('AI Feedback copied to clipboard!');
  };

  const coverageColors = {
    HIGH: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:bg-emerald-500/20 dark:text-emerald-400',
    MEDIUM: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:bg-amber-500/20 dark:text-amber-400',
    LOW: 'bg-rose-500/10 text-rose-600 border-rose-500/20 dark:bg-rose-500/20 dark:text-rose-400'
  };

  const renderStatusIcon = (status: string) => {
    switch (status) {
      case 'full': 
        return <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0"><div className="w-2 h-2 bg-emerald-500 rounded-full"></div></div>;
      case 'partial': 
        return <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0"><div className="w-2 h-2 bg-amber-500 rounded-full"></div></div>;
      case 'missing': 
        return <div className="w-5 h-5 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0"><div className="w-2 h-2 bg-rose-500 rounded-full"></div></div>;
      default: 
        return <div className="w-5 h-5 rounded-full bg-zinc-500/20 flex items-center justify-center shrink-0"><div className="w-2 h-2 bg-zinc-500 rounded-full"></div></div>;
    }
  };

  const getRubricDetail = (criterionNameOrId: string) => {
    const match = rubricContext.find((r: any) => 
      r.id === criterionNameOrId || 
      r.description === criterionNameOrId || 
      (r.title && r.title === criterionNameOrId)
    );
    return match ? (match.long_description || match.description) : null;
  };

  const cleanSupportingMaterial = (mat: string) => {
    return mat.replace(/\s*\(?chunk\s*\d+\)?/gi, '').trim() || mat;
  };

  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-8">
      {/* Section A: Score Card */}
      <div className="bg-white dark:bg-[#151D2C] border border-zinc-100 dark:border-white/5 rounded-xl p-3 shadow-lg space-y-2 relative overflow-visible">
        <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-[30px] pointer-events-none"></div>
        <div className="flex justify-between items-center relative z-10">
          <div className="flex items-center gap-3">
            <div className="relative w-14 h-14 flex items-center justify-center">
               <svg className="absolute inset-0 w-full h-full transform -rotate-90 drop-shadow-md">
                 <circle cx="28" cy="28" r="24" fill="transparent" stroke="currentColor" strokeWidth="3" className="text-zinc-100 dark:text-white/5" />
                 <circle cx="28" cy="28" r="24" fill="transparent" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-indigo-500 transition-all duration-1000" strokeDasharray={`${((result.total / (result.total_max || 100)) * 150.79)} 150.79`} />
               </svg>
               <div className="text-center z-10 flex flex-col items-center mt-0.5">
                  <div className="text-xl font-black text-zinc-900 dark:text-white leading-none tracking-tighter">{result.total}</div>
                  <div className="text-[7px] font-bold text-zinc-500 mt-0.5 uppercase tracking-widest">/ {result.total_max || 100}</div>
               </div>
            </div>
             <div className="flex flex-col">
                <div className="text-[9px] font-black text-zinc-500 dark:text-zinc-500 uppercase tracking-[0.2em] leading-none mb-1">EVALUATION SCORE</div>
                <div className="text-[9px] text-zinc-500 dark:text-zinc-400 font-medium">AI Graded Submission</div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 origin-right">
            <div className="flex items-center space-x-2 text-[9px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
              <span>CONTENT:</span>
              <span className="text-xs text-zinc-900 dark:text-white font-bold ml-auto">{result.content_score}/{result.content_max || '?'}</span>
            </div>
            {result.structure_max !== undefined && result.structure_max > 0 && (
              <div className="flex items-center space-x-2 text-[9px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                <span>STRUCTURE:</span>
                <span className="text-xs text-zinc-900 dark:text-white font-bold ml-auto">{result.structure_score}/{result.structure_max}</span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-1.5 relative z-10 pt-3 border-t border-zinc-100 dark:border-white/5">
          <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500">
            <span>AI CONFIDENCE INDEX</span>
            <span className="text-indigo-500">{Math.round((result.overall_confidence || result.confidence || 0) * 100)}%</span>
          </div>
          <div className="h-1 w-full bg-zinc-100 dark:bg-white/5 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-1000" 
              style={{ width: `${(result.overall_confidence || result.confidence || 0) * 100}%` }}
            ></div>
          </div>
        </div>

        {result.flag_for_human && (
          <div className="p-2.5 px-3 bg-amber-50 dark:bg-amber-500/10 rounded-lg flex items-center space-x-2.5 text-amber-700 dark:text-amber-400 relative z-10">
            <Icons.IconSparkles className="w-4 h-4 shrink-0" />
            <div className="text-[9px] font-black uppercase tracking-widest leading-relaxed">FLAGGED FOR HUMAN REVIEW — ALGORITHM UNCERTAINTY DETECTED.</div>
          </div>
        )}
      </div>

      {/* Section C: Rubric Walkthrough */}
      <div className="space-y-3">
        <div className="text-[9px] font-black text-zinc-500 dark:text-zinc-500 uppercase tracking-[0.2em] ml-2">CRITERIA BREAKDOWN</div>
        <div className="space-y-2">
          {result.criteria_verdicts?.map((v) => {
            const criterionNameOrId = v.criterion_name || (v as any).title || v.criterion_id;
            const rubricDetail = getRubricDetail(criterionNameOrId);
            const isOpen = openCriterion === criterionNameOrId;
            
            return (
            <div key={criterionNameOrId} className={`bg-white dark:bg-[#151D2C] border transition-all duration-300 rounded-lg overflow-hidden shadow-sm ${isOpen ? 'border-indigo-500/30 shadow-md ring-2 ring-indigo-500/5' : 'border-zinc-100 dark:border-white/5 hover:border-zinc-300 dark:hover:border-white/10'}`}>
              <button 
                onClick={() => setOpenCriterion(isOpen ? null : criterionNameOrId)}
                className="w-full p-2.5 flex items-center justify-between text-left transition-colors"
              >
                <div className="flex items-center space-x-2.5 min-w-0 pr-3">
                  {renderStatusIcon(v.status)}
                  <div className="min-w-0">
                    <div className={`text-sm font-bold truncate ${isOpen ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-900 dark:text-white'}`}>
                      {criterionNameOrId}
                    </div>
                    <span className="text-[7px] font-black uppercase tracking-widest text-zinc-500 bg-zinc-100 dark:bg-white/5 px-1 py-0.5 rounded mt-0.5 inline-block">{v.dimension}</span>
                  </div>
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                  <div className="flex items-baseline space-x-0.5">
                     <span className="text-xs font-black text-zinc-900 dark:text-white">{v.score}</span>
                     <span className="text-[9px] font-bold text-zinc-400">/{v.max_score}</span>
                  </div>
                  <div className={`w-6 h-6 rounded-full bg-zinc-50 dark:bg-white/5 flex items-center justify-center transition-transform duration-300 ${isOpen ? 'rotate-180 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500' : 'text-zinc-400'}`}>
                     <Icons.IconChevronDown className="w-3 h-3" />
                  </div>
                </div>
              </button>

              {isOpen && (
                <div className="p-2.5 pt-0 space-y-2.5 animate-in slide-in-from-top-2 duration-200 border-t border-zinc-100 dark:border-white/5 mt-1 pt-2">
                  {rubricDetail && (
                     <div className="pl-3 border-l-2 border-indigo-500/30 py-1.5">
                        <div className="text-[7px] font-black text-indigo-500 uppercase tracking-widest mb-1 flex items-center"><Icons.IconList className="w-3 h-3 mr-1" /> Rubric Expectation</div>
                        <div className="text-xs text-zinc-600 dark:text-zinc-400 leading-snug font-medium">{rubricDetail}</div>
                     </div>
                  )}

                  <div className="space-y-1">
                    <div className="text-[7px] font-black text-zinc-500 uppercase tracking-widest flex items-center"><Icons.IconCheck className="w-3 h-3 mr-1" /> Justification</div>
                    <div className="text-sm text-zinc-800 dark:text-zinc-200 leading-snug font-medium">{v.justification}</div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[7px] font-black text-zinc-500 uppercase tracking-widest flex items-center"><Icons.IconFile className="w-3 h-3 mr-1" /> Evidence Anchor</div>
                    <button 
                       onClick={() => { if (v.evidence_anchor !== 'not found' && onEvidenceAnchorClick) onEvidenceAnchorClick(v.evidence_anchor); }}
                       className={`w-full text-left pl-3 border-l-2 text-xs py-1.5 transition-all block relative group cursor-pointer
                          ${v.evidence_anchor === 'not found' ? 'italic text-rose-500 border-rose-300' : 'text-indigo-600 dark:text-indigo-400 border-indigo-500 hover:text-indigo-800 dark:hover:text-indigo-300'}`}
                    >
                      {v.evidence_anchor !== 'not found' && (
                         <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Icons.IconSparkles className="w-3.5 h-3.5 text-indigo-400" />
                         </div>
                      )}
                      <span className="relative z-10 leading-relaxed font-medium">{v.evidence_anchor === 'not found' ? 'No evidence found in submission' : `"${v.evidence_anchor}"`}</span>
                    </button>
                  </div>

                  {v.missing_keywords?.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[7px] font-black text-zinc-500 uppercase tracking-widest flex items-center"><Icons.IconX className="w-3 h-3 mr-1" /> MISSING KEYWORDS</div>
                      <div className="flex flex-wrap gap-1">
                        {v.missing_keywords.map((kw, i) => (
                          <span key={i} className="px-1.5 py-0.5 bg-rose-50 dark:bg-rose-500/10 text-[8px] font-black text-rose-600 dark:text-rose-400 rounded-md uppercase tracking-wider">
                            {kw}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {v.required_concepts && v.required_concepts.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[8px] font-black text-zinc-500 uppercase tracking-widest flex items-center"><Icons.IconNetwork className="w-3 h-3 mr-1" /> CONCEPT COVERAGE DEPTH</div>
                      <div className="flex flex-col gap-1.5">
                         <div className="flex flex-wrap gap-1.5">
                            <span className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold my-auto mr-1.5">REQUIRED:</span>
                            {v.required_concepts.map((kw, i) => {
                               const isCovered = v.covered_concepts?.some(c => c.toLowerCase().includes(kw.toLowerCase()) || kw.toLowerCase().includes(c.toLowerCase()));
                               return (
                                  <span key={`req-${i}`} className={`px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider rounded ${isCovered ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-zinc-50 dark:bg-white/5 text-zinc-400'}`}>
                                    {kw} {isCovered && <Icons.IconCheck className="inline w-2.5 h-2.5 ml-0.5" />}
                                  </span>
                               );
                            })}
                         </div>
                         {v.covered_concepts && v.covered_concepts.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-0.5">
                               <span className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold my-auto mr-1.5">DEMONSTRATED:</span>
                               {v.covered_concepts.map((kw, i) => (
                                 <span key={`cov-${i}`} className="px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-[8px] font-black text-indigo-600 dark:text-indigo-400 rounded uppercase tracking-wider">
                                   {kw}
                                 </span>
                               ))}
                            </div>
                         )}
                      </div>
                    </div>
                  )}

                  {v.supporting_materials?.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[7px] font-black text-zinc-500 uppercase tracking-widest flex items-center"><Icons.IconChart className="w-3 h-3 mr-1" /> GROUNDED IN</div>
                      <div className="flex flex-wrap gap-1">
                        {v.supporting_materials.map((mat, i) => (
                          <span key={i} className="px-1.5 py-0.5 bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-400 text-[8px] font-black uppercase tracking-wider rounded-md">
                            {cleanSupportingMaterial(mat)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            );
          })}
        </div>
      </div>

      {/* Section D: Misconception Hint */}
      {result.misconception_hint && (
        <div className="p-3 rounded-lg bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-500/10 dark:to-orange-500/5 border border-amber-200 dark:border-amber-500/20 space-y-1.5 shadow-md shadow-amber-500/5 transition-all relative overflow-hidden">
          <div className="absolute top-0 right-0 w-20 h-20 bg-amber-400/10 rounded-full blur-[20px]"></div>
          <div className="flex items-center space-x-1.5 text-amber-700 dark:text-amber-400 relative z-10">
            <Icons.IconSparkles className="w-3.5 h-3.5" />
            <h4 className="text-[8px] font-black uppercase tracking-[0.2em]">TARGETED FEEDBACK</h4>
          </div>
          <div className="text-sm text-amber-900/90 dark:text-amber-200/90 font-medium leading-snug italic relative z-10">
            "{result.misconception_hint}"
          </div>
        </div>
      )}

      {/* Section E: Academic Integrity */}
      {result.integrityEvaluation && (
        <div className="space-y-2 relative overflow-hidden pt-2">
          <div className="flex items-center space-x-2 border-b border-zinc-100 dark:border-white/5 pb-1.5">
            <Icons.IconSparkles className="w-3 h-3 text-indigo-500" />
            <div className="text-[8px] font-black uppercase tracking-[0.2em] text-zinc-500">ACADEMIC INTEGRITY</div>
          </div>

          <div className="space-y-2 bg-zinc-50 dark:bg-white/5 p-3 rounded-lg border border-zinc-100/50 dark:border-white/5">
            <div className="space-y-1 text-[9px] text-zinc-500 dark:text-zinc-400 font-medium">
              <div className="flex justify-between">
                <span className="text-zinc-400">AI Authorship:</span>
                <span className={`font-bold ${result.integrityEvaluation.ai_authorship_probability > 0.5 ? 'text-rose-500' : 'text-emerald-500'}`}>
                  {Math.round(result.integrityEvaluation.ai_authorship_probability * 100)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Plagiarism Risk:</span>
                <span className={`font-bold uppercase tracking-wider px-1 py-0.5 rounded ${result.integrityEvaluation.plagiarism_risk === 'High' ? 'bg-rose-500/10 text-rose-500' : result.integrityEvaluation.plagiarism_risk === 'Medium' ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                  {result.integrityEvaluation.plagiarism_risk}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Copy Button */}
      <button 
        onClick={copyToClipboard}
        className="w-full py-2.5 mt-2 bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg flex items-center justify-center space-x-2 font-black text-[10px] uppercase tracking-[0.2em] transition-all hover:scale-[1.01] active:scale-[0.99] group"
      >
        <Icons.IconCheck className="w-4 h-4 group-hover:scale-110 transition-transform" />
        <span>Copy AI Feedback</span>
      </button>

    </div>
  );
};
