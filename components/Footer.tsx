
import React from 'react';

const Footer: React.FC = () => {
  const columns = [
    {
      title: "Course",
      links: ["Syllabus", "Modules", "Datasets", "Visualization Guide", "Lab Portal"]
    },
    {
      title: "Help",
      links: ["AI Support", "Office Hours", "Canvas Link", "Technical FAQ", "Contact TA"]
    },
    {
      title: "Institutional",
      links: ["USF Official", "CS Department", "Accessibility", "Privacy Policy", "Ethics in Data"]
    }
  ];

  return (
    <footer className="bg-transparent pt-24 pb-12">
      <div className="container mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-6 gap-12 mb-20">
          <div className="lg:col-span-3">
            <div className="flex items-center space-x-3 mb-8">
              <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center font-bold text-white">USF</div>
              <span className="text-xl font-extrabold tracking-tight text-zinc-900">BigData AI</span>
            </div>
            <p className="text-zinc-500 max-w-sm mb-8 leading-relaxed font-medium">
              Official AI-enhanced hub for Professor Bo Pei's Big Data & Data Visualization course. Designed for academic excellence and deep technical understanding.
            </p>
            <div className="flex space-x-4">
              {['Twitter', 'LinkedIn', 'Instagram'].map(social => (
                <a 
                  key={social} 
                  href="#" 
                  className="px-4 py-2 rounded-full border border-zinc-200 text-zinc-600 hover:text-zinc-900 hover:border-zinc-900 transition-all text-sm font-bold"
                >
                  {social}
                </a>
              ))}
            </div>
          </div>

          {columns.map((col, idx) => (
            <div key={idx}>
              <h4 className="text-zinc-900 font-bold mb-6 text-sm uppercase tracking-widest">{col.title}</h4>
              <ul className="space-y-4">
                {col.links.map(link => (
                  <li key={link}>
                    <a href="#" className="text-zinc-500 hover:text-zinc-900 transition-colors text-sm font-medium">{link}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col md:flex-row justify-between items-center pt-8 border-t border-zinc-100 text-zinc-400 text-xs font-bold uppercase tracking-widest">
          <p>© 2024 University of South Florida. Big Data & Data Visualization.</p>
          <div className="flex space-x-6 mt-4 md:mt-0">
            <a href="#" className="hover:text-zinc-900 transition-colors">Privacy</a>
            <a href="#" className="hover:text-zinc-900 transition-colors">Terms</a>
            <a href="#" className="hover:text-zinc-900 transition-colors">Cookies</a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
