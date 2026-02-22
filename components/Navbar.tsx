
import React, { useState, useEffect } from 'react';

interface NavbarProps {
  onGetStarted?: () => void;
}

const Navbar: React.FC<NavbarProps> = ({ onGetStarted }) => {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { name: 'Course Overview', href: '#features' },
    { name: 'Modules', href: '#demo' },
    { name: 'Assignments', href: '#demo' },
    { name: 'Support', href: '#pricing' },
  ];

  return (
    <nav className={`fixed top-0 left-0 w-full z-50 transition-all duration-500 ${scrolled ? 'py-3 glass-nav' : 'py-6 bg-transparent'}`}>
      <div className="container mx-auto px-6 flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 bg-zinc-900 rounded-lg flex items-center justify-center font-black text-white text-lg">USF</div>
          <span className="text-xl font-bold tracking-tight text-zinc-900">BigData AI</span>
        </div>

        <div className="hidden md:flex items-center space-x-1">
          {navLinks.map((link) => (
            <a 
              key={link.name} 
              href={link.href}
              className="px-4 py-2 text-zinc-500 hover:text-zinc-900 transition-colors duration-200 text-sm font-medium rounded-full hover:bg-black/5"
            >
              {link.name}
            </a>
          ))}
        </div>

        <div className="flex items-center space-x-4">
          <button 
            onClick={onGetStarted}
            className="hidden sm:block text-sm font-medium text-zinc-600 hover:text-zinc-900"
          >
            Portal
          </button>
          <button 
            onClick={onGetStarted}
            className="px-5 py-2.5 btn-primary rounded-full font-semibold text-sm active:scale-95 shadow-sm"
          >
            Sign In
          </button>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
