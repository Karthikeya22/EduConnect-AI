
import React, { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import * as Icons from './Icons';

const features = [
  {
    Icon: Icons.IconBook,
    title: "Organized Instructional Materials",
    desc: "All chapters, readings, and lecture videos in one structured place for easy access.",
    style: "card-orange",
  },
  {
    Icon: Icons.IconDraft,
    title: "AI Assignments & Discussions",
    desc: "Professor Pei uses AI to generate intelligent prompts and rubrics for complex data tasks.",
    style: "card-blue",
  },
  {
    Icon: Icons.IconChart,
    title: "Learning Activity Tracking",
    desc: "Insights for the professor to see which materials are being engaged with and when.",
    style: "card-green",
  },
  {
    Icon: Icons.IconChat,
    title: "Interactive Student Q&A",
    desc: "Ask the course AI assistant questions about lectures, readings, or complex visualizations 24/7.",
    style: "card-pink",
  },
  {
    Icon: Icons.IconTarget,
    title: "Feedback & Grading Support",
    desc: "AI helps Professor Pei draft personalized feedback and consistent grading suggestions.",
    style: "card-orange",
  },
  {
    Icon: Icons.IconTrending,
    title: "Big Data Resources",
    desc: "Curated datasets, visualization tools, and industry examples ready for exploration.",
    style: "card-blue",
  }
];

const Features: React.FC = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(".features-heading > *", {
        y: 40,
        opacity: 0,
        stagger: 0.1,
        duration: 0.8,
        scrollTrigger: {
          trigger: ".features-heading",
          start: "top 80%",
        }
      });

      cardsRef.current.forEach((card, idx) => {
        if (!card) return;
        
        // Scroll entrance
        gsap.from(card, {
          y: 40,
          opacity: 0,
          duration: 1,
          ease: "power3.out",
          scrollTrigger: {
            trigger: card,
            start: "top 95%",
          }
        });

        // 3D Tilt Logic
        card.addEventListener('mousemove', (e) => {
          const rect = card.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const centerX = rect.width / 2;
          const centerY = rect.height / 2;
          const rotateX = (y - centerY) / 10;
          const rotateY = (centerX - x) / 10;

          gsap.to(card, {
            rotateX: rotateX,
            rotateY: rotateY,
            scale: 1.05,
            duration: 0.4,
            ease: "power2.out",
            transformPerspective: 1000
          });
        });

        card.addEventListener('mouseleave', () => {
          gsap.to(card, {
            rotateX: 0,
            rotateY: 0,
            scale: 1,
            duration: 0.5,
            ease: "power2.out"
          });
        });
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section id="features" ref={sectionRef} className="py-32 overflow-hidden">
      <div className="container mx-auto px-6">
        <div className="text-center mb-24 max-w-2xl mx-auto features-heading">
          <h2 className="text-4xl md:text-5xl font-extrabold mb-6 text-zinc-900 tracking-tight">
            Integrated Course Hub
          </h2>
          <p className="text-lg text-zinc-500 font-medium">Everything Professor Pei's students need for academic success, powered by AI intelligence.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, idx) => (
            <div 
              key={idx}
              ref={(el) => { cardsRef.current[idx] = el; }}
              className={`${feature.style} p-10 rounded-[2.5rem] border border-black/5 shadow-zinc-100 group cursor-default h-full transition-shadow duration-300`}
            >
              <div className="w-14 h-14 bg-white/50 rounded-2xl flex items-center justify-center mb-8 shadow-sm">
                <feature.Icon className="w-8 h-8" />
              </div>
              <h3 className="text-2xl font-bold mb-4 tracking-tight">{feature.title}</h3>
              <p className="opacity-80 leading-relaxed font-medium">{feature.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Features;
