
import React, { useState, useEffect, useRef } from 'react';

const testimonials = [
  {
    text: "This platform has significantly streamlined the preparation for Big Data materials, allowing more time for in-depth research and student mentoring.",
    author: "Professor Bo Pei",
    role: "Course Instructor, USF",
    img: "https://i.pravatar.cc/150?u=bo-pei",
    style: "card-blue"
  },
  {
    text: "The AI assistant makes complex data visualization concepts much easier to grasp. It's like having a 24/7 tutor for the course who knows exactly what the slides cover.",
    author: "Alex Thompson",
    role: "Computer Science Junior",
    img: "https://i.pravatar.cc/150?u=alex",
    style: "card-orange"
  },
  {
    text: "Being able to interact with datasets directly within the learning hub has made my visualization projects much more efficient and meaningful.",
    author: "Sarah Jenkins",
    role: "Data Science Graduate Student",
    img: "https://i.pravatar.cc/150?u=sarahj",
    style: "card-green"
  }
];

const Testimonials: React.FC = () => {
  const [active, setActive] = useState(0);
  const timeoutRef = useRef<number | null>(null);

  const resetTimeout = () => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }
  };

  useEffect(() => {
    resetTimeout();
    timeoutRef.current = window.setTimeout(
      () => setActive((prevIndex) => (prevIndex + 1) % testimonials.length),
      5000
    );
    return () => resetTimeout();
  }, [active]);

  return (
    <section className="py-32 overflow-hidden">
      <div className="container mx-auto px-6">
        <h2 className="text-4xl md:text-5xl font-extrabold text-center mb-20 text-zinc-900 tracking-tight">Academic Perspectives</h2>
        
        <div className="relative max-w-4xl mx-auto h-[450px] md:h-[400px] flex items-center justify-center">
          {testimonials.map((t, idx) => {
            const isActive = idx === active;
            return (
              <div 
                key={idx}
                className={`absolute w-full transition-all duration-1000 transform 
                  ${isActive ? 'opacity-100 scale-100 translate-x-0 z-20' : 'opacity-0 scale-95 translate-x-12 z-10 pointer-events-none'}`}
              >
                <div className={`${t.style} border border-black/5 p-10 md:p-16 rounded-[3rem] shadow-xl shadow-zinc-200/50 relative text-center`}>
                  <div className="text-8xl opacity-10 font-serif absolute -top-4 left-10">“</div>
                  <p className="text-xl md:text-2xl font-bold tracking-tight mb-12 relative z-10 leading-relaxed italic text-zinc-900">
                    {t.text}
                  </p>
                  
                  <div className="flex flex-col items-center">
                    <div className="w-16 h-16 rounded-full p-1 bg-white mb-4 shadow-sm">
                      <img src={t.img} alt={t.author} className="w-full h-full rounded-full object-cover" loading="lazy" />
                    </div>
                    <div className="font-bold text-zinc-900 text-lg">{t.author}</div>
                    <div className="text-zinc-500 text-sm font-semibold">{t.role}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-center mt-10 space-x-2">
          {testimonials.map((_, idx) => (
            <button 
              key={idx}
              onClick={() => setActive(idx)}
              className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${active === idx ? 'w-8 bg-zinc-900' : 'bg-zinc-200 hover:bg-zinc-300'}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
};

export default Testimonials;
