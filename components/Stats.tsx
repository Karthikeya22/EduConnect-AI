
import React, { useEffect, useRef } from 'react';
import { gsap } from 'gsap';

const statItems = [
  { value: 1, suffix: "", label: "Course Section" },
  { value: 12, suffix: "", label: "Weekly Modules" },
  { value: 50, suffix: "+", label: "Unique Datasets" },
  { value: 100, suffix: "%", label: "Digital Access" }
];

const Stats: React.FC = () => {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      statItems.forEach((_, i) => {
        const target = { val: 0 };
        const el = document.querySelector(`.stat-count-${i}`);
        if (!el) return;

        gsap.to(target, {
          val: statItems[i].value,
          duration: 2,
          ease: "power2.out",
          scrollTrigger: {
            trigger: el,
            start: "top 90%",
          },
          onUpdate: () => {
            el.innerHTML = Math.floor(target.val).toLocaleString() + statItems[i].suffix;
          }
        });
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="py-24 bg-white/40 border-y border-zinc-100">
      <div className="container mx-auto px-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-12 text-center">
          {statItems.map((stat, idx) => (
            <div key={idx} className="space-y-3">
              <div className={`stat-count-${idx} text-5xl md:text-7xl font-black text-zinc-900 tracking-tighter`}>0</div>
              <div className="text-zinc-400 font-bold uppercase tracking-widest text-xs">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Stats;
