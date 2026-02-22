
import React, { useEffect, useRef } from 'react';
import { gsap } from 'gsap';

const SocialProof: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Fade in section
      gsap.fromTo(containerRef.current, 
        { opacity: 0, y: 20 },
        { 
          opacity: 1, 
          y: 0, 
          duration: 1,
          scrollTrigger: {
            trigger: containerRef.current,
            start: "top 95%",
          }
        }
      );

      // Infinite scroll carousel
      const width = carouselRef.current?.offsetWidth || 0;
      gsap.to(carouselRef.current, {
        x: -width / 2,
        duration: 30,
        repeat: -1,
        ease: "none"
      });
    }, containerRef);

    return () => ctx.revert();
  }, []);

  const logos = ["MIT", "Stanford", "Harvard", "Yale", "Oxford", "Cambridge"];

  return (
    <section ref={containerRef} className="py-12 border-y border-zinc-100 bg-white/30 relative z-10">
      <div className="container mx-auto px-6 text-center mb-8">
        <h3 className="text-zinc-400 font-bold tracking-widest uppercase text-[10px]">
          Trusted by leading universities worldwide
        </h3>
      </div>
      
      <div className="overflow-hidden whitespace-nowrap relative">
        <div ref={carouselRef} className="inline-flex items-center space-x-24 py-4">
          {[...logos, ...logos].map((logo, idx) => (
            <div 
              key={idx} 
              className="text-2xl md:text-3xl font-black text-zinc-200 hover:text-zinc-400 transition-colors cursor-default select-none tracking-tighter"
            >
              {logo}
            </div>
          ))}
        </div>
        {/* Gradients to mask the edges */}
        <div className="absolute top-0 left-0 w-32 h-full bg-gradient-to-r from-[#F9F8F3] to-transparent z-10"></div>
        <div className="absolute top-0 right-0 w-32 h-full bg-gradient-to-l from-[#F9F8F3] to-transparent z-10"></div>
      </div>
    </section>
  );
};

export default SocialProof;
